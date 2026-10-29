/*
  One auditable staff workflow (brief priority 5, items 57/58/87-89/96-98/104-105).

  Customers ask for things only a human can finish: real photos of a specific unit, a freight quotation,
  sourcing a unit we don't stock, or a serious buyer who needs payment/inspection details. Until now that
  was a chat flag - no queue, no owner, no completion state. This is ONE additive table for all of them,
  deduplicated per (type, conversation, stock), with a real status a human moves forward.

  Nothing here invents data: a task names the stock/reason it came from, and completion is only ever set
  by a staff action.
*/
import { db, one, rows } from './db';

export const TASK_TYPES = ['photo', 'freight', 'sourcing', 'follow_up', 'serious_buyer', 'inventory_review'] as const;
export type TaskType = (typeof TASK_TYPES)[number];
export const TASK_STATUSES = ['pending', 'in_progress', 'done', 'declined'] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];
export const TASK_LABEL: Record<string, string> = {
  photo: 'Photos requested', freight: 'Freight quote', sourcing: 'Source a vehicle',
  follow_up: 'Follow up', serious_buyer: 'Serious buyer', inventory_review: 'Inventory review',
};

let ready: Promise<void> | null = null;
export function ensureStaffTasksSchema() {
  if (!ready) ready = db().execute(`CREATE TABLE IF NOT EXISTS staff_tasks (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    request_type VARCHAR(40) NOT NULL,
    dedupe_key VARCHAR(191) NULL,
    conversation_id BIGINT UNSIGNED NULL,
    customer_id BIGINT UNSIGNED NULL,
    vehicle_id BIGINT UNSIGNED NULL,
    stock_no VARCHAR(60) NULL,
    reason VARCHAR(255) NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'pending',
    priority TINYINT NOT NULL DEFAULT 5,
    notes TEXT NULL,
    created_by VARCHAR(191) NULL,
    handled_by VARCHAR(191) NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    completed_at DATETIME NULL,
    UNIQUE KEY uq_task_dedupe(dedupe_key),
    INDEX idx_task_status(status,priority,created_at),
    INDEX idx_task_type(request_type,status),
    INDEX idx_task_conversation(conversation_id,created_at),
    INDEX idx_task_customer(customer_id,created_at)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`).then(() => undefined).catch(e => { ready = null; throw e; });
  return ready;
}

/** Deterministic dedupe key: the same open request is never queued twice. PURE + testable. */
export function taskKey(type: string, conversationId?: number | null, stockNo?: string | null) {
  const t = TASK_TYPES.includes(String(type) as TaskType) ? String(type) : 'follow_up';
  const c = Number(conversationId) || 0;
  const s = String(stockNo || '').trim().toUpperCase();
  return c || s ? `${t}:${c}:${s}` : null;
}

export function normalizeTaskStatus(v: unknown) {
  const s = String(v || '').toLowerCase();
  return (TASK_STATUSES as readonly string[]).includes(s) ? s as TaskStatus : 'pending';
}

/** Create (or silently keep) one open request. Returns the task id and whether it was new. */
export async function createTask(input: {
  type: string; conversationId?: number | null; customerId?: number | null; vehicleId?: number | null;
  stockNo?: string | null; reason?: string | null; priority?: number; createdBy?: string | null;
}) {
  await ensureStaffTasksSchema();
  const type = TASK_TYPES.includes(String(input.type) as TaskType) ? String(input.type) : 'follow_up';
  const key = taskKey(type, input.conversationId, input.stockNo);
  try {
    const [r]: any = await db().execute(
      `INSERT INTO staff_tasks(request_type,dedupe_key,conversation_id,customer_id,vehicle_id,stock_no,reason,priority,created_by)
       VALUES(?,?,?,?,?,?,?,?,?)`,
      [type, key, input.conversationId || null, input.customerId || null, input.vehicleId || null,
       input.stockNo ? String(input.stockNo).slice(0, 60) : null, input.reason ? String(input.reason).slice(0, 255) : null,
       Math.max(1, Math.min(9, Number(input.priority) || 5)), String(input.createdBy || 'ai').slice(0, 191)]);
    if (Number(r?.affectedRows) === 1) return { ok: true, id: Number(r.insertId), created: true };
  } catch (e: any) {
    if (e?.code !== 'ER_DUP_ENTRY') console.error('STAFF_TASK_CREATE', e?.code || e?.message);
  }
  const existing: any = key ? await one<any>('SELECT id FROM staff_tasks WHERE dedupe_key=? LIMIT 1', [key]).catch(() => null) : null;
  return { ok: true, id: existing?.id ? Number(existing.id) : null, created: false };
}

export async function listTasks(filters: { status?: string; type?: string; limit?: number } = {}) {
  await ensureStaffTasksSchema();
  const w: string[] = ['1=1']; const a: any[] = [];
  const status = normalizeTaskStatus(filters.status);
  if (filters.status && filters.status !== 'all') { w.push('t.status=?'); a.push(status); }
  if (filters.type && (TASK_TYPES as readonly string[]).includes(String(filters.type))) { w.push('t.request_type=?'); a.push(String(filters.type)); }
  const limit = Math.max(1, Math.min(300, Number(filters.limit) || 100));
  return rows<any>(`SELECT t.*, cu.full_name customer_name, c.channel, v.brand, v.model, v.model_year
    FROM staff_tasks t
    LEFT JOIN customers cu ON cu.id=t.customer_id
    LEFT JOIN conversations c ON c.id=t.conversation_id
    LEFT JOIN vehicles v ON v.id=t.vehicle_id
    WHERE ${w.join(' AND ')} ORDER BY (t.status='pending') DESC, t.priority ASC, t.id DESC LIMIT ${limit}`, a).catch(() => []);
}

export async function taskStats() {
  await ensureStaffTasksSchema();
  const r = await one<any>(`SELECT
      SUM(status='pending') pending, SUM(status='in_progress') in_progress,
      SUM(status='done') done, SUM(status='declined') declined, COUNT(*) total,
      SUM(request_type='photo' AND status IN ('pending','in_progress')) photos_open,
      SUM(request_type='freight' AND status IN ('pending','in_progress')) freight_open,
      SUM(request_type='sourcing' AND status IN ('pending','in_progress')) sourcing_open,
      SUM(request_type='inventory_review' AND status IN ('pending','in_progress')) inventory_reviews_open
    FROM staff_tasks`).catch(() => null);
  return {
    pending: Number(r?.pending || 0), in_progress: Number(r?.in_progress || 0),
    done: Number(r?.done || 0), declined: Number(r?.declined || 0), total: Number(r?.total || 0),
    photos_open: Number(r?.photos_open || 0), freight_open: Number(r?.freight_open || 0), sourcing_open: Number(r?.sourcing_open || 0),
    inventory_reviews_open: Number(r?.inventory_reviews_open || 0),
  };
}

/**
 * Move a task forward. Completing or declining releases the dedupe key so a genuinely new request from
 * the same chat can be queued later (brief: avoid duplicates without losing new work).
 */
export async function updateTask(id: number, action: string, opts: { by?: string | null; notes?: string | null } = {}) {
  await ensureStaffTasksSchema();
  const status = action === 'start' ? 'in_progress' : action === 'done' ? 'done' : action === 'decline' ? 'declined' : action === 'reopen' ? 'pending' : null;
  if (!status) throw new Error('Unknown task action');
  const closed = status === 'done' || status === 'declined';
  const [r]: any = await db().execute(
    `UPDATE staff_tasks SET status=?, notes=COALESCE(?,notes), handled_by=?, completed_at=${closed ? 'NOW()' : 'NULL'}, dedupe_key=${closed ? 'NULL' : 'dedupe_key'} WHERE id=?`,
    [status, opts.notes ? String(opts.notes).slice(0, 4000) : null, String(opts.by || 'admin').slice(0, 191), Number(id)]);
  return { ok: true, id: Number(id), status, changed: Number(r?.affectedRows || 0) };
}
