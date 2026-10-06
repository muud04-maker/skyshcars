/*
  "I don't know yet" behaviour (pure + testable).

  The AI is a sales assistant, not an oracle: when it has no verified answer it must NOT invent one.
  It sends ONE short holding line, flags the chat for staff and then waits (the chat is paused) until
  the owner replies or returns the chat to the AI.
*/

export type HoldLang = 'en' | 'ar' | 'so';

const HOLDING: Record<HoldLang, string> = {
  en: 'Let me confirm that for you.',
  so: 'Waan kuu xaqiijinayaa.',
  ar: '\u062f\u0639\u0646\u064a \u0623\u062a\u0623\u0643\u062f \u0644\u0643.',
};

export function holdingLine(lang?: string | null) {
  const l = String(lang || 'en') as HoldLang;
  return HOLDING[l] || HOLDING.en;
}

/** True when this text is (or starts with) one of our holding lines - so we never send it twice. */
export function isHolding(text?: string | null) {
  const t = String(text || '').trim();
  if (!t) return false;
  return Object.values(HOLDING).some((h) => t === h || t.startsWith(h));
}

/**
 * Should the AI hold instead of answering? Only when the message really wants an answer and we have
 * no grounded information (no matching car in the AI Catalog).
 */
export function shouldHold(input: { grounded: boolean; question: boolean; request: boolean }) {
  if (input.grounded) return false;
  return !!(input.question || input.request);
}
