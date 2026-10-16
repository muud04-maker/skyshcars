/*
  Buying-signal detection (brief item 6, pure + testable).

  Real evidence: 14 customer messages in the dump ask about paying/ordering, 10 about availability,
  25 about shipping and 75 about price - those are the moments a salesperson must act on, and the
  agent should hand them to a human with ONE clear next step instead of a vague hold.

  Two rules that matter:
    - a signal is TRIAGE, never a claim: we never tell the customer an order/payment/booking exists
      (the dump contains no such verified record),
    - the next step must be relevant to the signal (pay -> payment procedure, shipping -> destination,
      availability -> confirm the unit, price -> the verified price).
*/

export type BuyingSignal = 'ready_to_buy' | 'payment' | 'availability' | 'shipping' | 'price' | 'photos' | null;

const READY = /\b(i (?:want|will take|will buy|am buying|need) (?:this|it|that|the car|the bike|this one)|i'?ll take it|i am ready|ready to (?:buy|pay|order)|reserve (?:it|this)|book (?:it|this)|let'?s do it|how do i (?:pay|buy|order)|where do i (?:pay|send the money)|send me the invoice|i'?ll send (?:the )?(?:money|deposit)|can i (?:pay|reserve))\b/i;
const PAYMENT = /\b(pay|payment|deposit|bank|transfer|invoice|wire|remit|western union|money ?gram)\b/i;
const AVAIL = /\b(still available|available|availability|in stock|do you (?:still )?have|is it (?:still )?there|sold|reserved)\b/i;
const SHIP = /\b(ship|shipping|freight|deliver|delivery|port|destination|customs|clearance|container)\b/i;
const PRICE = /\b(price|cost|how much|discount|negotiat|final price|best price)\b|\$/i;
const PHOTO = /\b(photos?|pictures?|pics?|images?|sawir|video)\b/i;

/** The strongest signal in the message (ready-to-buy and payment outrank a general price question). */
export function buyingSignal(text: unknown): BuyingSignal {
  const t = String(text == null ? '' : text);
  if (!t.trim()) return null;
  if (READY.test(t)) return 'ready_to_buy';
  if (PAYMENT.test(t)) return 'payment';
  if (AVAIL.test(t)) return 'availability';
  if (SHIP.test(t)) return 'shipping';
  if (PRICE.test(t)) return 'price';
  if (PHOTO.test(t)) return 'photos';
  return null;
}

/** Signals that deserve a human right now (the owner closes the sale; the AI must not invent terms). */
export function needsHumanNow(signal: BuyingSignal) {
  return signal === 'ready_to_buy' || signal === 'payment';
}

/** ONE relevant next step for the AI to offer, tied to what the customer actually asked. */
export function signalNextStep(signal: BuyingSignal) {
  switch (signal) {
    case 'ready_to_buy': return 'Confirm the exact unit and its verified price, then tell the customer the team will send the payment procedure right away.';
    case 'payment': return 'Answer how payment works only from verified business knowledge; if the procedure is not stored, say the team will send the exact steps.';
    case 'availability': return 'Confirm whether that exact unit is still available from the catalogue, then offer the next step.';
    case 'shipping': return 'Ask for the destination port/country if it is not already known, then give the confirmed shipping information or say the team will confirm the rate.';
    case 'price': return 'Give the verified price of the exact unit from the catalogue and offer the next step.';
    case 'photos': return 'Resolve the photo request for that exact unit (real photos, or an honest pending request).';
    default: return '';
  }
}

/** Short internal reason for the staff flag (never shown to the customer). */
export function signalStaffReason(signal: BuyingSignal) {
  switch (signal) {
    case 'ready_to_buy': return 'buying signal: customer is ready to buy - confirm price and payment steps';
    case 'payment': return 'buying signal: customer asked how to pay - send the verified payment procedure';
    case 'availability': return 'buying signal: availability check on a specific unit - confirm stock';
    case 'shipping': return 'buying signal: shipping request - confirm the rate for the destination';
    case 'price': return 'buying signal: price question - confirm the current price';
    case 'photos': return 'buying signal: photo request - send real photos of that exact unit';
    default: return '';
  }
}
