/*
  Post-processing guard for AI replies (Part 9, pure + testable).

  Failure E: the AI invented history ("you were looking at the FAW Besturn X80") for a car that was
  never mentioned. The model is told not to; this code makes sure of it: any sentence that claims
  the customer was previously interested in a car is dropped unless it names one of the cars we
  actually know about (the current car, a referred/matched car).
*/

const HISTORY_CLAIM = /\b(?:you (?:were|are|had|have)\s+(?:looking at|interested in|asking about|enquired about|considering)|as you (?:said|mentioned|noted)|you (?:mentioned|asked about|were after)|the\s+[\w\s-]{0,30}?\s+you (?:were|are)\s+(?:looking at|interested in|after))\b/i;

/** The words we compare against: the last two meaningful words of each allowed car name. */
function keysFor(name: string) {
  const words = String(name || '').toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ').split(/\s+/).filter(Boolean);
  if (words.length < 2) return words.filter((w) => w.length >= 3);
  return [words.slice(-2).join(' '), words[words.length - 1]].filter((k) => k.length >= 3);
}

/**
 * Remove sentences that claim the customer was previously interested in a car we do not know about.
 * `allowedNames` are the cars that really came up (current car, referral, matched stock).
 */
export function stripInventedHistory(reply: string, allowedNames: string[] = []) {
  const src = String(reply || '');
  if (!src.trim() || !allowedNames.length) return src;
  const keys = [...new Set(allowedNames.flatMap(keysFor))];
  if (!keys.length) return src;
  const mentionsKnownCar = (seg: string) => { const t = seg.toLowerCase(); return keys.some((k) => t.includes(k)); };
  return src.split('\n').map((line) => line.split(/(?<=[.!?])\s+/)
    .filter((seg) => !HISTORY_CLAIM.test(seg) || mentionsKnownCar(seg))
    .join(' ')).filter((l) => l.trim() !== '').join('\n').replace(/\n{3,}/g, '\n\n').trim();
}
