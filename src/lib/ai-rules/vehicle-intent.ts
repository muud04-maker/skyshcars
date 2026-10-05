/*
  Follow-up detection for the per-chat CURRENT CAR (Part 4, pure + testable).

  "how much is it?", "send photos", "is it still available?" carry no brand/model, so the strict
  matcher returns nothing. These helpers say the message points back at the car we were already
  discussing, so the reply can use the current car instead of asking "which vehicle?" again.
*/
import { isGenericOnly } from './match';

export type FollowUpTopic = 'price' | 'photos' | 'availability' | 'specs' | 'shipping' | 'location' | null;

const RE: Record<Exclude<FollowUpTopic, null>, RegExp> = {
  price: /\b(price|prices|cost|costs|how much|howmuch|quote|rate|qiimo|qiimaha|meeqa|imisa)\b|\u0633\u0639\u0631|\u0643\u0645/i,
  photos: /\b(photos?|pictures?|pics?|images?|sawir|sawiro|video|videos)\b|\u0635\u0648\u0631/i,
  availability: /\b(still available|available|availability|in stock|sold|reserved|haysaa|haysataan|jiraa|ma jiraa)\b|\u0645\u062a\u0648\u0641\u0631|\u0645\u062a\u0627\u062d/i,
  specs: /\b(engine|automatic|manual|mileage|kilometres?|kilometers?|kms?|fuel|petrol|diesel|transmission|gearbox|steering|lhd|rhd|seats?|sunroof|specs?|specifications?)\b/i,
  shipping: /\b(ship|ships|shipping|deliver|delivery|destination|destination port|port|freight|track|tracking)\b/i,
  location: /\b(where|location|located|warehouse|which city|city)\b/i,
};

/** Which follow-up topic a message is about (or null when it is not a follow-up). */
export function followUpTopic(text: unknown): FollowUpTopic {
  const t = String(text == null ? '' : text);
  for (const key of Object.keys(RE) as Exclude<FollowUpTopic, null>[]) if (RE[key].test(t)) return key;
  return null;
}

const ANAPHORA = /\b(it|its|it's|this|that|these|those|same one|this one|that one|the (white|black|blue|red|silver|grey|gray) one)\b|\bthe\s+\w+\s+one\b/i;

/** The message clearly points back at a car we were already discussing (a follow-up or "it/this one"). */
export function refersToCurrentCar(text: unknown) {
  const t = String(text == null ? '' : text);
  if (!t.trim()) return false;
  if (followUpTopic(t)) return true;
  // "it"/"this" only count when the message carries no brand/model evidence of its own.
  return isGenericOnly(t) && ANAPHORA.test(t);
}

/** No brand/model/stock evidence in the message at all. */
export function hasNoVehicleEvidence(text: unknown) {
  return isGenericOnly(text);
}
