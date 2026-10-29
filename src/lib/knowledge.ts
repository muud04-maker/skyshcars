import { db, one, rows } from './db';

export const INSTRUCTION_SCOPES = [
  'general', 'communication', 'sales', 'inventory', 'photos', 'pricing',
  'shipping', 'follow_up', 'whatsapp', 'language', 'takeover', 'faq',
] as const;
export type InstructionScope = (typeof INSTRUCTION_SCOPES)[number];
export type InstructionStatus = 'draft' | 'approved' | 'inactive';

export type InstructionInput = {
  title?: unknown;
  content?: unknown;
  scope?: unknown;
  priority?: unknown;
};

let ready: Promise<void> | null = null;

/** Additive, idempotent schema for owner-approved runtime instructions. Existing ai_knowledge rows remain usable. */
export function ensureAiKnowledgeSchema() {
  if (!ready) ready = (async () => {
    await db().execute(`CREATE TABLE IF NOT EXISTS ai_knowledge (
      id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      title VARCHAR(191) NOT NULL,
      content TEXT NOT NULL,
      active BOOLEAN DEFAULT TRUE,
      source VARCHAR(80) DEFAULT 'admin',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX(active), INDEX(updated_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
    for (const sql of [
      `ALTER TABLE ai_knowledge ADD COLUMN scope VARCHAR(40) NOT NULL DEFAULT 'general'`,
      `ALTER TABLE ai_knowledge ADD COLUMN version INT UNSIGNED NOT NULL DEFAULT 1`,
      `ALTER TABLE ai_knowledge ADD COLUMN status ENUM('draft','approved','inactive') NOT NULL DEFAULT 'approved'`,
      `ALTER TABLE ai_knowledge ADD COLUMN priority TINYINT UNSIGNED NOT NULL DEFAULT 5`,
      `ALTER TABLE ai_knowledge ADD COLUMN created_by VARCHAR(191) NULL`,
      `ALTER TABLE ai_knowledge ADD COLUMN updated_by VARCHAR(191) NULL`,
      `ALTER TABLE ai_knowledge ADD COLUMN approved_by VARCHAR(191) NULL`,
      `ALTER TABLE ai_knowledge ADD COLUMN approved_at DATETIME NULL`,
      `ALTER TABLE ai_knowledge ADD INDEX idx_knowledge_status(status,active,priority,updated_at)`,
    ]) {
      try { await db().execute(sql); } catch (e: any) {
        if (e?.code !== 'ER_DUP_FIELDNAME' && e?.code !== 'ER_DUP_KEYNAME') throw e;
      }
    }
    await db().execute(`CREATE TABLE IF NOT EXISTS ai_instruction_history (
      id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      instruction_id BIGINT UNSIGNED NOT NULL,
      version INT UNSIGNED NOT NULL,
      action VARCHAR(40) NOT NULL,
      snapshot JSON NOT NULL,
      actor VARCHAR(191) NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      INDEX(instruction_id,created_at), INDEX(action,created_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
    // Existing active instructions were reviewed by an administrator before this schema upgrade.
    await db().execute(`UPDATE ai_knowledge SET status=IF(active=1,'approved','inactive'),
      created_by=COALESCE(created_by,source,'admin'), updated_by=COALESCE(updated_by,source,'admin'),
      approved_by=COALESCE(approved_by,'legacy admin'), approved_at=COALESCE(approved_at,updated_at)
      WHERE approved_at IS NULL AND status='approved'`);
  })().catch((e) => { ready = null; throw e; });
  return ready;
}

const clean = (value: unknown, max: number) => String(value ?? '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').trim().slice(0, max);

/** Reject command-style prompt injection while allowing normal business instructions. */
export function instructionSafetyError(text: string): string | null {
  const value = String(text || '');
  const checks: [RegExp, string][] = [
    [/\b(ignore|disregard|override)\s+(all\s+)?(previous|prior|system|developer)\b/i, 'prompt-injection wording'],
    [/\b(system|developer)\s+(prompt|message)\b/i, 'requests about hidden system instructions'],
    [/\b(reveal|print|show|expose|return)\b.{0,50}\b(api[_ -]?key|password|secret|credential|token)\b/i, 'requests for secrets'],
    [/\b(run|execute)\b.{0,35}\b(shell|terminal|command|powershell|bash|sql)\b/i, 'requests to execute commands'],
    [/\b(drop|truncate|alter)\b.{0,25}\b(database|table|schema)\b/i, 'destructive database commands'],
    [/-----BEGIN [A-Z ]*PRIVATE KEY-----/i, 'private-key material'],
  ];
  for (const [pattern, reason] of checks) if (pattern.test(value)) return `Instruction rejected: ${reason}.`;
  return null;
}

export function normalizeInstruction(input: InstructionInput) {
  const title = clean(input.title, 191);
  const content = clean(input.content, 8000);
  const scope = INSTRUCTION_SCOPES.includes(String(input.scope || 'general') as InstructionScope)
    ? String(input.scope || 'general') as InstructionScope : 'general';
  const priority = Math.max(1, Math.min(9, Number(input.priority) || 5));
  if (!title || !content) throw new Error('Instruction title and content are required');
  const unsafe = instructionSafetyError(`${title}\n${content}`);
  if (unsafe) throw new Error(unsafe);
  return { title, content, scope, priority };
}

function snapshot(row: any) {
  return JSON.stringify({
    title: row.title, content: row.content, scope: row.scope || 'general',
    version: Number(row.version || 1), status: row.status || 'approved',
    priority: Number(row.priority || 5), active: !!row.active,
  }).slice(0, 16000);
}

async function history(instructionId: number, version: number, action: string, actor: string, data: any) {
  await db().execute(
    `INSERT INTO ai_instruction_history(instruction_id,version,action,snapshot,actor) VALUES(?,?,?,?,?)`,
    [Number(instructionId), Math.max(1, Number(version) || 1), action.slice(0, 40), snapshot(data), actor.slice(0, 191)]
  );
}

export async function recordAiTrainingAudit(actor: string, action: string, entityType: string, entityId: unknown, details: any) {
  await db().execute(
    `INSERT INTO audit_logs(actor,action,entity_type,entity_id,details) VALUES(?,?,?,?,?)`,
    [actor.slice(0, 191), action.slice(0, 191), entityType.slice(0, 80), entityId == null ? null : String(entityId).slice(0, 191),
      JSON.stringify(details || {}).slice(0, 8000)]
  );
}

export async function createInstruction(input: InstructionInput, actor: string, approve = false) {
  await ensureAiKnowledgeSchema();
  const v = normalizeInstruction(input);
  const status: InstructionStatus = approve ? 'approved' : 'draft';
  const [r]: any = await db().execute(
    `INSERT INTO ai_knowledge(title,content,active,source,scope,version,status,priority,created_by,updated_by,approved_by,approved_at)
     VALUES(?,?,?,?,?,1,?,?,?,?,?,?)`,
    [v.title, v.content, approve ? 1 : 0, 'ai_training_center', v.scope, status, v.priority,
      actor, actor, approve ? actor : null, approve ? new Date() : null]
  );
  const row = await instructionById(Number(r.insertId));
  await history(Number(r.insertId), 1, approve ? 'created_approved' : 'created_draft', actor, row);
  await recordAiTrainingAudit(actor, approve ? 'ai_instruction.approved_create' : 'ai_instruction.draft_create', 'ai_instruction', r.insertId, v);
  return row;
}

export async function instructionById(id: number) {
  await ensureAiKnowledgeSchema();
  return one<any>('SELECT * FROM ai_knowledge WHERE id=? LIMIT 1', [Number(id)]);
}

export async function listInstructions(limit = 200) {
  await ensureAiKnowledgeSchema();
  const n = Math.max(1, Math.min(500, Number(limit) || 200));
  return rows<any>(`SELECT * FROM ai_knowledge ORDER BY (status='approved' AND active=1) DESC, priority DESC, updated_at DESC LIMIT ${n}`);
}

export async function listInstructionHistory(instructionId?: number) {
  await ensureAiKnowledgeSchema();
  const id = Number(instructionId || 0);
  return rows<any>(`SELECT * FROM ai_instruction_history ${id ? 'WHERE instruction_id=?' : ''} ORDER BY id DESC LIMIT 600`, id ? [id] : []);
}

export async function approveInstruction(id: number, actor: string) {
  const current: any = await instructionById(id);
  if (!current) throw new Error('Instruction not found');
  const nextVersion = Math.max(1, Number(current.version || 1));
  await db().execute(`UPDATE ai_knowledge SET active=1,status='approved',approved_by=?,approved_at=NOW(),updated_by=? WHERE id=?`, [actor, actor, Number(id)]);
  const row = await instructionById(id);
  await history(Number(id), nextVersion, 'approved', actor, row);
  await recordAiTrainingAudit(actor, 'ai_instruction.activate', 'ai_instruction', id, { previous_status: current.status, version: nextVersion });
  return row;
}

export async function deactivateInstruction(id: number, actor: string) {
  const current: any = await instructionById(id);
  if (!current) throw new Error('Instruction not found');
  await db().execute(`UPDATE ai_knowledge SET active=0,status='inactive',updated_by=? WHERE id=?`, [actor, Number(id)]);
  const row = await instructionById(id);
  await history(Number(id), Number(current.version || 1), 'deactivated', actor, row);
  await recordAiTrainingAudit(actor, 'ai_instruction.deactivate', 'ai_instruction', id, {});
  return row;
}

export async function updateInstruction(id: number, input: InstructionInput, actor: string, approve = false) {
  const current: any = await instructionById(id);
  if (!current) throw new Error('Instruction not found');
  const v = normalizeInstruction({ ...current, ...input });
  const nextVersion = Math.max(1, Number(current.version || 1)) + 1;
  const status: InstructionStatus = approve ? 'approved' : 'draft';
  await db().execute(
    `UPDATE ai_knowledge SET title=?,content=?,scope=?,priority=?,version=?,status=?,active=?,updated_by=?,
      approved_by=IF(?=1,?,approved_by),approved_at=IF(?=1,NOW(),approved_at) WHERE id=?`,
    [v.title, v.content, v.scope, v.priority, nextVersion, status, approve ? 1 : 0, actor, approve ? 1 : 0, actor, approve ? 1 : 0, Number(id)]
  );
  const row = await instructionById(id);
  await history(Number(id), nextVersion, approve ? 'edited_approved' : 'edited_draft', actor, row);
  await recordAiTrainingAudit(actor, approve ? 'ai_instruction.update_approved' : 'ai_instruction.update_draft', 'ai_instruction', id,
    { previous_version: current.version, version: nextVersion, scope: v.scope });
  return row;
}

export async function revertInstruction(id: number, actor: string) {
  const current: any = await instructionById(id);
  if (!current) throw new Error('Instruction not found');
  const previous: any = await one<any>(`SELECT snapshot FROM ai_instruction_history
    WHERE instruction_id=? AND version<? ORDER BY id DESC LIMIT 1`, [Number(id), Number(current.version || 1)]);
  if (!previous?.snapshot) throw new Error('No earlier version is available');
  const snap = typeof previous.snapshot === 'string' ? JSON.parse(previous.snapshot) : previous.snapshot;
  const v = normalizeInstruction(snap);
  const nextVersion = Number(current.version || 1) + 1;
  await db().execute(`UPDATE ai_knowledge SET title=?,content=?,scope=?,priority=?,version=?,status='approved',active=1,updated_by=?,approved_by=?,approved_at=NOW() WHERE id=?`,
    [v.title, v.content, v.scope, v.priority, nextVersion, actor, actor, Number(id)]);
  const row = await instructionById(id);
  await history(Number(id), nextVersion, 'reverted', actor, row);
  await recordAiTrainingAudit(actor, 'ai_instruction.revert', 'ai_instruction', id, { from_version: current.version, to_version: nextVersion });
  return row;
}

/** Soft-delete keeps the instruction and full history available for audit while removing it from AI runtime. */
export async function deleteInstruction(id: number, actor: string) {
  const current: any = await instructionById(id);
  if (!current) throw new Error('Instruction not found');
  await db().execute(`UPDATE ai_knowledge SET active=0,status='inactive',updated_by=? WHERE id=?`, [actor, Number(id)]);
  await history(Number(id), Number(current.version || 1), 'deleted_soft', actor, { ...current, active: 0, status: 'inactive' });
  await recordAiTrainingAudit(actor, 'ai_instruction.delete_soft', 'ai_instruction', id, { retained_for_audit: true });
  return { ok: true, id: Number(id), status: 'inactive', retained_for_audit: true };
}

const relevanceTokens = (text: string) => new Set(String(text || '').toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ').split(/\s+/).filter((x) => x.length > 2));
function inferredScopes(query: string) {
  const q = String(query || '').toLowerCase();
  const out = new Set<string>();
  if (/\b(photo|picture|image)\b/.test(q)) out.add('photos');
  if (/\b(price|cost|discount|payment|pay)\b/.test(q)) out.add('pricing');
  if (/\b(ship|freight|port|country|delivery)\b/.test(q)) out.add('shipping');
  if (/\b(hello|reply|follow|message|whatsapp)\b/.test(q)) out.add('whatsapp');
  if (/\b(english|somali|arabic|chinese|french|language)\b/.test(q)) out.add('language');
  if (/\b(stock|vehicle|car|motorcycle|available)\b/.test(q)) out.add('inventory');
  return out;
}

/** Bounded retrieval: relevant approved instructions first, then global/priority guidance. */
export async function activeKnowledge(limit = 50, query = '') {
  await ensureAiKnowledgeSchema();
  const maxItems = Math.max(1, Math.min(20, Number(limit) || 12));
  const all = await rows<any>(`SELECT id,title,content,scope,version,priority FROM ai_knowledge
    WHERE active=1 AND status='approved' ORDER BY priority DESC,updated_at DESC LIMIT 150`);
  const qTokens = relevanceTokens(query);
  const scopes = inferredScopes(query);
  const ranked = all.map((item) => {
    const tokens = relevanceTokens(`${item.title} ${item.content}`);
    let overlap = 0;
    for (const token of qTokens) if (tokens.has(token)) overlap++;
    const scope = String(item.scope || 'general');
    const score = Number(item.priority || 5) * 4 + (scopes.has(scope) ? 60 : 0) + (scope === 'general' ? 12 : 0) + overlap * 7;
    return { ...item, relevance: Math.min(100, score) };
  }).sort((a, b) => b.relevance - a.relevance || Number(b.priority || 5) - Number(a.priority || 5));
  const selected: any[] = [];
  let chars = 0;
  for (const item of ranked) {
    const content = clean(item.content, 900);
    if (!content || chars + content.length > 9000) continue;
    selected.push({ ...item, content });
    chars += content.length;
    if (selected.length >= maxItems) break;
  }
  return selected;
}
