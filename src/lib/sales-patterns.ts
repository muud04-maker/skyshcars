/*
  Daily human-sales pattern learner (GOALS 3 and 6).

  Every day we summarise what REALLY happened in the conversations: which vehicles were discussed and
  sent, what customers asked, what staff answered, which Facebook referrals were mapped, where the
  staff corrected the AI, and which destinations came up. That summary is stored per day and is used
  ONLY as weak context - it can never override an exact referral, stock, price or admin correction,
  and it never becomes a global rule on its own.

  Everything here is deterministic (no model call), so the numbers can be trusted and tested.
*/
import { db, one, rows } from './db';

export type PatternType =
  | 'vehicle_discussed' | 'human_recommendation' | 'facebook_referral' | 'common_question'
  | 'common_answer' | 'common_shipping_answer' | 'common_pricing_answer' | 'ai_correction'
  | 'human_vehicle_change' | 'destination' | 'customer_need';

export type PatternRow = { pattern_type: PatternType; pattern_key: string; pattern_value: string; sample_count: number; confidence: number; source: string };

export const PATTERN_TYPE_LABEL: Record<string, string> = {
  vehicle_discussed: 'Vehicles discussed',
  human_recommendation: 'Vehicles staff sent or recommended',
  facebook_referral: 'Facebook referral vehicles',
  common_question: 'Common customer questions',
  common_answer: 'Common human answers',
  common_shipping_answer: 'Common shipping answers',
  common_pricing_answer: 'Common pricing answers',
  ai_correction: 'AI corrections',
  human_vehicle_change: 'Vehicles staff switched the chat to',
  destination: 'Destinations and ports asked about',
  customer_need: 'Recurring customer needs',
};

let ready: Promise<void> | null = null;
export function ensureSalesPatternsSchema() {
  if (!ready) ready = db().execute(`CREATE TABLE IF NOT EXISTS daily_ai_sales_patterns (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    pattern_date DATE NOT NULL,
    pattern_type VARCHAR(60) NOT NULL,
    pattern_key VARCHAR(191) NOT NULL,
    pattern_value TEXT NULL,
    sample_count INT NOT NULL DEFAULT 1,
    confidence DECIMAL(4,2) NOT NULL DEFAULT 0.50,
    source VARCHAR(60) NOT NULL DEFAULT 'daily_learner',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uq_pattern(pattern_date,pattern_type,pattern_key),
    INDEX idx_pattern_date_type(pattern_date,pattern_type),
    INDEX idx_pattern_key(pattern_key,pattern_date)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`).then(() => undefined).catch(e => { ready = null; throw e; });
  return ready;
}

// ---------------------------------------------------------------- pure helpers (testable)
export function normalizeText(v: unknown) {
  return String(v == null ? '' : v).toLowerCase().replace(/https?:\/\/\S+/g, ' ').replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ').trim();
}
export function dayKey(v: unknown) {
  const t = v ? Date.parse(String(v).replace(' ', 'T')) : NaN;
  return Number.isFinite(t) ? new Date(t).toISOString().slice(0, 10) : '';
}
/** Confidence grows with the number of samples but stays below certainty (weak evidence by design). */
export function confidenceFor(count: number, cap = 0.9) {
  const n = Math.max(0, Number(count) || 0);
  return Math.min(cap, Math.round((0.4 + Math.min(1, n / 5) * 0.5) * 100) / 100);
}
/** Deterministic pattern key for a free-text value (short, stable, safe for a unique index). */
export function textKey(text: unknown, max = 120) {
  const t = normalizeText(text);
  if (!t) return '';
  const words = t.split(' ').slice(0, 12).join(' ');
  return words.slice(0, max);
}
export function vehicleKey(v: { stock_no?: any; model?: any; brand?: any }) {
  const stock = String(v?.stock_no || '').trim();
  if (stock) return stock;
  const name = [v?.brand, v?.model].filter(Boolean).join(' ').trim();
  return name ? textKey(name) : '';
}
/** Normalised stock key, so "SC-859", "sc 859" and "stock 859" are all the same unit. */
export function stockKey(v: unknown) {
  const d = String(v == null ? '' : v).replace(/[^0-9]/g, '').replace(/^0+/, '');
  return d ? 'SC' + d.padStart(5, '0') : '';
}
/** Stock numbers written in a message ("SC-859", "stock 859"). */
export function stocksInText(text: unknown) {
  const t = String(text == null ? '' : text);
  const out = new Set<string>();
  for (const m of t.matchAll(/\bSC[\s-]?0*(\d{1,6})\b|\bstock\s*(?:no\.?|number)?\s*[:#]?\s*0*(\d{1,6})\b/gi)) {
    const key = stockKey(m[1] || m[2] || '');
    if (key) out.add(key);
  }
  return [...out];
}
export function mentionedVehicle(text: unknown, vehicles: { stock_no?: any; brand?: any; model?: any }[] = []) {
  const t = normalizeText(text);
  if (!t) return null;
  const stocks = new Set(stocksInText(text));
  for (const v of vehicles) {
    if (v?.stock_no && stocks.has(stockKey(v.stock_no))) return { stock_no: String(v.stock_no), brand: v.brand || null, model: v.model || null };
  }
  const compact = t.replace(/ /g, '');
  for (const v of vehicles) {
    const model = normalizeText(v?.model);
    if (model && model.length >= 3 && (new RegExp(`\\b${model.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`).test(t) || compact.includes(model.replace(/ /g, '')))) {
      return { stock_no: v.stock_no ? String(v.stock_no) : null, brand: v.brand || null, model: v.model || null };
    }
  }
  return null;
}
const isQuestion = (t: string) => /\?|\b(price|cost|how much|available|ship|shipping|deliver|what|which|when|do you|can you|qiimo|meeqa)\b/i.test(t);
const isShipping = (t: string) => /\b(ship|shipping|deliver|delivery|freight|port|destination|clearance|customs)\b/i.test(t);
// `$` needs its own test: a word boundary cannot sit in front of it ("for $3,214").
const isPricing = (t: string) => /\b(price|cost|how much|usd|dollars?|discount|payment|deposit)\b/i.test(t) || /\$\s?\d/.test(t);

export type DayInput = {
  day: string;
  messages: { id?: number; sender?: string | null; direction?: string | null; body?: string | null; channel?: string | null; conversation_id?: number | null; created_at?: any }[];
  referrals?: { matched_vehicle_id?: number | null; headline?: any; body?: any; stock_no?: any; brand?: any; model?: any; category?: any }[];
  learningEvents?: { event_type?: string | null; status?: string | null; reason?: string | null }[];
  vehicleEvents?: { stock_no?: any; brand?: any; model?: any; source?: string | null }[];
  facts?: { fact_key?: string | null; fact_value?: any }[];
  vehicles?: { stock_no?: any; brand?: any; model?: any; category?: any }[];
};

/**
 * Turn one day of REAL activity into pattern rows. Pure: the caller supplies the day's data.
 * Nothing is promoted to a global rule here - these are counts, not instructions.
 */
export function buildDailyPatterns(input: DayInput): PatternRow[] {
  const vehicles = input.vehicles || [];
  const counts = new Map<string, PatternRow>();
  const bump = (pattern_type: PatternType, key: string, value: string, source = 'daily_learner') => {
    if (!key) return;
    const id = `${pattern_type}::${key}`;
    const cur = counts.get(id);
    if (cur) cur.sample_count += 1;
    else counts.set(id, { pattern_type, pattern_key: key.slice(0, 191), pattern_value: value.slice(0, 400), sample_count: 1, confidence: 0, source });
  };

  for (const m of input.messages || []) {
    const body = String(m?.body || '');
    if (!body.trim()) continue;
    const sender = String(m?.sender || '');
    const vehicle = mentionedVehicle(body, vehicles);
    // Vehicles discussed (any participant).
    if (vehicle) bump('vehicle_discussed', vehicleKey(vehicle) || textKey(vehicle.model), [vehicle.brand, vehicle.model].filter(Boolean).join(' '));
    if (sender === 'human') {
      // What staff actually recommended / sent.
      if (vehicle) bump('human_recommendation', vehicleKey(vehicle) || textKey(vehicle.model), [vehicle.brand, vehicle.model].filter(Boolean).join(' '));
      const k = textKey(body);
      if (k) bump('common_answer', k, body.replace(/\s+/g, ' ').slice(0, 240));
      if (isShipping(body)) bump('common_shipping_answer', textKey(body), body.replace(/\s+/g, ' ').slice(0, 200));
      if (isPricing(body)) bump('common_pricing_answer', textKey(body), body.replace(/\s+/g, ' ').slice(0, 200));
    }
    if (sender === 'customer') {
      const k = textKey(body);
      if (k && isQuestion(body)) bump('common_question', k, body.replace(/\s+/g, ' ').slice(0, 200));
      if (isShipping(body)) bump('customer_need', 'shipping', 'Customers asking about shipping');
      if (isPricing(body)) bump('customer_need', 'pricing', 'Customers asking about price');
      if (/\b(photos?|pictures?|sawir)\b/i.test(body)) bump('customer_need', 'photos', 'Customers asking for photos');
      if (/\b(motorcycles?|motorbikes?|bikes?)\b/i.test(body)) bump('customer_need', 'motorcycle', 'Customers asking about motorcycles');
    }
  }

  for (const r of input.referrals || []) {
    const key = vehicleKey(r as any) || textKey(r?.headline || r?.body);
    bump('facebook_referral', key, [r?.brand, r?.model].filter(Boolean).join(' ') || String(r?.headline || r?.body || 'referral').slice(0, 200));
  }
  for (const e of input.learningEvents || []) {
    const type = String(e?.event_type || 'other');
    if (type === 'good_reply') continue;
    bump('ai_correction', type, `${type}${e?.reason ? `: ${e.reason}` : ''}`.slice(0, 200), 'ai_learning_events');
  }
  for (const v of input.vehicleEvents || []) {
    const key = vehicleKey(v as any);
    if (key) bump('human_vehicle_change', key, [v?.brand, v?.model].filter(Boolean).join(' '), String(v?.source || 'human'));
  }
  for (const f of input.facts || []) {
    const k = String(f?.fact_key || '');
    if (k === 'destination_port' || k === 'destination_country') bump('destination', String(f?.fact_value || ''), `${k.replace(/_/g, ' ')}: ${f?.fact_value}`);
  }

  return [...counts.values()]
    .map((p) => ({ ...p, confidence: confidenceFor(p.sample_count) }))
    .sort((a, b) => b.sample_count - a.sample_count || a.pattern_key.localeCompare(b.pattern_key));
}

/** Suggested lessons are SUGGESTIONS only: an admin still has to create/approve a lesson. */
export function suggestedLessons(patterns: PatternRow[], limit = 5) {
  return patterns
    .filter((p) => (p.pattern_type === 'ai_correction' || p.pattern_type === 'human_vehicle_change') && p.sample_count >= 2)
    .slice(0, limit)
    .map((p) => `${PATTERN_TYPE_LABEL[p.pattern_type] || p.pattern_type} repeated ${p.sample_count}x today (${p.pattern_value.slice(0, 80)}). Consider reviewing it as a lesson.`);
}

// ---------------------------------------------------------------- storage
export async function storePatterns(day: string, patterns: PatternRow[]) {
  await ensureSalesPatternsSchema();
  let saved = 0;
  for (const p of patterns.slice(0, 2000)) {
    await db().execute(`INSERT INTO daily_ai_sales_patterns(pattern_date,pattern_type,pattern_key,pattern_value,sample_count,confidence,source)
      VALUES(?,?,?,?,?,?,?)
      ON DUPLICATE KEY UPDATE pattern_value=VALUES(pattern_value), sample_count=VALUES(sample_count), confidence=VALUES(confidence)`,
      [day, p.pattern_type, p.pattern_key, p.pattern_value, p.sample_count, p.confidence, p.source]).catch(() => {});
    saved++;
  }
  return saved;
}

/** Read the stored patterns for one day (empty when the learner has not run yet). */
export async function patternsForDay(day: string, limit = 300) {
  await ensureSalesPatternsSchema();
  return rows<any>(`SELECT pattern_type,pattern_key,pattern_value,sample_count,confidence,source,updated_at
    FROM daily_ai_sales_patterns WHERE pattern_date=? ORDER BY sample_count DESC LIMIT ${Math.max(1, Math.min(1000, limit))}`, [day]).catch(() => []);
}

/**
 * Compute (and store) the patterns for one day from the real conversations.
 * Bounded queries only: one day of messages, referrals, learning events, vehicle events and facts.
 */
export async function generateDailyPatterns(day?: string) {
  const date = /^\d{4}-\d{2}-\d{2}$/.test(String(day || '')) ? String(day) : new Date().toISOString().slice(0, 10);
  const from = `${date} 00:00:00`, to = `${date} 23:59:59`;
  const [messages, referrals, learningEvents, vehicleEvents, facts, vehicles] = await Promise.all([
    rows<any>(`SELECT m.id,m.sender,m.direction,m.body,m.created_at,c.channel,c.id conversation_id
      FROM messages m JOIN conversations c ON c.id=m.conversation_id
      WHERE m.created_at>=? AND m.created_at<=? AND COALESCE(m.body,'')<>'' ORDER BY m.id DESC LIMIT 5000`, [from, to]).catch(() => []),
    rows<any>(`SELECT r.matched_vehicle_id,r.headline,r.body,r.created_at,v.stock_no,v.brand,v.model,v.category
      FROM chat_referrals r LEFT JOIN vehicles v ON v.id=r.matched_vehicle_id
      WHERE r.created_at>=? AND r.created_at<=? ORDER BY r.id DESC LIMIT 500`, [from, to]).catch(() => []),
    rows<any>(`SELECT event_type,status,reason,created_at FROM ai_learning_events
      WHERE created_at>=? AND created_at<=? ORDER BY id DESC LIMIT 500`, [from, to]).catch(() => []),
    rows<any>(`SELECT e.vehicle_id,e.source,e.created_at,v.stock_no,v.brand,v.model
      FROM conversation_vehicle_events e LEFT JOIN vehicles v ON v.id=e.vehicle_id
      WHERE e.created_at>=? AND e.created_at<=? AND e.vehicle_id IS NOT NULL ORDER BY e.id DESC LIMIT 500`, [from, to]).catch(() => []),
    rows<any>(`SELECT DISTINCT fact_key,fact_value FROM customer_fact_events
      WHERE changed_at>=? AND changed_at<=? AND fact_key IN ('destination_port','destination_country') LIMIT 500`, [from, to]).catch(() => []),
    rows<any>(`SELECT stock_no,brand,model,category FROM vehicles WHERE COALESCE(brand,'')<>'' OR COALESCE(model,'')<>'' LIMIT 3000`).catch(() => []),
  ]);
  const patterns = buildDailyPatterns({ day: date, messages, referrals, learningEvents, vehicleEvents, facts, vehicles });
  const saved = await storePatterns(date, patterns);
  return { date, patterns, saved, scanned: { messages: messages.length, referrals: referrals.length, learningEvents: learningEvents.length, vehicleEvents: vehicleEvents.length } };
}

/**
 * Same-day patterns as WEAK hints for the reply engine (GOAL 7 step 11).
 * They are only ever a hint: the prompt is told to prefer exact facts, and the caller never lets them
 * override a referral, stock, price or admin correction.
 */
export async function weakDailyHints(limit = 6, day?: string) {
  try {
    const date = /^\d{4}-\d{2}-\d{2}$/.test(String(day || '')) ? String(day) : new Date().toISOString().slice(0, 10);
    const list = await patternsForDay(date, 200);
    if (!list.length) return [];
    const wanted = ['vehicle_discussed', 'human_recommendation', 'facebook_referral'];
    return list.filter((p: any) => wanted.includes(String(p.pattern_type))).slice(0, Math.max(1, Math.min(20, limit)))
      .map((p: any) => ({ type: String(p.pattern_type), value: String(p.pattern_value || ''), count: Number(p.sample_count || 0), confidence: Number(p.confidence || 0) }));
  } catch { return []; }
}

/** The same-day hint for ONE model/brand token (Facebook lead priority step 6, weak evidence). */
export async function patternHintForTokens(tokens: string[], opts: { day?: string; category?: string | null } = {}) {
  const list = await weakDailyHints(50, opts.day).catch(() => []);
  if (!list.length || !tokens?.length) return null;
  const wanted = tokens.map((t) => String(t).toLowerCase()).filter((t) => t.length >= 3);
  if (!wanted.length) return null;
  for (const hint of list) {
    const v = String(hint.value || '').toLowerCase();
    if (!v) continue;
    if (wanted.some((t) => v.includes(t))) return hint;
  }
  return null;
}

let memo: { at: number; day: string; data: any } | null = null;
const MEMO_MS = 60 * 1000;

/**
 * The pattern section for the admin page: stored rows for the day, computing them once if the daily
 * cron has not run yet. Grouped by type, with suggestions (suggestions are NOT rules).
 */
export async function todayPatterns(day?: string) {
  const date = /^\d{4}-\d{2}-\d{2}$/.test(String(day || '')) ? String(day) : new Date().toISOString().slice(0, 10);
  if (memo && memo.day === date && Date.now() - memo.at < MEMO_MS) return memo.data;
  let list = await patternsForDay(date, 400);
  if (!list.length) {
    await generateDailyPatterns(date).catch(() => null);
    list = await patternsForDay(date, 400);
  }
  const groups = new Map<string, any[]>();
  for (const p of list) {
    const type = String(p.pattern_type || 'other');
    if (!groups.has(type)) groups.set(type, []);
    groups.get(type)!.push({ key: String(p.pattern_key || ''), value: String(p.pattern_value || ''), count: Number(p.sample_count || 0), confidence: Number(p.confidence || 0) });
  }
  const asRows: PatternRow[] = list.map((p: any) => ({ pattern_type: String(p.pattern_type) as PatternType, pattern_key: String(p.pattern_key), pattern_value: String(p.pattern_value || ''), sample_count: Number(p.sample_count || 0), confidence: Number(p.confidence || 0), source: String(p.source || '') }));
  const data = {
    day: date,
    groups: [...groups.entries()].map(([type, items]) => ({ type, label: PATTERN_TYPE_LABEL[type] || type, items: items.slice(0, 12) })),
    suggested: suggestedLessons(asRows, 5),
    total: list.length,
  };
  memo = { at: Date.now(), day: date, data };
  return data;
}
