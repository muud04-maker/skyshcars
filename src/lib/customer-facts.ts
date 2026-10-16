/*
  Persistent, per-customer memory (Part 3).

  customer_memory (already in the system) keeps the AI *summary* of a person. This module adds the
  structured facts behind it: one row per fact, each one timestamped, attributed to a source and
  correctable/deletable by admin. A new value for the same fact supersedes the old one and the change
  is recorded in customer_fact_events, so nothing is silently rewritten.

  Two rules that matter:
    - memory is per customer and is never shared with another customer,
    - it is NEVER turned into global business knowledge (see ai-learning.ts for that).

  No passwords, tokens, card or bank details are ever stored: extractFacts() refuses sensitive text.
*/
import { db, one, rows } from './db';
import { COMMON_BRANDS } from './ai-rules/inventory-intent';

export type FactSource = 'customer_message' | 'staff' | 'admin' | 'ai_summary' | 'referral';
export type ExtractedFact = { fact_key: string; fact_value: string; confidence: number; evidence: string };

export const FACT_KEYS = [
  'preferred_category', 'preferred_brand', 'preferred_model', 'body_type', 'fuel', 'transmission',
  'steering', 'color', 'model_year_min', 'model_year_max', 'budget_min', 'budget_max',
  'destination_country', 'destination_port', 'shipping_needed', 'purchase_intent', 'language',
  'contact_preference',
  // Written by staff, not by the customer: the team's latest guidance for this customer. It is
  // customer-scoped context for the same chat/person only - never a global rule.
  'last_human_guidance',
] as const;

let ready: Promise<void> | null = null;
export function ensureCustomerFactsSchema() {
  if (!ready) ready = (async () => {
    await db().execute(`CREATE TABLE IF NOT EXISTS customer_facts (
      id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      customer_id BIGINT UNSIGNED NOT NULL,
      fact_key VARCHAR(60) NOT NULL,
      fact_value VARCHAR(255) NOT NULL,
      source VARCHAR(40) NOT NULL DEFAULT 'customer_message',
      source_message_id BIGINT UNSIGNED NULL,
      confidence DECIMAL(4,2) NULL,
      active TINYINT(1) NOT NULL DEFAULT 1,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY uq_customer_fact(customer_id,fact_key),
      INDEX idx_fact_customer(customer_id,active),
      INDEX idx_fact_key(fact_key,active)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
    await db().execute(`CREATE TABLE IF NOT EXISTS customer_fact_events (
      id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      customer_id BIGINT UNSIGNED NOT NULL,
      fact_key VARCHAR(60) NOT NULL,
      old_value VARCHAR(255) NULL,
      new_value VARCHAR(255) NULL,
      action VARCHAR(20) NOT NULL,
      source VARCHAR(40) NULL,
      changed_by VARCHAR(191) NULL,
      changed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_fact_event_customer(customer_id,changed_at),
      INDEX idx_fact_event_key(fact_key,changed_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
  })().catch(e => { ready = null; throw e; });
  return ready;
}

// ---------------------------------------------------------------- pure extraction
const SENSITIVE = /\b(password|passcode|otp|pin code|cvv|expiry date|card number|bank account|iban|swift|wire transfer details)\b|(?:\d[ -]?){13,19}/i;

/** Never remember card/password/bank material, and never store the raw message. */
export function looksSensitive(text: unknown) {
  return SENSITIVE.test(String(text == null ? '' : text));
}

const clean = (v: any) => String(v == null ? '' : v).replace(/\s+/g, ' ').trim();
const money = (s: string) => Number(String(s).replace(/[,_\s]/g, ''));

export type FactHints = { brands?: string[]; countries?: string[]; ports?: string[] };

/**
 * Deterministic facts from ONE customer message. No AI, no guessing: every fact can be traced back
 * to wording that is really in the message (the `evidence` field).
 */
export function extractFacts(text: unknown, hints: FactHints = {}): ExtractedFact[] {
  const raw = String(text == null ? '' : text);
  if (!raw.trim() || looksSensitive(raw)) return [];
  const t = ` ${raw.toLowerCase().replace(/[^\p{L}\p{N}$.,\s-]/gu, ' ')} `;
  const out: ExtractedFact[] = [];
  const push = (fact_key: string, fact_value: string, confidence: number, evidence: string) => {
    if (!fact_value) return;
    if (out.some((f) => f.fact_key === fact_key)) return;
    out.push({ fact_key, fact_value: String(fact_value).slice(0, 255), confidence, evidence: clean(evidence).slice(0, 200) });
  };

  // Category ("I need a motorcycle", "looking for cars")
  const moto = /\b(motorcycles?|motorbikes?|bikes?|scooters?|moto)\b/.exec(t);
  const car = /\b(cars?|suv|sedan|saloon|hatchback|pickup|van|truck)\b/.exec(t);
  if (moto) push('preferred_category', 'motorcycle', 0.85, moto[0]);
  else if (car) push('preferred_category', 'car', 0.8, car[0]);

  // Budget ("under $8000", "budget 8,000", "max $10k")
  const under = /(?:under|below|less than|max|maximum|up to|budget(?:\s+of)?|around)\s*\$?\s*(\d[\d,._]*)\s*(k\b)?/i.exec(t);
  if (under) {
    const n = money(under[1]) * (under[2] ? 1000 : 1);
    if (Number.isFinite(n) && n > 0) push('budget_max', String(Math.round(n)), 0.9, under[0]);
  }
  // A price written with a currency marker is a budget even when the wording is loose
  // ("budget is 12,500 USD", "$10,000", "my budget changed to $10,000").
  if (!out.some((f) => f.fact_key === 'budget_max')) {
    const loose = /\bbudget\b[^0-9]{0,24}(\d[\d,._]{2,})\s*(k\b)?/i.exec(t)
      || /\$\s*(\d[\d,._]{2,})\s*(k\b)?/i.exec(t)
      || /(\d[\d,._]{2,})\s*(k\b|usd|dollars?)/i.exec(t);
    if (loose) {
      const n = money(loose[1]) * (loose[2] && /^k/i.test(loose[2]) ? 1000 : 1);
      if (Number.isFinite(n) && n > 0) push('budget_max', String(Math.round(n)), 0.8, loose[0]);
    }
  }
  const over = /(?:over|above|more than|minimum|at least)\s*\$?\s*(\d[\d,._]*)\s*(k\b)?/i.exec(t);
  if (over) {
    const n = money(over[1]) * (over[2] ? 1000 : 1);
    if (Number.isFinite(n) && n > 0) push('budget_min', String(Math.round(n)), 0.85, over[0]);
  }

  // Brand (known inventory brands + common makes)
  for (const b of [...(hints.brands || []), ...COMMON_BRANDS]) {
    const brand = clean(b);
    if (brand.length < 3) continue;
    const re = new RegExp(`\\b${brand.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
    const hit = re.exec(t);
    if (hit) { push('preferred_brand', brand, 0.85, hit[0]); break; }
  }

  // Destination ("ship to Mombasa", "deliver to Kenya")
  const port = (hints.ports || []).find((p) => p && new RegExp(`\\b${clean(p).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(t));
  if (port) push('destination_port', clean(port), 0.9, port);
  const country = (hints.countries || []).find((c) => c && new RegExp(`\\b${clean(c).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(t));
  if (country) push('destination_country', clean(country), 0.85, country);
  if (/\b(ship|shipping|deliver|delivery|freight|export|port)\b/i.test(t)) push('shipping_needed', 'yes', 0.7, 'shipping mentioned');

  // Vehicle attributes
  const fuel = /\b(petrol|gasoline|diesel|hybrid|electric|ev)\b/i.exec(t);
  if (fuel) push('fuel', fuel[1].toLowerCase() === 'ev' ? 'electric' : fuel[1].toLowerCase(), 0.8, fuel[0]);
  const trans = /\b(automatic|manual)\b/i.exec(t);
  if (trans) push('transmission', trans[1].toLowerCase(), 0.8, trans[0]);
  const steer = /\b(lhd|rhd|left hand drive|right hand drive)\b/i.exec(t);
  if (steer) push('steering', /r/i.test(steer[1][0]) ? 'RHD' : 'LHD', 0.85, steer[0]);
  const body = /\b(suv|sedan|saloon|hatchback|coupe|pickup|van|bus|truck|wagon)\b/i.exec(t);
  if (body) push('body_type', body[1].toLowerCase() === 'saloon' ? 'sedan' : body[1].toLowerCase(), 0.75, body[0]);
  const colour = /\b(white|black|silver|grey|gray|red|blue|green|brown|gold|yellow)\b/i.exec(t);
  if (colour) push('color', colour[1].toLowerCase() === 'gray' ? 'grey' : colour[1].toLowerCase(), 0.7, colour[0]);
  const year = /\b(19[89]\d|20[0-4]\d)\b/.exec(t);
  if (year) push('model_year_min', year[1], 0.6, year[0]);

  // Intent signals
  if (/\b(ready to buy|want to buy|i will buy|place an order|how do i pay)\b/i.test(t)) push('purchase_intent', 'high', 0.7, 'buying language');
  if (/\b(just looking|only checking|maybe later|not now)\b/i.test(t)) push('purchase_intent', 'low', 0.6, 'browsing language');

  return out;
}

/** Facts shaped for the AI + admin UI. */
export function preferencesFromFacts(list: { fact_key: string; fact_value: string }[] = []) {
  const p: Record<string, string> = {};
  for (const f of list || []) p[String(f.fact_key)] = String(f.fact_value);
  return p;
}

// ---------------------------------------------------------------- storage
export async function factsForCustomer(customerId: number) {
  if (!customerId) return [];
  await ensureCustomerFactsSchema();
  return rows<any>(`SELECT id,fact_key,fact_value,source,source_message_id,confidence,created_at,updated_at
    FROM customer_facts WHERE customer_id=? AND active=1 ORDER BY fact_key ASC`, [customerId]);
}

export async function factHistoryForCustomer(customerId: number, limit = 50) {
  if (!customerId) return [];
  await ensureCustomerFactsSchema();
  return rows<any>(`SELECT id,fact_key,old_value,new_value,action,source,changed_by,changed_at
    FROM customer_fact_events WHERE customer_id=? ORDER BY id DESC LIMIT ${Math.max(1, Math.min(200, limit))}`, [customerId]);
}

/**
 * Save facts for one customer. A new value supersedes the old one for the same key and the change is
 * logged (nothing is silently overwritten, nothing crosses to another customer).
 */
export async function saveFacts(
  customerId: number,
  facts: ExtractedFact[],
  opts: { source?: FactSource; sourceMessageId?: number | null; changedBy?: string | null } = {},
) {
  if (!customerId || !facts?.length) return 0;
  await ensureCustomerFactsSchema();
  const source = String(opts.source || 'customer_message');
  let saved = 0;
  for (const f of facts.slice(0, 30)) {
    const key = clean(f.fact_key).slice(0, 60);
    const value = clean(f.fact_value).slice(0, 255);
    if (!FACT_KEYS.includes(key as any) || !value) continue;
    const existing: any = await one<any>('SELECT id,fact_value,active FROM customer_facts WHERE customer_id=? AND fact_key=? LIMIT 1', [customerId, key]);
    if (existing && String(existing.fact_value) === value && Number(existing.active) === 1) continue;
    await db().execute(`INSERT INTO customer_facts(customer_id,fact_key,fact_value,source,source_message_id,confidence,active)
      VALUES(?,?,?,?,?,?,1)
      ON DUPLICATE KEY UPDATE fact_value=VALUES(fact_value), source=VALUES(source), source_message_id=VALUES(source_message_id), confidence=VALUES(confidence), active=1`,
      [customerId, key, value, source, opts.sourceMessageId || null, Number.isFinite(Number(f.confidence)) ? Number(f.confidence) : null]);
    await db().execute(`INSERT INTO customer_fact_events(customer_id,fact_key,old_value,new_value,action,source,changed_by)
      VALUES(?,?,?,?,?,?,?)`, [customerId, key, existing?.fact_value ?? null, value, existing ? 'updated' : 'added', source, opts.changedBy || null]);
    saved++;
  }
  return saved;
}

/** Admin edit: set one fact by hand (source='admin', fully traceable). */
export async function setFact(customerId: number, key: string, value: string, by?: string | null) {
  const k = clean(key).slice(0, 60);
  if (!FACT_KEYS.includes(k as any)) throw new Error('Unknown memory field');
  const v = clean(value).slice(0, 255);
  if (!v) throw new Error('Value is empty');
  await saveFacts(customerId, [{ fact_key: k, fact_value: v, confidence: 1, evidence: 'set by admin' }], { source: 'admin', changedBy: by || 'admin' });
  return { ok: true };
}

/** Admin delete: deactivate the fact but keep the history (never a hard delete of customer data). */
export async function deleteFact(customerId: number, key: string, by?: string | null) {
  await ensureCustomerFactsSchema();
  const k = clean(key).slice(0, 60);
  const existing: any = await one<any>('SELECT fact_value FROM customer_facts WHERE customer_id=? AND fact_key=? LIMIT 1', [customerId, k]);
  if (!existing) return { ok: true, removed: 0 };
  await db().execute('UPDATE customer_facts SET active=0 WHERE customer_id=? AND fact_key=?', [customerId, k]);
  await db().execute(`INSERT INTO customer_fact_events(customer_id,fact_key,old_value,new_value,action,source,changed_by)
    VALUES(?,?,?,?,?,?,?)`, [customerId, k, existing.fact_value ?? null, null, 'deleted', 'admin', by || 'admin']);
  return { ok: true, removed: 1 };
}
