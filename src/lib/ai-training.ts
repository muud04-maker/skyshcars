import { db, one } from './db';
import {
  createInstruction, deleteInstruction, deactivateInstruction, instructionById,
  normalizeInstruction, recordAiTrainingAudit, updateInstruction,
} from './knowledge';
import {
  applyLearningEvent, disableLearningEvent, learningEventById, recordLearningEvent,
  reviewLearningEvent, undoLearningEvent,
} from './ai-learning';
import { getBusinessPolicy, saveBusinessPolicy } from './business-policy';
import { createTask } from './staff-tasks';

export const AI_TRAINING_COMMANDS = [
  'update_instruction',
  'disable_lesson',
  'set_response_style',
  'add_faq',
  'request_followup',
  'request_inventory_review',
] as const;

export const AI_TRAINING_COMMAND_LABELS: Record<string, string> = {
  update_instruction: 'Update an approved instruction',
  disable_lesson: 'Disable an outdated lesson',
  set_response_style: 'Set the preferred response style',
  add_faq: 'Add a verified FAQ',
  request_followup: 'Request a customer follow-up task',
  request_inventory_review: 'Request an inventory review',
};

export function commandRequiresConfirmation(command: string) {
  return (AI_TRAINING_COMMANDS as readonly string[]).includes(String(command));
}

export async function createTrainingCorrection(input: any, actor: string) {
  const question = String(input.question || '').trim().slice(0, 4000);
  const aiReply = String(input.ai_reply || '').trim().slice(0, 4000);
  const correction = String(input.correction || '').trim().slice(0, 4000);
  const reason = String(input.reason || '').trim().slice(0, 191);
  const lesson = String(input.lesson || '').trim().slice(0, 4000);
  const evidence = String(input.evidence || '').trim().slice(0, 191) || null;
  if (!question || !aiReply || !correction || !reason) {
    throw new Error('Customer question, incorrect answer, correct answer and correction reason are required');
  }
  const conversationId = Number(input.conversation_id) || null;
  const customerId = conversationId
    ? Number((await one<any>('SELECT customer_id FROM conversations WHERE id=? LIMIT 1', [conversationId]).catch(() => null))?.customer_id || 0) || null
    : null;
  const appliesTo = input.applies_to === 'customer' ? 'customer' : 'global';
  if (appliesTo === 'global' && conversationId && !lesson) {
    throw new Error('A reusable general lesson is required before a conversation correction can apply globally');
  }
  const out = await recordLearningEvent({
    conversationId,
    customerId,
    question,
    aiReply,
    correction,
    eventType: 'better_sales_reply',
    reason,
    lesson: lesson || correction,
    appliesTo,
    evidence,
    status: 'pending',
    createdBy: actor,
    category: String(input.category || 'process').slice(0, 40),
    payload: { training_center: true, version: 1 },
  });
  await recordAiTrainingAudit(actor, 'ai_training.correction_created', 'ai_learning_event', out.id, {
    conversation_id: conversationId, applies_to: appliesTo, evidence,
  });
  return out;
}

export async function reviewTrainingCorrection(id: number, action: string, input: any, actor: string) {
  let out: any;
  if (action === 'edit') {
    const event = await learningEventById(id);
    if (!event) throw new Error('Correction not found');
    const visibleScope = input.applies_to === 'customer' ? 'customer' : 'global';
    const payload = (() => { try { return typeof event.payload === 'string' ? JSON.parse(event.payload) : (event.payload || {}); } catch { return {}; } })();
    const version = Math.max(1, Number(payload.version || 1)) + 1;
    await db().execute(`UPDATE ai_learning_events SET question=?,ai_reply=?,correction=?,lesson=?,reason=?,evidence_ref=?,category=?,applies_to=?,payload=? WHERE id=?`, [
      String(input.question || '').trim().slice(0, 4000) || null,
      String(input.ai_reply || '').trim().slice(0, 4000) || null,
      String(input.correction || '').trim().slice(0, 4000) || null,
      String(input.lesson || '').trim().slice(0, 4000) || null,
      String(input.reason || '').trim().slice(0, 191) || null,
      String(input.evidence || '').trim().slice(0, 191) || null,
      String(input.category || 'process').slice(0, 40),
      visibleScope,
      JSON.stringify({ ...payload, training_center: true, version }),
      Number(id),
    ]);
    out = { ok: true, id: Number(id), status: event.status, edited: true, version };
  }
  else if (action === 'apply') out = await applyLearningEvent(id, actor);
  else if (action === 'undo') out = await undoLearningEvent(id, actor);
  else if (action === 'disable' || action === 'delete') out = await disableLearningEvent(id, actor);
  else if (['approve', 'reject', 'reopen'].includes(action)) {
    out = await reviewLearningEvent(id, action as any, {
      lesson: input.lesson ?? null,
      appliesTo: input.applies_to,
      by: actor,
      confidence: input.confidence,
      category: input.category,
      expiresAt: input.expires_at,
    });
  } else throw new Error('Unknown correction action');
  await recordAiTrainingAudit(actor, `ai_training.correction_${action}`, 'ai_learning_event', id, { result: out });
  return out;
}

export async function executeTrainingCommand(command: string, input: any, actor: string) {
  if (!(AI_TRAINING_COMMANDS as readonly string[]).includes(String(command))) throw new Error('Command is not allowed');
  if (command === 'update_instruction') {
    const id = Number(input.instruction_id);
    if (!id) throw new Error('Choose an instruction to update');
    const current = await instructionById(id);
    if (!current) throw new Error('Instruction not found');
    const row = await updateInstruction(id, input, actor, true);
    return { command, instruction: row, message: 'Instruction updated and active.' };
  }
  if (command === 'disable_lesson') {
    const id = Number(input.learning_id);
    if (!id) throw new Error('Choose a lesson to disable');
    const event = await learningEventById(id);
    if (!event) throw new Error('Lesson not found');
    const result = await disableLearningEvent(id, actor);
    await recordAiTrainingAudit(actor, 'ai_training.command_disable_lesson', 'ai_learning_event', id, result);
    return { command, result, message: 'Lesson disabled without deleting its audit history.' };
  }
  if (command === 'set_response_style') {
    const current = await getBusinessPolicy();
    const requested = input.style && typeof input.style === 'object' ? input.style : {};
    const next = await saveBusinessPolicy({ ...current, style: { ...current.style, ...requested } }, actor);
    await recordAiTrainingAudit(actor, 'ai_training.command_response_style', 'business_policy', next.version, { style: next.style });
    return { command, policy: next, message: `Response style saved as policy version ${next.version}.` };
  }
  if (command === 'add_faq') {
    const row = await createInstruction({ ...input, scope: 'faq' }, actor, true);
    return { command, instruction: row, message: 'Verified FAQ added and active.' };
  }
  if (command === 'request_followup') {
    const conversationId = Number(input.conversation_id);
    if (!conversationId) throw new Error('Choose a conversation for the follow-up');
    const task = await createTask({
      type: 'follow_up',
      conversationId,
      reason: String(input.reason || 'Owner requested follow-up').slice(0, 255),
      priority: Math.max(1, Math.min(9, Number(input.priority) || 2)),
      createdBy: actor,
    });
    await recordAiTrainingAudit(actor, 'ai_training.command_followup', 'staff_task', task.id, { conversation_id: conversationId });
    return { command, task, message: task.created ? 'Follow-up task created.' : 'An open follow-up task already exists.' };
  }
  if (command === 'request_inventory_review') {
    const task = await createTask({
      type: 'inventory_review',
      stockNo: String(input.stock_no || '').trim() || null,
      reason: String(input.reason || 'Owner requested inventory review').slice(0, 255),
      priority: Math.max(1, Math.min(9, Number(input.priority) || 3)),
      createdBy: actor,
    });
    await recordAiTrainingAudit(actor, 'ai_training.command_inventory_review', 'staff_task', task.id, { stock_no: input.stock_no || null });
    return { command, task, message: task.created ? 'Inventory review task created.' : 'An open inventory review task already exists.' };
  }
  throw new Error('Command is not allowed');
}

export async function mutateTrainingInstruction(action: string, input: any, actor: string) {
  const id = Number(input.id);
  if (!id) throw new Error('Instruction id is required');
  let result: any;
  if (action === 'approve') result = await (await import('./knowledge')).approveInstruction(id, actor);
  else if (action === 'deactivate') result = await deactivateInstruction(id, actor);
  else if (action === 'edit') result = await updateInstruction(id, input, actor, Boolean(input.activate));
  else if (action === 'revert') result = await (await import('./knowledge')).revertInstruction(id, actor);
  else if (action === 'delete') result = await deleteInstruction(id, actor);
  else throw new Error('Unknown instruction action');
  await recordAiTrainingAudit(actor, `ai_training.instruction_${action}`, 'ai_instruction', id, {});
  return result;
}

export function validateProposedInstruction(input: any) {
  if (!input?.title && !input?.content) return null;
  return normalizeInstruction(input);
}
