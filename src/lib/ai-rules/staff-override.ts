/*
  Staff knowledge overrides the AI (pure + testable).

  If a colleague already told the customer "we sold this car" / "not available" / a corrected price,
  the AI must never contradict that. The prompt says so; this code enforces it deterministically.
*/

export type StaffFact = 'sold' | 'unavailable' | 'price' | 'shipping' | null;

const SOLD = /\b(we sold|it'?s sold|is sold|already sold|sold out|no longer available|not available anymore)\b/i;
const UNAVAIL = /\b(not available|unavailable|reserved for|already reserved|taken|gone)\b/i;
const PRICE = /\b(price (is|was|should be)|correct price|actual price|the price is|new price)\b/i;
const SHIPPING = /\b(shipping (is|to|cost|price)|freight (is|to|cost))\b/i;

export function staffFact(text?: string | null): StaffFact {
  const t = String(text || '');
  if (!t.trim()) return null;
  if (SOLD.test(t)) return 'sold';
  if (UNAVAIL.test(t)) return 'unavailable';
  if (PRICE.test(t)) return 'price';
  if (SHIPPING.test(t)) return 'shipping';
  return null;
}

const CLAIMS_AVAILABLE = /\b(available|in stock|we have (it|one)|still have|ready to ship)\b/i;

/**
 * When staff said the car is gone, an AI reply that still claims availability is replaced by the
 * honest sold line. Returns the reply unchanged in every other case.
 */
export function applyStaffOverride(reply: string, staffText?: string | null) {
  const fact = staffFact(staffText);
  if (fact !== 'sold' && fact !== 'unavailable') return String(reply || '');
  const r = String(reply || '');
  if (!CLAIMS_AVAILABLE.test(r)) return r;
  return 'That one has been sold. I can show you similar available cars.';
}
