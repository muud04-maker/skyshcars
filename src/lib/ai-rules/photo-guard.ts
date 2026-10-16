/*
  Photo-integrity guard (pure + testable).

  Real production evidence (messages dump, 2972 messages): customers asked for photos in 151 messages
  (16% of all customer messages), and of the 5 texts we actually delivered that said "sending you the
  photos", 2 arrived with no photo at all - one of them received NOTHING afterwards. The owner covers
  the rest by hand (330 "[Staff sent a photo]" markers).

  A prompt instruction is not enough, so this is a code-level guarantee on every AI reply:
    plan === 'sending'        -> the photos really are on their way, leave the text alone
    plan === 'no_exact_photos'-> the customer must be told honestly, and staff get a tracked request
    plan === 'already_sent'   -> point at the photos already sent in this chat
    plan === 'no_vehicle'     -> ask ONE short question (model or stock number)
  It only ever touches the sentences about photos; everything else in the reply is untouched.
*/

export type PhotoGuardPlan = { status?: string | null; title?: string | null; stockNo?: string | null; vehicleId?: number | null } | null | undefined;

/** Does this sentence promise/send photos right now? (offers are handled separately) */
const PROMISE = /\b(?:i'?m |i am )?sending (?:you )?(?:the )?(?:photos?|pictures?|pics?|images?|videos?)\b|\bi'?ll send (?:you )?(?:the )?(?:photos?|pictures?|pics?|images?)\b|\bhere are (?:the )?(?:photos?|pictures?|images?)\b|\b(?:photos?|pictures?|images?) (?:are |were )?sent\b|\bsent (?:you )?(?:the )?(?:photos?|pictures?|pics?|images?)\b/i;
const MENTION = /\b(photos?|pictures?|pics?|images?|sawir\w*|\u0635\u0648\u0631|\u7167\u7247)\b/i;
const OFFER = /\b(?:i can (?:also )?send|i can share|want me to send|shall i send|would you like (?:me to send )?(?:the )?photos|can send you)\b/i;

const vesselName = (plan: PhotoGuardPlan) => String(plan?.title || '').trim() || (plan?.stockNo ? `stock ${plan.stockNo}` : 'this vehicle');

/** The honest line for a photo plan that is not going to deliver photos right now. */
export function photoHonestyLine(plan: PhotoGuardPlan): string {
  const status = String(plan?.status || '');
  if (status === 'already_sent') return 'I sent the photos of this vehicle just above in this chat.';
  if (status === 'no_vehicle') return 'Which vehicle would you like photos of? Send me the model or the stock number and I will check it for you.';
  return `We don't have exact photos of ${vesselName(plan)} yet. Our team can request real photos of this unit from the yard for you.`;
}

/**
 * Guarantee the reply cannot promise photos it will not deliver.
 * Returns the (possibly rewritten) text plus what the guard did, so the caller can flag staff.
 */
export function enforcePhotoHonesty(text: string, plan: PhotoGuardPlan): { text: string; changed: 'none' | 'replaced' | 'appended' } {
  const src = String(text || '');
  const status = String(plan?.status || '');
  // No plan, or photos really are being sent: nothing to do.
  if (!src.trim() || !status || status === 'sending') return { text: src, changed: 'none' };
  const honest = photoHonestyLine(plan);

  const segments = src.split(/(?<=[.!?\n])\s+/).map((s) => s.trim()).filter(Boolean);
  // Replace every sentence that promises photos, drop the now-meaningless photo offers around it, and
  // end with the honest line. Everything unrelated to photos survives untouched.
  if (segments.some((seg) => PROMISE.test(seg))) {
    const kept = segments.filter((seg) => !PROMISE.test(seg) && !(OFFER.test(seg) && MENTION.test(seg)));
    return { text: [...kept, honest].join(' ').replace(/\s{2,}/g, ' ').trim(), changed: 'replaced' };
  }
  // The customer asked for photos but the reply never addresses it: add the honest answer.
  if (!MENTION.test(src)) return { text: `${src.trim()}\n\n${honest}`.trim(), changed: 'appended' };
  // The reply mentions photos as an offer only: leave the text, it is not a promise.
  return { text: src, changed: 'none' };
}

/** True when this plan needs a human to fetch real photos (tracked staff request, Phase 4 item 8). */
export function needsStaffPhotoRequest(plan: PhotoGuardPlan) {
  return String(plan?.status || '') === 'no_exact_photos';
}
