/*
  Human shadow learning (GOAL 4).

  Whenever a person answers a customer we compare what they did with what the AI did:
    customer question -> AI reply (if any) -> human reply, plus the current and referral vehicle.
  If the human materially differs, we record a PENDING learning candidate. Nothing becomes a global
  rule here - a lesson must still be approved (and applied) by an admin.

  Same customer, same chat: the human answer is immediately usable as context (we keep it as
  customer-scoped guidance, never as a global rule).
  Other customers: nothing is generalised automatically.
*/
import { one, rows } from './db';
import { recordLearningEvent } from './ai-learning';
import { looksSensitive, saveFacts } from './customer-facts';
import { isHumanVehicleSource, lastHumanVehicleSelection } from './vehicle-events';

export type CompareInput = {
  question?: string | null; aiReply?: string | null; humanReply?: string | null;
  aiVehicle?: { id?: any; stock_no?: any; brand?: any; model?: any } | null;
  humanVehicle?: { id?: any; stock_no?: any; brand?: any; model?: any } | null;
  channel?: string | null;
};
export type CompareResult = { differs: boolean; eventType: string; reasons: string[]; evidence: string };

const normal = (v: unknown) => String(v == null ? '' : v).toLowerCase().replace(/https?:\/\/\S+/g, ' ').replace(/[^\p{L}\p{N}\s$]/gu, ' ').replace(/\s+/g, ' ').trim();
const tokens = (v: unknown) => normal(v).split(' ').filter((t) => t.length >= 3);
const amounts = (v: unknown) => [...String(v || '').matchAll(/\$?\s?(\d[\d,]{2,})/g)].map((m) => Number(String(m[1]).replace(/,/g, ''))).filter((n) => n >= 100);
const HOLD = /\b(let me confirm|one moment|checking now|will confirm|team will|i will check)\b/i;
const SHIPPING = /\b(ship|shipping|deliver|delivery|freight|port|clearance|customs)\b/i;
/** Cheap script test: enough to notice "the AI answered in the wrong alphabet". */
function script(v: unknown) {
  const s = String(v || '');
  if (/[\u0600-\u06FF]/.test(s)) return 'ar';
  if (/[\u4e00-\u9fff]/.test(s)) return 'zh';
  if (/[\u0400-\u04FF]/.test(s)) return 'ru';
  return 'latin';
}
function overlap(a: unknown, b: unknown) {
  const A = new Set(tokens(a)), B = new Set(tokens(b));
  if (!A.size || !B.size) return 0;
  let hit = 0;
  for (const t of A) if (B.has(t)) hit++;
  return hit / Math.max(A.size, B.size);
}

/**
 * Does the human answer materially differ from the AI's? Pure + testable.
 * Every difference carries the reason so the admin can see WHY it was flagged.
 */
export function compareHumanAndAi(input: CompareInput): CompareResult {
  const human = String(input.humanReply || '').trim();
  const ai = String(input.aiReply || '').trim();
  const reasons: string[] = [];
  if (!human) return { differs: false, eventType: 'other', reasons, evidence: 'no human reply' };

  const aiV = input.aiVehicle?.id ? input.aiVehicle : null;
  const humanV = input.humanVehicle?.id ? input.humanVehicle : null;
  if (aiV && humanV && Number(aiV.id) !== Number(humanV.id)) {
    reasons.push(`vehicle changed from ${[aiV.brand, aiV.model].filter(Boolean).join(' ') || `#${aiV.id}`} to ${[humanV.brand, humanV.model].filter(Boolean).join(' ') || `#${humanV.id}`}`);
    return { differs: true, eventType: 'wrong_vehicle', reasons, evidence: 'human selected a different vehicle' };
  }
  if (aiV && !humanV && input.question && tokens(human).some((t) => [aiV.brand, aiV.model].map(normal).join(' ').includes(t))) {
    reasons.push('human re-confirmed the same vehicle');
  }

  const aiAmounts = amounts(ai), humanAmounts = amounts(human);
  if (aiAmounts.length && humanAmounts.length) {
    const same = aiAmounts.some((n) => humanAmounts.includes(n));
    if (!same) { reasons.push(`different amount (AI ${aiAmounts[0]} vs human ${humanAmounts[0]})`); return { differs: true, eventType: 'wrong_price', reasons, evidence: 'money amounts disagree' }; }
  }

  if (script(ai) !== script(human) && ai.length > 3 && human.length > 3) {
    reasons.push(`language/script changed (${script(ai)} -> ${script(human)})`);
    return { differs: true, eventType: 'wrong_language', reasons, evidence: 'the customer was answered in a different script' };
  }

  if (HOLD.test(ai) && !HOLD.test(human) && human.length >= 12) {
    reasons.push('AI held the customer, the human answered');
    return { differs: true, eventType: 'unnecessary_hold', reasons, evidence: 'a real answer was possible' };
  }
  if (SHIPPING.test(human) && !SHIPPING.test(ai)) reasons.push('human added shipping information');

  if (input.aiReply && !input.aiReply.trim()) {
    reasons.push('the AI had not answered yet');
    return { differs: human.length >= 12, eventType: 'better_sales_reply', reasons, evidence: 'human answered first' };
  }

  const sim = overlap(ai, human);
  if (ai && sim < 0.34) {
    reasons.push(`materially different wording (overlap ${Math.round(sim * 100)}%)`);
    return { differs: true, eventType: 'better_sales_reply', reasons, evidence: 'the human reply says something different' };
  }

  return { differs: false, eventType: 'other', reasons, evidence: reasons.join('; ') || 'similar answers' };
}

/** Would this person's answer be a better answer? Used to keep the lesson text honest. */
export function lessonFromComparison(result: CompareResult, input: CompareInput) {
  const q = String(input.question || '').replace(/\s+/g, ' ').trim().slice(0, 160);
  const human = String(input.humanReply || '').replace(/\s+/g, ' ').trim().slice(0, 240);
  const head = q ? `When a customer asks "${q}", ` : 'For this customer, ';
  const tail: Record<string, string> = {
    wrong_vehicle: 'answer about the vehicle the customer is really asking about (match the vehicle first).',
    wrong_price: 'use the exact price from the record; never a different amount.',
    wrong_language: 'answer in the customer\'s own language and script.',
    wrong_shipping_answer: 'give the shipping answer the team confirmed.',
    unnecessary_hold: 'answer the question directly instead of holding when the facts are available.',
    missing_information: 'include the missing detail.',
    better_sales_reply: 'reply the way the team replied.',
  };
  return `${head}${tail[result.eventType] || 'follow the team\'s answer.'} Team answer: "${human}"`;
}

/**
 * Look at the answer a person just sent and, if it materially differs from the AI's, queue a learning
 * candidate. Returns what happened (used by the API response + tests).
 */
export async function recordHumanShadowLearning(input: {
  conversationId: number; humanMessageId?: number | null; humanReply: string; by?: string | null;
}) {
  const conversationId = Number(input.conversationId);
  if (!conversationId) return { recorded: false, reason: 'no_conversation' };
  try {
    const humanId = Number(input.humanMessageId) || 0;
    // Already reviewed this exact human message? Never create a second candidate.
    if (humanId) {
      const dup = await one<any>(`SELECT id FROM ai_learning_events WHERE message_id=? LIMIT 1`, [humanId]).catch(() => null);
      if (dup?.id) return { recorded: false, reason: 'already_recorded' };
    }
    const [aiRow, questionRow, conv, humanSel] = await Promise.all([
      one<any>(`SELECT id,body FROM messages WHERE conversation_id=? AND sender='ai' AND direction='outbound' ORDER BY id DESC LIMIT 1`, [conversationId]).catch(() => null),
      one<any>(`SELECT id,body FROM messages WHERE conversation_id=? AND sender='customer' AND direction='inbound' ORDER BY id DESC LIMIT 1`, [conversationId]).catch(() => null),
      one<any>(`SELECT id,customer_id,channel FROM conversations WHERE id=? LIMIT 1`, [conversationId]).catch(() => null),
      lastHumanVehicleSelection(conversationId).catch(() => null),
    ]);
    const state = await one<any>(`SELECT current_vehicle_id,current_vehicle_source FROM conversation_state WHERE conversation_id=? LIMIT 1`, [conversationId]).catch(() => null);
    const aiVehicleId = state?.current_vehicle_id ? Number(state.current_vehicle_id) : null;
    const humanVehicleId = humanSel?.vehicle_id ? Number(humanSel.vehicle_id) : null;
    const vehicleIds = [aiVehicleId, humanVehicleId].filter(Boolean) as number[];
    const vehicles = vehicleIds.length
      ? await rows<any>(`SELECT id,stock_no,brand,model FROM vehicles WHERE id IN (${vehicleIds.map(() => '?').join(',')})`, vehicleIds).catch(() => [])
      : [];
    const pick = (id: number | null) => (id ? vehicles.find((v: any) => Number(v.id) === id) || { id } : null);

    const comparison = compareHumanAndAi({
      question: questionRow?.body || null, aiReply: aiRow?.body || null, humanReply: input.humanReply,
      aiVehicle: pick(isHumanVehicleSource(state?.current_vehicle_source) ? null : aiVehicleId),
      humanVehicle: pick(humanVehicleId),
      channel: conv?.channel || null,
    });
    // Same customer, same chat: the human answer becomes usable context straight away.
    if (conv?.customer_id && !looksSensitive(input.humanReply)) {
      await saveFacts(Number(conv.customer_id), [{ fact_key: 'last_human_guidance', fact_value: String(input.humanReply).replace(/\s+/g, ' ').slice(0, 250), confidence: 1, evidence: 'staff reply' }],
        { source: 'staff', sourceMessageId: humanId || null, changedBy: input.by || 'staff' }).catch(() => {});
    }
    if (!comparison.differs) return { recorded: false, reason: 'no_material_difference', comparison };

    const out = await recordLearningEvent({
      conversationId, customerId: conv?.customer_id ? Number(conv.customer_id) : null,
      messageId: humanId || null,
      question: questionRow?.body || null, aiReply: aiRow?.body || null, correction: String(input.humanReply).slice(0, 4000),
      eventType: comparison.eventType,
      reason: `human shadow: ${comparison.reasons.join('; ')}`.slice(0, 191),
      lesson: lessonFromComparison(comparison, { question: questionRow?.body || null, humanReply: input.humanReply, aiReply: aiRow?.body || null }),
      appliesTo: 'global',
      payload: { channel: conv?.channel || null, ai_vehicle_id: aiVehicleId, human_vehicle_id: humanVehicleId, source: 'shadow_learning' },
      createdBy: input.by || 'staff',
    });
    return { recorded: true, comparison, learning: out };
  } catch (e: any) {
    console.error('SHADOW_LEARNING', e);
    return { recorded: false, reason: String(e?.message || e) };
  }
}

/** Staff switched the chat to a different vehicle than the AI had: that is a learning signal too. */
export async function recordHumanVehicleChange(input: {
  conversationId: number; previousVehicleId?: number | null; vehicleId: number; by?: string | null;
}) {
  const conversationId = Number(input.conversationId);
  const previous = input.previousVehicleId ? Number(input.previousVehicleId) : null;
  if (!conversationId || !input.vehicleId || previous === Number(input.vehicleId)) return { recorded: false };
  try {
    const conv = await one<any>('SELECT customer_id,channel FROM conversations WHERE id=? LIMIT 1', [conversationId]).catch(() => null);
    const ids = [previous, Number(input.vehicleId)].filter(Boolean) as number[];
    const vehicles = await rows<any>(`SELECT id,stock_no,brand,model FROM vehicles WHERE id IN (${ids.map(() => '?').join(',')})`, ids).catch(() => []);
    const name = (id: number | null) => { const v = vehicles.find((x: any) => Number(x.id) === id); return v ? [v.brand, v.model].filter(Boolean).join(' ') || v.stock_no : (id ? `#${id}` : 'none'); };
    const lastAi = await one<any>(`SELECT body FROM messages WHERE conversation_id=? AND sender='ai' AND direction='outbound' ORDER BY id DESC LIMIT 1`, [conversationId]).catch(() => null);
    const question = await one<any>(`SELECT body FROM messages WHERE conversation_id=? AND sender='customer' AND direction='inbound' ORDER BY id DESC LIMIT 1`, [conversationId]).catch(() => null);
    const out = await recordLearningEvent({
      conversationId, customerId: conv?.customer_id ? Number(conv.customer_id) : null,
      question: question?.body || null, aiReply: lastAi?.body || null,
      correction: `Staff switched the chat to ${name(Number(input.vehicleId))}`,
      eventType: 'wrong_vehicle',
      reason: `human selected a different vehicle (was ${name(previous)})`.slice(0, 191),
      lesson: `The vehicle for this conversation was corrected from ${name(previous)} to ${name(Number(input.vehicleId))}; match the vehicle the customer is really asking about before quoting.`,
      payload: { channel: conv?.channel || null, ai_vehicle_id: previous, human_vehicle_id: Number(input.vehicleId), source: 'shadow_learning' },
      createdBy: input.by || 'staff',
    });
    return { recorded: true, learning: out };
  } catch (e: any) {
    return { recorded: false, reason: String(e?.message || e) };
  }
}
