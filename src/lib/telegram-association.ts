export type VehicleKind = 'car' | 'motorcycle' | 'unknown';

const MOTORCYCLE_TERMS = /\b(motorcycle|motorbike|moto|bike|scooter|bobber|bonneville|speedmaster|scrambler|cbr|cb\d|ninja|harley|ducati|triumph|kawasaki|yamaha|suzuki gsx|bmw motorrad)\b/i;
const CAR_TERMS = /\b(car|suv|sedan|hatchback|pickup|touareg|passat|golf|corolla|hilux|prado|land cruiser|rav4|q3|q5|q7|x5|x6|c-class|e-class)\b/i;
const MOTORCYCLE_CONTEXT = /\b(cc|cubic)\b/i;
const CAR_BRANDS = /\b(volkswagen|vw|audi|toyota|nissan|mazda|mitsubishi|hyundai|kia|ford|chevrolet|mercedes|lexus|chery|geely|haval|changan|dongfeng|peugeot|renault|skoda|seat)\b/i;

export function vehicleKindFromText(text: unknown): VehicleKind {
  const value = String(text || '');
  const motorcycle = MOTORCYCLE_TERMS.test(value) || (MOTORCYCLE_CONTEXT.test(value) && /\b(engine|bobber|cruiser|street|sport)\b/i.test(value));
  if (motorcycle) return 'motorcycle';
  if (CAR_TERMS.test(value) || CAR_BRANDS.test(value)) return 'car';
  return 'unknown';
}

export function vehicleKindFromImageDescriptions(descriptions: unknown): VehicleKind {
  const text = Array.isArray(descriptions) ? descriptions.join(' ') : String(descriptions || '');
  const motorcycle = /\b(motorcycle|motorbike|scooter|bike|two[- ]wheeler|rider|handlebars and tank)\b/i.test(text);
  const car = /\b(car|suv|sedan|hatchback|pickup|van|four[- ]wheel|bonnet|windshield)\b/i.test(text);
  if (motorcycle && !car) return 'motorcycle';
  if (car && !motorcycle) return 'car';
  return 'unknown';
}

export type AssociationInput = {
  explicitReply: boolean;
  sameMediaGroup: boolean;
  previousHasText: boolean;
  previousHasMedia: boolean;
  previousTextKind: VehicleKind;
  previousMediaKind: VehicleKind;
  currentHasText: boolean;
  currentHasMedia: boolean;
  currentTextKind: VehicleKind;
  currentMediaKind: VehicleKind;
  messageDistance: number | null;
  secondsApart: number | null;
  uniqueAdjacentCandidate?: boolean;
};

export type AssociationDecision = {
  allowed: boolean;
  status: 'same_album' | 'explicit_reply' | 'semantic_adjacent' | 'ambiguous' | 'unrelated';
  reason: string;
};

/**
 * Association is intentionally conservative. Time proximity alone is never sufficient:
 * an adjacent text/photo pair must also have compatible vehicle-class evidence.
 */
export function decideTelegramAssociation(input: AssociationInput): AssociationDecision {
  if (input.sameMediaGroup) {
    return { allowed: true, status: 'same_album', reason: 'native Telegram media_group_id' };
  }
  if (input.explicitReply) {
    return { allowed: true, status: 'explicit_reply', reason: 'Telegram reply_to_message relationship' };
  }
  if (input.previousHasMedia && input.currentHasMedia) {
    return { allowed: false, status: 'unrelated', reason: 'two photo sets are never merged without an explicit reply' };
  }
  if (input.previousHasText && input.currentHasText) {
    return { allowed: false, status: 'unrelated', reason: 'two descriptions are never merged without an explicit reply' };
  }
  if (input.previousHasText === input.currentHasText && input.previousHasMedia === input.currentHasMedia) {
    return { allowed: false, status: 'unrelated', reason: 'both sides have the same text/media shape' };
  }
  if (input.messageDistance === null || input.messageDistance > 2) {
    return { allowed: false, status: 'ambiguous', reason: 'messages are not adjacent enough to associate safely' };
  }
  if (input.secondsApart === null || input.secondsApart > 45) {
    return { allowed: false, status: 'ambiguous', reason: 'timestamp gap is too large to associate safely' };
  }
  const textKind = input.currentHasText ? input.currentTextKind : input.previousTextKind;
  const mediaKind = input.currentHasMedia ? input.currentMediaKind : input.previousMediaKind;
  if (textKind !== 'unknown' && mediaKind !== 'unknown' && textKind !== mediaKind) {
    return { allowed: false, status: 'unrelated', reason: `text is ${textKind} but photos appear to be ${mediaKind}` };
  }
  if (textKind === 'unknown' || mediaKind === 'unknown') {
    if (input.uniqueAdjacentCandidate) {
      return { allowed: true, status: 'semantic_adjacent', reason: 'unique adjacent text/photo pair in message order' };
    }
    return { allowed: false, status: 'ambiguous', reason: 'vehicle-class evidence is missing for the text/photo pair' };
  }
  return { allowed: true, status: 'semantic_adjacent', reason: `adjacent ${textKind} text and photo evidence match` };
}

export function telegramMessageNumber(messageKey: unknown): number | null {
  const match = /:(\d+)$/.exec(String(messageKey || ''));
  const value = Number(match?.[1]);
  return Number.isSafeInteger(value) ? value : null;
}

export function minimumMessageDistance(left: unknown[], right: unknown[]): number | null {
  const a = left.map(telegramMessageNumber).filter((n): n is number => n !== null);
  const b = right.map(telegramMessageNumber).filter((n): n is number => n !== null);
  if (!a.length || !b.length) return null;
  let best = Number.POSITIVE_INFINITY;
  for (const x of a) for (const y of b) best = Math.min(best, Math.abs(x - y));
  return Number.isFinite(best) ? best : null;
}
