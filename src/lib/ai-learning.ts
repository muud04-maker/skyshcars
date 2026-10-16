/*
  Admin-approved AI learning (Parts 7-12).

  The AI never trains itself. A staff thumbs-down, a corrected reply or a referral correction creates
  a PENDING learning event. Only a human can approve it, and only an approved/applied lesson may
  influence future replies (as prompt context) or add global business knowledge. Rejected lessons are
  ignored forever.

  Two separate worlds (Part 12):
    - customer facts/memory  -> customer-facts.ts, private to ONE customer,
    - global knowledge       -> ai_knowledge (here via applyLearningEvent with type business_rule).
  A customer's private detail is never promoted to global knowledge automatically.
*/
import { db, one, rows } from './db';

export type LearningStatus = 'pending' | 'approved' | 'rejected' | 'applied';
export type LearningType =
  | 'wrong_vehicle' | 'wrong_price' | 'wrong_category' | 'wrong_language' | 'wrong_shipping_answer'
  | 'missing_information' | 'bad_tone' | 'referral_correction' | 'better_sales_reply'
  | 'business_rule' | 'unnecessary_hold' | 'bad_recommendation' | 'good_reply' | 'other';

export const LEARNING_TYPES: LearningType[] = [
  'wrong_vehicle', 'wrong_price', 'wrong_category', 'wrong_language', 'wrong_shipping_answer',
  'missing_information', 'bad_tone', 'referral_correction', 'better_sales_reply',
  'business_rule', 'unnecessary_hold', 'bad_recommendation', 'good_reply', 'other',
];

/** Reasons a staff member can pick on a thumbs-down (Part 10). */
export const LEARNING_REASONS = [
  'wrong vehicle', 'wrong facts', 'wrong language', 'poor answer', 'incomplete',
  'unnecessary hold', 'bad recommendation', 'other',
] as const;

const REASON_TO_TYPE: Record<string, LearningType> = {
  'wrong vehicle': 'wrong_vehicle',
  'wrong facts': 'wrong_price',
  'wrong language': 'wrong_language',
  'poor answer': 'bad_tone',
  'incomplete': 'missing_information',
  'unnecessary hold': 'unnecessary_hold',
  'bad recommendation': 'bad_recommendation',
  'other': 'other',
};

let ready: Promise<void> | null = null;
export function ensureAiLearningSchema() {
  if (!ready) ready = (async () => {
    await db().execute(`CREATE TABLE IF NOT EXISTS ai_learning_events (
      id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      conversation_id BIGINT UNSIGNED NULL,
      customer_id BIGINT UNSIGNED NULL,
      message_id BIGINT UNSIGNED NULL,
      question TEXT NULL,
      ai_reply TEXT NULL,
      correction TEXT NULL,
      event_type VARCHAR(60) NOT NULL DEFAULT 'other',
      reason VARCHAR(191) NULL,
      lesson TEXT NULL,
      applies_to ENUM('global','customer') NOT NULL DEFAULT 'global',
      payload JSON NULL,
      status ENUM('pending','approved','rejected','applied') NOT NULL DEFAULT 'pending',
      created_by VARCHAR(191) NULL,
      reviewed_by VARCHAR(191) NULL,
      reviewed_at DATETIME NULL,
      applied_at DATETIME NULL,
      applied_ref VARCHAR(191) NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_learning_status(status,created_at),
      INDEX idx_learning_customer(customer_id,created_at),
      INDEX idx_learning_type(event_type,status),
      INDEX idx_learning_conversation(conversation_id,created_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
  })().catch(e => { ready = null; throw e; });
  return ready;
}

// ---------------------------------------------------------------- pure helpers (testable)
/** A short human title for a lesson, used in the knowledge base and the admin cards. */
export function lessonTitle(type: string, subject?: string | null) {
  const label: Record<string, string> = {
    wrong_vehicle: 'Correct vehicle for a referral',
    wrong_price: 'Price correction',
    wrong_category: 'Vehicle category correction',
    wrong_language: 'Language correction',
    wrong_shipping_answer: 'Shipping answer correction',
    missing_information: 'Missing information the AI should give',
    bad_tone: 'Tone correction',
    referral_correction: 'Referral mapping correction',
    better_sales_reply: 'Better sales reply',
    business_rule: 'Business rule',
    unnecessary_hold: 'Hold was not needed',
    bad_recommendation: 'Recommendation correction',
    good_reply: 'Good reply example',
    other: 'AI lesson',
  };
  const base = label[String(type)] || label.other;
  const s = String(subject || '').replace(/\s+/g, ' ').trim().slice(0, 80);
  return s ? `${base}: ${s}` : base;
}

/** Only approved/applied lessons may influence replies. Pending and rejected never do. */
export function isUsableLesson(status: string) {
  return status === 'approved' || status === 'applied';
}

/** Which transitions an admin may make (guards the API against nonsense/injection). */
export function nextStatus(action: string, current: string): LearningStatus | null {
  const from = String(current || 'pending');
  if (action === 'approve') return from === 'pending' ? 'approved' : null;
  if (action === 'reject') return from === 'pending' || from === 'approved' ? 'rejected' : null;
  if (action === 'apply') return from === 'approved' || from === 'applied' ? 'applied' : null;
  if (action === 'reopen') return from === 'rejected' ? 'pending' : null;
  return null;
}

export function typeFromReason(reason: string): LearningType {
  return REASON_TO_TYPE[String(reason || '').toLowerCase()] || 'other';
}

// ---------------------------------------------------------------- storage
export async function recordLearningEvent(input: {
  conversationId?: number | null; customerId?: number | null; messageId?: number | null;
  question?: string | null; aiReply?: string | null; correction?: string | null;
  eventType?: string; reason?: string | null; lesson?: string | null;
  appliesTo?: 'global' | 'customer'; payload?: any; createdBy?: string | null; status?: LearningStatus;
}) {
  await ensureAiLearningSchema();
  const type = LEARNING_TYPES.includes(String(input.eventType) as LearningType) ? String(input.eventType) : 'other';
  const status: LearningStatus = input.status || 'pending';
  const [r]: any = await db().execute(
    `INSERT INTO ai_learning_events(conversation_id,customer_id,message_id,question,ai_reply,correction,event_type,reason,lesson,applies_to,payload,status,created_by)
     VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [input.conversationId || null, input.customerId || null, input.messageId || null,
     input.question ? String(input.question).slice(0, 4000) : null,
     input.aiReply ? String(input.aiReply).slice(0, 4000) : null,
     input.correction ? String(input.correction).slice(0, 4000) : null,
     type, input.reason ? String(input.reason).slice(0, 191) : null,
     input.lesson ? String(input.lesson).slice(0, 4000) : null,
     input.appliesTo === 'customer' ? 'customer' : 'global',
     input.payload ? JSON.stringify(input.payload).slice(0, 6000) : null,
     status, String(input.createdBy || 'admin').slice(0, 191)]);
  return { ok: true, id: Number(r?.insertId), status, event_type: type };
}

export async function listLearningEvents(filters: { status?: string; type?: string; q?: string; customerId?: number; limit?: number } = {}) {
  await ensureAiLearningSchema();
  const w: string[] = ['1=1']; const a: any[] = [];
  const status = String(filters.status || '').trim();
  if (['pending', 'approved', 'rejected', 'applied'].includes(status)) { w.push('e.status=?'); a.push(status); }
  const type = String(filters.type || '').trim();
  if (LEARNING_TYPES.includes(type as LearningType)) { w.push('e.event_type=?'); a.push(type); }
  if (filters.customerId) { w.push('e.customer_id=?'); a.push(Number(filters.customerId)); }
  const q = String(filters.q || '').trim();
  if (q) { w.push('(e.question LIKE ? OR e.ai_reply LIKE ? OR e.correction LIKE ? OR e.lesson LIKE ?)'); const like = `%${q}%`; a.push(like, like, like, like); }
  const limit = Math.max(1, Math.min(300, Number(filters.limit) || 60));
  return rows<any>(`SELECT e.*, cu.full_name customer_name, c.channel, c.external_user_id
    FROM ai_learning_events e
    LEFT JOIN customers cu ON cu.id=e.customer_id
    LEFT JOIN conversations c ON c.id=e.conversation_id
    WHERE ${w.join(' AND ')} ORDER BY (e.status='pending') DESC, e.id DESC LIMIT ${limit}`, a);
}

export async function learningEventById(id: number) {
  await ensureAiLearningSchema();
  return one<any>('SELECT * FROM ai_learning_events WHERE id=? LIMIT 1', [Number(id)]);
}

export async function learningStats() {
  await ensureAiLearningSchema();
  const r = await one<any>(`SELECT
      SUM(status='pending') pending, SUM(status='approved') approved,
      SUM(status='applied') applied, SUM(status='rejected') rejected, COUNT(*) total
    FROM ai_learning_events`).catch(() => null);
  return {
    pending: Number(r?.pending || 0), approved: Number(r?.approved || 0),
    applied: Number(r?.applied || 0), rejected: Number(r?.rejected || 0), total: Number(r?.total || 0),
  };
}

/** Approve / reject / reopen. An admin may also edit the lesson text while reviewing it. */
export async function reviewLearningEvent(id: number, action: 'approve' | 'reject' | 'reopen', opts: { lesson?: string | null; appliesTo?: 'global' | 'customer'; by?: string | null } = {}) {
  const ev: any = await learningEventById(id);
  if (!ev) throw new Error('Learning event not found');
  const status = nextStatus(action, ev.status);
  if (!status) throw new Error(`Cannot ${action} a ${ev.status} lesson`);
  const lesson = opts.lesson != null ? String(opts.lesson).slice(0, 4000) : ev.lesson;
  const appliesTo = opts.appliesTo === 'customer' || opts.appliesTo === 'global' ? opts.appliesTo : ev.applies_to;
  await db().execute('UPDATE ai_learning_events SET status=?, lesson=?, applies_to=?, reviewed_by=?, reviewed_at=NOW() WHERE id=?',
    [status, lesson || null, appliesTo, String(opts.by || 'admin').slice(0, 191), Number(id)]);
  return { ok: true, id: Number(id), status };
}

/**
 * Apply an approved lesson (Part 9). Depending on its type it becomes:
 *   referral_correction -> a saved referral mapping (deterministic, wins every time),
 *   business_rule       -> a global knowledge-base entry,
 *   anything else       -> prompt context for future replies (approved lessons).
 */
export async function applyLearningEvent(id: number, by?: string | null) {
  const ev: any = await learningEventById(id);
  if (!ev) throw new Error('Learning event not found');
  if (nextStatus('apply', ev.status) !== 'applied') throw new Error('Only an approved lesson can be applied');
  const payload = (() => { try { return ev.payload ? JSON.parse(ev.payload) : {}; } catch { return {}; } })();
  let ref = 'prompt_context';

  if (ev.event_type === 'referral_correction' && payload?.vehicle_id) {
    const { setReferralCorrection } = await import('./referrals');
    await setReferralCorrection({ channel: payload.channel || 'facebook', source_id: payload.source_id || null, source_url: payload.source_url || null, vehicle_id: Number(payload.vehicle_id) });
    ref = `referral_correction:${payload.source_id || payload.source_url || 'saved'}`;
  } else if (ev.event_type === 'business_rule' && ev.lesson) {
    const { ensureAiKnowledgeSchema } = await import('./knowledge');
    await ensureAiKnowledgeSchema();
    await db().execute(`INSERT INTO ai_knowledge(title,content,active,source) VALUES(?,?,1,'ai_learning')`,
      [lessonTitle(ev.event_type, ev.reason), String(ev.lesson).slice(0, 8000)]);
    ref = 'ai_knowledge';
  }

  await db().execute('UPDATE ai_learning_events SET status=\'applied\', applied_at=NOW(), applied_ref=?, reviewed_by=COALESCE(reviewed_by,?) WHERE id=?',
    [ref, String(by || 'admin').slice(0, 191), Number(id)]);
  return { ok: true, id: Number(id), status: 'applied', applied_ref: ref };
}

/**
 * Lessons the reply engine may use right now: approved/applied, global only, newest first, capped.
 * Customer-scoped lessons are never used for other customers.
 */
export async function approvedLessons(limit = 5) {
  try {
    await ensureAiLearningSchema();
    const n = Math.max(1, Math.min(20, Number(limit) || 5));
    return rows<any>(`SELECT id,event_type,lesson,reason,applied_ref FROM ai_learning_events
      WHERE status IN ('approved','applied') AND applies_to='global' AND COALESCE(lesson,'')<>''
      ORDER BY (status='applied') DESC, id DESC LIMIT ${n}`);
  } catch { return []; }
}

/** One-line prompt note built from approved lessons (Part 13 step 9). */
export function lessonsNote(lessons: { event_type?: string; lesson?: string | null }[] = []) {
  const usable = (lessons || []).filter((l) => String(l?.lesson || '').trim());
  if (!usable.length) return '';
  return ` APPROVED LESSONS (decided by our staff - follow them): ${usable.map((l) => String(l.lesson).replace(/\s+/g, ' ').trim().slice(0, 300)).join(' | ')}.`;
}
