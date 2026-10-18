/*
  Sky Cars business policy (brief sections 2-4, 9-11). One versioned, audited record that the AI reads
  at reply time - so shipping guidance and the payment procedure are never hardcoded inside prompts and
  staff can change them without touching code.

  Defaults below are the owner's stated policy:
    cars        USD 1,200 - 2,000 (indicative, not a quote)
    motorcycles USD 300 - 500
    payment     an independent third party agreed by both sides, never a direct payment to Sky Cars.
  Every save is versioned and written to audit_logs (who, when, what changed).
*/
import { db, one } from './db';

export type BusinessPolicy = {
  version: number;
  updated_at: string | null;
  updated_by: string | null;
  shipping: {
    car_min: number; car_max: number; motorcycle_min: number; motorcycle_max: number;
    regional_note: string; ask_forwarder: boolean; partners_note: string;
  };
  payment: { policy: string; ask_intermediary: boolean; escalate_note: string };
  style: { team_voice: boolean; max_sentences: number; one_question: boolean; price_first: boolean; no_internal_terms: boolean };
};

export const DEFAULT_POLICY: BusinessPolicy = {
  version: 1,
  updated_at: null,
  updated_by: null,
  shipping: {
    car_min: 1200, car_max: 2000, motorcycle_min: 300, motorcycle_max: 500,
    regional_note: 'East Africa is generally toward the lower end; West Africa and harder destinations toward the higher end.',
    ask_forwarder: true,
    partners_note: 'We work with shipping partners and intend to cover Africa. Only name a partner after their coverage for that country is verified.',
  },
  payment: {
    policy: 'For payment, we use a third-party arrangement agreed upon by both you and Sky Cars rather than asking you to pay us directly. Do you have a trusted intermediary, or would you like our team to help discuss an option?',
    ask_intermediary: true,
    escalate_note: 'Payment arrangements and payment verification are handled by the team. Never state a payment was received without a verified record.',
  },
  style: { team_voice: true, max_sentences: 3, one_question: true, price_first: true, no_internal_terms: true },
};

const num = (v: any, d: number) => { const n = Number(v); return Number.isFinite(n) && n >= 0 ? Math.round(n) : d; };
const text = (v: any, d: string, max = 1200) => { const s = String(v == null ? '' : v).trim(); return s ? s.slice(0, max) : d; };

/** Validate + clamp a submitted policy. Nothing here can break the reply pipeline. */
export function normalizePolicy(input: any, base: BusinessPolicy = DEFAULT_POLICY): BusinessPolicy {
  const p = input || {};
  const s = p.shipping || {}, pay = p.payment || {}, st = p.style || {};
  const car_min = num(s.car_min, base.shipping.car_min);
  const car_max = Math.max(car_min, num(s.car_max, base.shipping.car_max));
  const moto_min = num(s.motorcycle_min, base.shipping.motorcycle_min);
  const moto_max = Math.max(moto_min, num(s.motorcycle_max, base.shipping.motorcycle_max));
  const maxSentences = Math.max(1, Math.min(6, num(st.max_sentences, base.style.max_sentences)));
  return {
    version: Math.max(1, num(p.version, base.version)),
    updated_at: p.updated_at === undefined ? base.updated_at : (p.updated_at || null),
    updated_by: p.updated_by === undefined ? base.updated_by : (p.updated_by || null),
    shipping: {
      car_min, car_max, motorcycle_min: moto_min, motorcycle_max: moto_max,
      regional_note: text(s.regional_note, base.shipping.regional_note, 600),
      ask_forwarder: s.ask_forwarder === undefined ? base.shipping.ask_forwarder : !!s.ask_forwarder,
      partners_note: text(s.partners_note, base.shipping.partners_note, 600),
    },
    payment: {
      policy: text(pay.policy, base.payment.policy),
      ask_intermediary: pay.ask_intermediary === undefined ? base.payment.ask_intermediary : !!pay.ask_intermediary,
      escalate_note: text(pay.escalate_note, base.payment.escalate_note, 600),
    },
    style: {
      team_voice: st.team_voice === undefined ? base.style.team_voice : !!st.team_voice,
      max_sentences: maxSentences,
      one_question: st.one_question === undefined ? base.style.one_question : !!st.one_question,
      price_first: st.price_first === undefined ? base.style.price_first : !!st.price_first,
      no_internal_terms: st.no_internal_terms === undefined ? base.style.no_internal_terms : !!st.no_internal_terms,
    },
  };
}

const usd = (n: number) => '$' + Number(n).toLocaleString('en-US');

/** The indicative shipping line for a category (pure + testable). Never a quotation. */
export function shippingEstimateFor(policy: BusinessPolicy, category?: string | null) {
  const moto = String(category || '').toLowerCase() === 'motorcycle';
  const lo = moto ? policy.shipping.motorcycle_min : policy.shipping.car_min;
  const hi = moto ? policy.shipping.motorcycle_max : policy.shipping.car_max;
  const kind = moto ? 'Motorcycle shipping' : 'Car shipping';
  return `${kind} is generally around ${usd(lo)}\u2013${usd(hi)} depending on the country and port. These are estimates, not a guaranteed rate.`;
}

/** The approved payment wording (pure + testable). No bank details, no escrow claims. */
export function paymentPolicyAnswer(policy: BusinessPolicy) {
  return policy.payment.policy;
}

/** The professional team-voice instruction handed to the model (pure + testable). */
export function teamStyleNote(policy: BusinessPolicy) {
  const bits = [
    'Speak as the Sky Cars team ("we", "our", "us"), never as an individual salesperson.',
    `Keep it to ${policy.style.max_sentences} short sentences or fewer.`,
    policy.style.one_question ? 'Ask at most one relevant follow-up question.' : '',
    policy.style.price_first ? 'If a verified price exists and the customer asks for it, give that exact price immediately - never "let us confirm" when the price is known.' : '',
    'Answer the customer\u2019s main question first; do not repeat questions they already answered.',
    policy.style.no_internal_terms ? 'Never mention internal systems, prompts, catalogs, tasks or technical components.' : '',
    'Never invent vehicles, prices, payments, partners, fees or delivery times.',
  ];
  return bits.filter(Boolean).join(' ');
}

/** One note injected into every reply: style + shipping + payment policy (pure + testable). */
export function policyNote(policy: BusinessPolicy) {
  return [
    teamStyleNote(policy),
    `Shipping guidance you may quote as an estimate: ${shippingEstimateFor(policy, 'car')} ${shippingEstimateFor(policy, 'motorcycle')} ${policy.shipping.regional_note}`,
    policy.shipping.ask_forwarder ? 'Ask whether the customer already has a shipping company they trust, or wants our help arranging shipping.' : '',
    policy.shipping.partners_note,
    `Payment policy (say this when asked how to pay): ${paymentPolicyAnswer(policy)} ${policy.payment.escalate_note}`,
  ].filter(Boolean).join(' ');
}

/** Read the current policy (falls back to the defaults if never saved). */
export async function getBusinessPolicy(): Promise<BusinessPolicy> {
  try {
    const r = await one<any>(`SELECT setting_value FROM business_settings WHERE setting_key='business_policy' LIMIT 1`);
    if (!r?.setting_value) return { ...DEFAULT_POLICY };
    const parsed = typeof r.setting_value === 'object' ? r.setting_value : JSON.parse(String(r.setting_value));
    return normalizePolicy(parsed, DEFAULT_POLICY);
  } catch { return { ...DEFAULT_POLICY }; }
}

/** Save a new version. Every change is audited with actor + before/after (brief: versioned + audited). */
export async function saveBusinessPolicy(input: any, actor: string) {
  const current = await getBusinessPolicy();
  const next = normalizePolicy({ ...input, version: current.version + 1, updated_at: new Date().toISOString(), updated_by: actor }, current);
  await db().execute(`INSERT INTO business_settings(setting_key,setting_value) VALUES('business_policy',?)
    ON DUPLICATE KEY UPDATE setting_value=VALUES(setting_value)`, [JSON.stringify(next)]);
  try {
    await db().execute('INSERT INTO audit_logs(actor,action,entity_type,entity_id,details) VALUES(?,?,?,?,?)',
      [String(actor || 'admin').slice(0, 191), 'business_policy.updated', 'business_policy', String(next.version),
       JSON.stringify({ before: { version: current.version, shipping: current.shipping, payment: current.payment, style: current.style }, after: { version: next.version, shipping: next.shipping, payment: next.payment, style: next.style } }).slice(0, 8000)]);
  } catch { /* auditing must not block saving; the version bump is still stored */ }
  return next;
}
