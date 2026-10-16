/*
  Context assembly + compaction (Parts 13 and 14, pure + testable).

  Before composing a reply the AI gets context in ONE fixed order, and it never receives the whole
  lifetime of a chat: only the latest raw messages plus the structured memory/summary/current
  vehicle/events. The full raw history stays in MySQL for the admin (nothing is ever deleted here).
*/

/** The order the reply engine must assemble context in (Part 13). */
export const CONTEXT_ORDER = [
  'latest_turn',
  'referral',
  'current_vehicle',
  'human_replies_here',
  'recent_history',
  'memory_preferences',
  'catalog_facts',
  'business_knowledge',
  'shipping_quote_facts',
  'approved_lessons',
  'same_day_patterns',
] as const;

export type ContextSection = (typeof CONTEXT_ORDER)[number];

export const DEFAULT_RECENT_MESSAGES = 25;
export const MAX_RECENT_MESSAGES = 40;

export type PackMessage = { sender?: string | null; body?: any; created_at?: any };

/** Latest N raw messages, oldest→newest, with the count of what was left out (never drops the newest). */
export function compactMessages(messages: PackMessage[] = [], limit = DEFAULT_RECENT_MESSAGES) {
  const list = Array.isArray(messages) ? messages : [];
  const n = Math.max(1, Math.min(MAX_RECENT_MESSAGES, Number(limit) || DEFAULT_RECENT_MESSAGES));
  const kept = list.slice(-n);
  return { kept, dropped: Math.max(0, list.length - kept.length), limit: n };
}

/** Preferences → one short human line for the prompt/UI ("motorcycle, Toyota, max $8,000, to Mombasa"). */
export function preferencesLine(prefs: Record<string, any> = {}) {
  const p = prefs || {};
  const bits: string[] = [];
  const add = (v: any) => { const s = v == null ? '' : String(v).trim(); if (s && s !== '0') bits.push(s); };
  add(p.preferred_category);
  add(p.preferred_brand);
  add(p.preferred_model);
  if (p.budget_max) add(`max $${Number(p.budget_max).toLocaleString('en-US')}`);
  if (p.budget_min) add(`min $${Number(p.budget_min).toLocaleString('en-US')}`);
  add(p.body_type);
  add(p.fuel);
  add(p.transmission);
  add(p.steering);
  add(p.color);
  if (p.destination_port) add(`to ${p.destination_port}`);
  else if (p.destination_country) add(`to ${p.destination_country}`);
  return bits.join(', ');
}

/** Memory is only a hint: it must never be used to fake a fact the customer did not give. */
export function memoryIsHint() {
  return true;
}

export type PackInput = {
  latestTurn?: string | null;
  referral?: { vehicle?: any; method?: string | null; headline?: string | null } | null;
  currentVehicle?: any;
  recentMessages?: PackMessage[];
  summary?: string | null;
  preferences?: Record<string, any>;
  facts?: { fact_key: string; fact_value: string }[];
  catalogCount?: number | null;
  knowledge?: { title?: string; content?: string }[];
  shipping?: any;
  lessons?: { lesson?: string | null; event_type?: string }[];
  /** Human (staff) replies from THIS conversation - the strongest in-chat guidance. */
  humanReplies?: { body?: any; created_at?: any }[];
  /** Same-day sales patterns: LOW-PRIORITY hints only (never override exact facts). */
  sameDayPatterns?: { type?: string; value?: string; count?: number }[];
  recentLimit?: number;
};

export type PackOutput = {
  order: ContextSection[];
  present: ContextSection[];
  recent: PackMessage[];
  dropped: number;
  prefsLine: string;
  size: { recent: number; facts: number; knowledge: number; lessons: number };
  humanReplies: PackMessage[];
  sameDayPatterns: { value: string; count: number }[];
};

/**
 * Assemble the context in the required order. Sections that have no data are simply absent - the AI
 * is never handed invented content, and no section can jump the queue.
 */
export function buildContextPack(input: PackInput): PackOutput {
  const { kept, dropped } = compactMessages(input.recentMessages || [], input.recentLimit);
  const facts = (input.facts || []).filter((f) => String(f?.fact_value || '').trim());
  const knowledge = (input.knowledge || []).filter((k) => String(k?.content || '').trim());
  const lessons = (input.lessons || []).filter((l) => String(l?.lesson || '').trim());
  const prefs = { ...(input.preferences || {}) };
  for (const f of facts) if (prefs[f.fact_key] == null) prefs[f.fact_key] = f.fact_value;
  // Step 4: the people on our side answered inside this chat - that beats any general hint.
  const humanReplies = (input.humanReplies || []).filter((h) => String(h?.body || '').trim()).slice(-3);
  // Step 11: weak hints, capped and clearly labelled so they can never outrank the facts above.
  const sameDayPatterns = (input.sameDayPatterns || [])
    .filter((p) => String(p?.value || '').trim())
    .slice(0, 5)
    .map((p) => ({ value: String(p.value).slice(0, 120), count: Number(p.count || 0) }));

  const has: Record<ContextSection, boolean> = {
    latest_turn: !!String(input.latestTurn || '').trim(),
    referral: !!input.referral,
    current_vehicle: !!input.currentVehicle,
    human_replies_here: humanReplies.length > 0,
    recent_history: kept.length > 0,
    memory_preferences: !!String(input.summary || '').trim() || facts.length > 0 || Object.keys(prefs).length > 0,
    catalog_facts: Number(input.catalogCount || 0) > 0,
    business_knowledge: knowledge.length > 0,
    shipping_quote_facts: !!input.shipping,
    approved_lessons: lessons.length > 0,
    same_day_patterns: sameDayPatterns.length > 0,
  };

  return {
    order: [...CONTEXT_ORDER],
    present: CONTEXT_ORDER.filter((s) => has[s]),
    recent: kept,
    dropped,
    prefsLine: preferencesLine(prefs),
    size: { recent: kept.length, facts: facts.length, knowledge: knowledge.length, lessons: lessons.length },
    humanReplies,
    sameDayPatterns,
  };
}

/** The in-chat staff answers, as a short note for the prompt (step 4). */
export function humanRepliesNote(humanReplies: PackMessage[] = []) {
  const lines = (humanReplies || []).map((h) => String(h?.body || '').replace(/\s+/g, ' ').trim().slice(0, 220)).filter(Boolean);
  if (!lines.length) return '';
  return ` OUR TEAM ALREADY TOLD THIS CUSTOMER (in this same chat - follow it, do not contradict it): ${lines.join(' || ')}.`;
}

/** Same-day patterns as LOW-PRIORITY hints (step 11). Never a rule, never an override. */
export function sameDayPatternsNote(patterns: { value?: string; count?: number }[] = []) {
  const lines = (patterns || []).map((p) => String(p?.value || '').replace(/\s+/g, ' ').trim().slice(0, 120)).filter(Boolean);
  if (!lines.length) return '';
  return ` LOW-PRIORITY HINTS from today's real sales activity (${lines.join('; ')}). These are weak hints only: never let them override an exact referral, stock number, price, category or the admin's correction.`;
}
