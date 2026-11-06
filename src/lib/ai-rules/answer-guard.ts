/*
  When must a composed AI reply be held for staff? (pure + testable)

  Before: any question without a matched vehicle name was replaced by "Let me confirm that for you."
  and the chat was paused - 66 times in the Nov 6 dump, including "Where are you located?",
  "Do you have pick up?" and "What do you want to confirm for me". The model already had the
  business policy, the approved knowledge and the staff replies, so its answer was usually fine.

  Now the reply is only held when it is empty, or when it quotes a money amount that appears in none
  of the verified sources (facts, policy, knowledge, staff replies). Everything else is sent.
*/

const AMOUNT = /(?:\$|usd\s?|us\$)\s?(\d[\d,]*(?:\.\d+)?)\s?(k\b)?|(\d[\d,]*(?:\.\d+)?)\s?(k\b)?\s?(?:usd|dollars?|\$)/gi;

const norm = (n: string, k?: string) => {
  const v = Number(String(n).replace(/,/g, ''));
  return Number.isFinite(v) ? String(Math.round(k ? v * 1000 : v)) : '';
};

/** All money amounts in a text, as plain integer strings ("$1,200" -> "1200", "2k usd" -> "2000"). */
export function amountsIn(text: unknown): string[] {
  const out: string[] = [];
  for (const m of String(text == null ? '' : text).matchAll(AMOUNT)) {
    const v = m[1] ? norm(m[1], m[2]) : norm(m[3], m[4]);
    if (v && v !== '0') out.push(v);
  }
  return [...new Set(out)];
}

/** Every number (any format) that appears in the verified sources. */
function numbersIn(texts: unknown[]): Set<string> {
  const s = new Set<string>();
  for (const t of texts) {
    for (const m of String(t == null ? '' : t).matchAll(/\d[\d,]*(?:\.\d+)?/g)) {
      const v = norm(m[0]);
      if (v) s.add(v);
    }
  }
  return s;
}

/** Amounts in the reply that no verified source contains. */
export function unverifiedAmounts(reply: unknown, verified: unknown[]): string[] {
  const allowed = numbersIn(verified);
  return amountsIn(reply).filter((a) => !allowed.has(a));
}

const HOLDISH = /\b(let me (confirm|check)|i will (confirm|check)|our team will (confirm|check|reply)|will get back to you)\b/i;

/** The model itself said it does not know (useful to flag staff without silencing the chat). */
export function admitsUnknown(reply: unknown) {
  return HOLDISH.test(String(reply == null ? '' : reply));
}

export type HoldDecision = { hold: boolean; flag: string | null };

export function decideHold(input: { reply: string; wantsAnswer: boolean; grounded: boolean; verified: unknown[] }): HoldDecision {
  const reply = String(input.reply || '').trim();
  if (!reply) return { hold: input.wantsAnswer, flag: input.wantsAnswer ? 'No reply could be composed - please answer this customer' : null };
  const bad = unverifiedAmounts(reply, input.verified);
  if (bad.length) return { hold: true, flag: `AI reply quoted unverified amount(s) ${bad.map((b) => '$' + b).join(', ')} - confirm before replying` };
  if (input.wantsAnswer && !input.grounded && admitsUnknown(reply)) {
    return { hold: false, flag: 'AI answered but said the team will confirm - please follow up' };
  }
  return { hold: false, flag: null };
}
