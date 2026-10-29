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
  | 'business_rule' | 'unnecessary_hold' | 'bad_recommendation' | 'good_reply'
  | 'missing_photo' | 'availability' | 'inappropriate_wording' | 'objection' | 'negotiation' | 'other';

export const LEARNING_TYPES: LearningType[] = [
  'wrong_vehicle', 'wrong_price', 'wrong_category', 'wrong_language', 'wrong_shipping_answer',
  'missing_information', 'bad_tone', 'referral_correction', 'better_sales_reply',
  'business_rule', 'unnecessary_hold', 'bad_recommendation', 'good_reply',
  // Added for the supervised-learning upgrade (brief items 23, 26, 30).
  'missing_photo', 'availability', 'inappropriate_wording', 'objection', 'negotiation', 'other',
];

/** Human-readable lesson category (brief item 30): pricing, photos, shipping, negotiation, ... */
export const LESSON_CATEGORIES = ['vehicle', 'pricing', 'photos', 'shipping', 'language', 'availability', 'tone', 'process', 'other'] as const;
export type LessonCategory = (typeof LESSON_CATEGORIES)[number];
export function categoryForType(type: string): LessonCategory {
  switch (String(type)) {
    case 'wrong_vehicle': case 'wrong_category': case 'referral_correction': case 'bad_recommendation': return 'vehicle';
    case 'wrong_price': case 'negotiation': return 'pricing';
    case 'missing_photo': return 'photos';
    case 'wrong_shipping_answer': return 'shipping';
    case 'wrong_language': return 'language';
    case 'availability': return 'availability';
    case 'bad_tone': case 'inappropriate_wording': case 'objection': return 'tone';
    case 'business_rule': case 'missing_information': case 'unnecessary_hold': case 'better_sales_reply': case 'good_reply': return 'process';
    default: return 'other';
  }
}

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
    /*
      Supervised-learning upgrade (brief items 30-38, 118): confidence is a REVIEW AID (never proof),
      every lesson carries its category and evidence reference, outdated lessons expire, and an undo
      leaves a trace. Additive columns with the usual "already exists" guard.
    */
    for (const sql of [
      `ALTER TABLE ai_learning_events ADD COLUMN confidence DECIMAL(4,2) NULL`,
      `ALTER TABLE ai_learning_events ADD COLUMN category VARCHAR(40) NULL`,
      `ALTER TABLE ai_learning_events ADD COLUMN evidence_ref VARCHAR(191) NULL`,
      `ALTER TABLE ai_learning_events ADD COLUMN expires_at DATETIME NULL`,
      `ALTER TABLE ai_learning_events ADD COLUMN undone_at DATETIME NULL`,
      `ALTER TABLE ai_learning_events ADD COLUMN undone_by VARCHAR(191) NULL`,
      `ALTER TABLE ai_learning_events ADD INDEX idx_learning_expiry(expires_at)`,
    ]) { try { await db().execute(sql); } catch (e: any) { if (e?.code !== 'ER_DUP_FIELDNAME' && e?.code !== 'ER_DUP_KEYNAME') console.error('LEARNING_COLUMN', e?.code); } }
    /*
      Never assume the ALTERs above succeeded: verify the columns really exist. A swallowed failure
      used to leave the app "running" while every query that selects expires_at/confidence failed at
      request time. Fail loudly here (the schema promise is retried on the next call) instead.
    */
    const required = ['confidence', 'category', 'evidence_ref', 'expires_at', 'undone_at', 'undone_by'];
    const found = await rows<any>(`SELECT COLUMN_NAME n FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='ai_learning_events'`).catch(() => [] as any[]);
    const have = new Set(found.map((r: any) => String(r.n)));
    const missing = required.filter((c) => !have.has(c));
    if (missing.length) { ready = null; throw new Error(`ai_learning_events is missing column(s): ${missing.join(', ')}`); }
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
  confidence?: number | null; category?: string | null; evidence?: string | null; expiresAt?: string | null;
}) {
  await ensureAiLearningSchema();
  const type = LEARNING_TYPES.includes(String(input.eventType) as LearningType) ? String(input.eventType) : 'other';
  const status: LearningStatus = input.status || 'pending';
  const confidence = input.confidence == null ? null : Math.max(0, Math.min(1, Number(input.confidence)));
  const category = LESSON_CATEGORIES.includes(String(input.category) as LessonCategory) ? String(input.category) : categoryForType(type);
  const [r]: any = await db().execute(
    `INSERT INTO ai_learning_events(conversation_id,customer_id,message_id,question,ai_reply,correction,event_type,reason,lesson,applies_to,payload,status,created_by,confidence,category,evidence_ref,expires_at)
     VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [input.conversationId || null, input.customerId || null, input.messageId || null,
     input.question ? String(input.question).slice(0, 4000) : null,
     input.aiReply ? String(input.aiReply).slice(0, 4000) : null,
     input.correction ? String(input.correction).slice(0, 4000) : null,
     type, input.reason ? String(input.reason).slice(0, 191) : null,
     input.lesson ? String(input.lesson).slice(0, 4000) : null,
     input.appliesTo === 'customer' ? 'customer' : 'global',
     input.payload ? JSON.stringify(input.payload).slice(0, 6000) : null,
     status, String(input.createdBy || 'admin').slice(0, 191),
     confidence, category,
     input.evidence ? String(input.evidence).slice(0, 191) : (input.messageId ? `msg:${input.messageId}` : null),
     input.expiresAt || null]);
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
export async function reviewLearningEvent(id: number, action: 'approve' | 'reject' | 'reopen', opts: { lesson?: string | null; appliesTo?: 'global' | 'customer'; by?: string | null; confidence?: number | null; category?: string | null; expiresAt?: string | null } = {}) {
  const ev: any = await learningEventById(id);
  if (!ev) throw new Error('Learning event not found');
  const status = nextStatus(action, ev.status);
  if (!status) throw new Error(`Cannot ${action} a ${ev.status} lesson`);
  const lesson = opts.lesson != null ? String(opts.lesson).slice(0, 4000) : ev.lesson;
  const appliesTo = opts.appliesTo === 'customer' || opts.appliesTo === 'global' ? opts.appliesTo : ev.applies_to;
  const confidence = opts.confidence == null ? ev.confidence : Math.max(0, Math.min(1, Number(opts.confidence)));
  const category = opts.category && LESSON_CATEGORIES.includes(String(opts.category) as LessonCategory) ? String(opts.category) : ev.category;
  const expiresAt = opts.expiresAt === undefined ? ev.expires_at : (opts.expiresAt || null);
  await db().execute('UPDATE ai_learning_events SET status=?, lesson=?, applies_to=?, confidence=?, category=?, expires_at=?, reviewed_by=?, reviewed_at=NOW() WHERE id=?',
    [status, lesson || null, appliesTo, confidence, category, expiresAt, String(opts.by || 'admin').slice(0, 191), Number(id)]);
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
    const [k]: any = await db().execute(`INSERT INTO ai_knowledge(title,content,active,source) VALUES(?,?,1,'ai_learning')`,
      [lessonTitle(ev.event_type, ev.reason), String(ev.lesson).slice(0, 8000)]);
    // Keep the exact knowledge id so an undo can deactivate THIS entry and nothing else.
    ref = `ai_knowledge:${Number(k?.insertId) || ''}`;
  }

  await db().execute('UPDATE ai_learning_events SET status=\'applied\', applied_at=NOW(), applied_ref=?, reviewed_by=COALESCE(reviewed_by,?) WHERE id=?',
    [ref, String(by || 'admin').slice(0, 191), Number(id)]);
  return { ok: true, id: Number(id), status: 'applied', applied_ref: ref };
}

/**
 * Lessons the reply engine may use right now: approved/applied, global only, newest first, capped.
 * Customer-scoped lessons are never used for other customers.
 */
export async function approvedLessons(limit = 5, query = '') {
  try {
    await ensureAiLearningSchema();
    const n = Math.max(1, Math.min(20, Number(limit) || 5));
    const items = await rows<any>(`SELECT id,event_type,lesson,reason,question,correction,status,applied_ref FROM ai_learning_events
      WHERE status IN ('approved','applied') AND applies_to='global' AND COALESCE(lesson,'')<>''
        AND (expires_at IS NULL OR expires_at > NOW()) AND undone_at IS NULL
      ORDER BY (status='applied') DESC, id DESC LIMIT 80`);
    const text = String(query || '').trim();
    if (!text) return items.slice(0, n);
    return items.map((item) => ({
      ...item,
      relevance: similarity(text, `${item.question || ''} ${item.correction || ''} ${item.lesson || ''}`),
    })).sort((a, b) => b.relevance - a.relevance || Number((b.status || '') === 'applied') - Number((a.status || '') === 'applied') || b.id - a.id)
      .slice(0, n);
  } catch { return []; }
}

// ---------------------------------------------------------------- supervised-learning upgrade
/** Significant tokens for comparing two lessons/cases (stop words removed). */
const STOP = new Set(('the a an and or of to in on for with is are was were be been it this that these those you your our we they them ' +
  'i me my he she his her they them what which who how when where why do does did can could should would will shall may might must ' +
  'not no yes ok please send sent ask tell give show need want looking vehicle car bike price cost stock photo photos').split(' '));
export function tokensOf(text: unknown) {
  return [...new Set(String(text == null ? '' : text).toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ').split(/\s+/)
    .filter((t) => t.length >= 3 && !STOP.has(t)))];
}
/** 0..1 overlap between two texts (Jaccard) - used for case similarity and contradiction scanning. */
export function similarity(a: unknown, b: unknown) {
  const A = new Set(tokensOf(a)), B = new Set(tokensOf(b));
  if (!A.size || !B.size) return 0;
  let hit = 0;
  for (const t of A) if (B.has(t)) hit++;
  return hit / (A.size + B.size - hit);
}

/**
 * Brief item 33: two approved lessons that apply to similar situations but say different things are a
 * real risk. Returns pairs (with the lesson ids) so the admin can resolve them - never auto-resolves.
 */
export function detectContradictions(lessons: { id: number | string; event_type?: string | null; lesson?: string | null; question?: string | null }[]) {
  const use = (lessons || []).filter((l) => String(l?.lesson || '').trim().length > 12);
  const out: { a: number | string; b: number | string; type: string; similarity: number; reason: string }[] = [];
  for (let i = 0; i < use.length; i++) {
    for (let j = i + 1; j < use.length; j++) {
      const a = use[i], b = use[j];
      if (String(a.event_type || '') !== String(b.event_type || '')) continue;
      const sim = similarity(`${a.question || ''} ${a.lesson}`, `${b.question || ''} ${b.lesson}`);
      const sameWording = similarity(a.lesson, b.lesson) > 0.85;
      if (sim >= 0.3 && !sameWording) out.push({ a: a.id, b: b.id, type: String(a.event_type), similarity: Math.round(sim * 100) / 100, reason: 'similar situation, different lesson wording' });
    }
  }
  return out.sort((x, y) => y.similarity - x.similarity).slice(0, 20);
}

/**
 * Brief item 38/118: evaluate a proposed lesson against the historical cases we already store, BEFORE
 * it goes global. This is coverage + agreement evidence, never an accuracy claim: it counts how often a
 * similar customer question appeared, how often staff had to correct the AI, and whether the lesson's
 * wording matches those corrections.
 */
export async function evaluateLearningEvent(id: number) {
  const ev: any = await learningEventById(id);
  if (!ev) throw new Error('Learning event not found');
  await ensureAiLearningSchema();
  const cases = await rows<any>(`SELECT id, question, ai_reply, correction, lesson, event_type FROM ai_learning_events
    WHERE event_type=? AND question IS NOT NULL AND id<>? ORDER BY id DESC LIMIT 300`, [ev.event_type, Number(id)]).catch(() => []);
  const similar = cases
    .map((c) => ({ ...c, score: similarity(ev.question, c.question) }))
    .filter((c) => c.score >= 0.35)
    .sort((a, b) => b.score - a.score)
    .slice(0, 25);
  const withCorrection = similar.filter((c) => String(c.correction || '').trim()).length;
  const wordingMatch = similar.filter((c) => similarity(ev.lesson, c.lesson) >= 0.4).length;
  return {
    id: Number(id),
    similar_cases: similar.length,
    cases_with_human_correction: withCorrection,
    cases_supporting_this_wording: wordingMatch,
    coverage: cases.length ? Math.round((similar.length / cases.length) * 100) : 0,
    agreement: withCorrection ? Math.round((wordingMatch / withCorrection) * 100) : null,
    examples: similar.slice(0, 5).map((c) => ({ id: Number(c.id), score: Math.round(c.score * 100) / 100, question: String(c.question || '').slice(0, 120) })),
    note: 'Coverage = share of stored cases for this type that look like this one. Agreement = share of those human-corrected cases whose lesson wording matches. Neither proves correctness.',
  };
}

/**
 * Brief item 37: undo an applied lesson. The status returns to `approved` so it stops influencing replies
 * immediately; a knowledge entry created by it is deactivated (exact id). Referral mappings are NOT
 * deleted automatically because a human may have relied on them - the response says so.
 */
export async function undoLearningEvent(id: number, by?: string | null) {
  const ev: any = await learningEventById(id);
  if (!ev) throw new Error('Learning event not found');
  if (ev.status !== 'applied' && ev.status !== 'approved') throw new Error('Only an approved or applied lesson can be undone');
  let reverted = 'prompt_context';
  const ref = String(ev.applied_ref || '');
  if (ref.startsWith('ai_knowledge:')) {
    const kId = Number(ref.split(':')[1]);
    if (kId) {
      const { ensureAiKnowledgeSchema } = await import('./knowledge');
      await ensureAiKnowledgeSchema();
      await db().execute('UPDATE ai_knowledge SET active=0 WHERE id=?', [kId]).catch(() => {});
      reverted = `knowledge entry #${kId} deactivated`;
    }
  } else if (ref.startsWith('referral_correction:')) {
    reverted = 'referral mapping kept (a human may depend on it) - review it in the conversation drawer';
  }
  await db().execute(`UPDATE ai_learning_events SET status='approved', applied_at=NULL, applied_ref=NULL, undone_at=NOW(), undone_by=? WHERE id=?`,
    [String(by || 'admin').slice(0, 191), Number(id)]);
  return { ok: true, id: Number(id), status: 'approved', reverted };
}

/** Remove an outdated lesson from runtime while retaining its row and audit history. */
export async function disableLearningEvent(id: number, by?: string | null) {
  const ev: any = await learningEventById(id);
  if (!ev) throw new Error('Learning event not found');
  const ref = String(ev.applied_ref || '');
  if (ref.startsWith('ai_knowledge:')) {
    const knowledgeId = Number(ref.split(':')[1]);
    if (knowledgeId) {
      const { ensureAiKnowledgeSchema } = await import('./knowledge');
      await ensureAiKnowledgeSchema();
      await db().execute(`UPDATE ai_knowledge SET active=0,status='inactive',updated_by=? WHERE id=?`, [String(by || 'admin').slice(0, 191), knowledgeId]);
    }
  }
  await db().execute(`UPDATE ai_learning_events SET status='rejected',undone_at=NOW(),undone_by=?,reviewed_by=COALESCE(reviewed_by,?),reviewed_at=NOW() WHERE id=?`,
    [String(by || 'admin').slice(0, 191), String(by || 'admin').slice(0, 191), Number(id)]);
  return { ok: true, id: Number(id), status: 'rejected', retained_for_audit: true };
}

/** One-line prompt note built from approved lessons (Part 13 step 9). */
export function lessonsNote(lessons: { event_type?: string; lesson?: string | null }[] = []) {
  const usable = (lessons || []).filter((l) => String(l?.lesson || '').trim());
  if (!usable.length) return '';
  return ` APPROVED LESSONS (reviewed business guidance; never override verified inventory, prices, security, privacy or required human approval): ${usable.map((l) => String(l.lesson).replace(/\s+/g, ' ').trim().slice(0, 360)).join(' | ')}.`;
}
