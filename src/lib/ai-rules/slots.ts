/*
  Deterministic slot tracking (Part 5, pure + testable).
  Once the customer has told us a destination, budget, body type, steering, fuel or transmission we
  remember it and never ask for it again.
*/

export type Slots = {
  destination?: string | null;
  budget_usd?: number | null;
  body_type?: string | null;
  steering?: 'LHD' | 'RHD' | null;
  fuel?: string | null;
  transmission?: string | null;
};
export type SlotHints = { countries?: string[]; ports?: string[] };

const BODY = /\b(suv|sedan|saloon|hatchback|wagon|estate|pickup|minivan|coupe|convertible|van|bus|truck)\b/i;
const FUEL = /\b(petrol|gasoline|gas|diesel|hybrid|electric|ev)\b/i;
const TRANS = /\b(automatic|auto|manual)\b/i;
const LHD = /\b(lhd|left[\s-]?hand|left[\s-]?drive)\b/i;
const RHD = /\b(rhd|right[\s-]?hand|right[\s-]?drive)\b/i;

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Slot name from a description the customer gave, merged over whatever we already knew. */
export function extractSlots(text: unknown, hints: SlotHints = {}, prev: Slots = {}): Slots {
  const raw = String(text == null ? '' : text);
  const out: Slots = { ...prev };
  if (!raw.trim()) return out;
  const t = ' ' + raw.toLowerCase() + ' ';

  // Budget: "$5000", "5,000 usd", "10k", "budget 8000". Never a bare year like "2011".
  const k = t.match(/\b(\d{1,3})\s*k\b/);
  if (k) out.budget_usd = Number(k[1]) * 1000;
  else {
    const m = t.match(/(?:\$|usd|us\$)\s*(\d[\d,]{1,})/) || t.match(/(\d[\d,]{2,})\s*(?:usd|dollars?)/) || t.match(/\bbudget\D{0,12}?(\d[\d,]{1,})/);
    if (m) { const n = Number(String(m[1]).replace(/,/g, '')); if (n >= 500) out.budget_usd = n; }
  }

  if (LHD.test(raw)) out.steering = 'LHD';
  else if (RHD.test(raw)) out.steering = 'RHD';

  const b = raw.match(BODY);
  if (b) out.body_type = /^saloon$/i.test(b[1]) ? 'sedan' : b[1].toLowerCase();

  const f = raw.match(FUEL);
  if (f) { const x = f[1].toLowerCase(); out.fuel = x === 'gasoline' || x === 'gas' ? 'petrol' : x === 'ev' ? 'electric' : x; }

  const tr = raw.match(TRANS);
  if (tr) { const x = tr[1].toLowerCase(); out.transmission = x === 'auto' ? 'automatic' : x; }

  // Destination: a country or port we actually ship to, named in the message.
  const names = [...(hints.countries || []), ...(hints.ports || [])].filter(Boolean)
    .slice().sort((a, b) => String(b).length - String(a).length);
  for (const n of names) {
    const name = String(n);
    if (name.length >= 3 && new RegExp(`\\b${esc(name.toLowerCase())}\\b`).test(t)) { out.destination = name; break; }
  }
  return out;
}

export const SLOT_ORDER: (keyof Slots)[] = ['destination', 'budget_usd', 'body_type', 'steering', 'fuel', 'transmission'];

const has = (v: any) => !(v == null || v === '' || (typeof v === 'number' && !Number.isFinite(v)));

/** Slots still unknown, most useful question first. */
export function missingSlots(slots: Slots = {}) {
  return SLOT_ORDER.filter(k => !has((slots as any)[k]));
}

/** The single best question to ask next, given what is still missing. */
export function nextQuestion(slots: Slots = {}) {
  const q: Record<string, string> = {
    destination: 'Which country or port should we ship to?',
    budget_usd: 'What is your budget?',
    body_type: 'Do you prefer a sedan, SUV or pickup?',
    steering: 'Do you need left-hand or right-hand drive?',
    fuel: 'Do you prefer petrol, diesel or hybrid?',
    transmission: 'Automatic or manual?',
  };
  const missing = missingSlots(slots);
  return missing.length ? q[missing[0]] : null;
}
