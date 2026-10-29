import { createHash, timingSafeEqual } from 'crypto';
import { normalizeMileageKm, normalizePrice } from './inventory-identity-rules';

export const TELEGRAM_ENV_NAMES = {
  botToken: 'TELEGRAM_BOT_TOKEN',
  webhookSecret: 'TELEGRAM_WEBHOOK_SECRET',
  sourceChatId: 'TELEGRAM_SOURCE_CHAT_ID',
} as const;

export type TelegramPhoto = {
  file_id: string;
  file_unique_id: string;
  width?: number;
  height?: number;
  file_size?: number;
};

export function telegramSecret() {
  return String(process.env.TELEGRAM_WEBHOOK_SECRET || '').trim();
}

export function telegramBotToken() {
  return String(process.env.TELEGRAM_BOT_TOKEN || '').trim();
}

export function telegramSourceChatId() {
  return String(process.env.TELEGRAM_SOURCE_CHAT_ID || '').trim();
}

/** Telegram getChat/getChatMember require @ for a public username, while the env may omit it. */
export function telegramChatApiId(value: string | null | undefined = telegramSourceChatId()) {
  const configured = String(value || '').trim();
  if (!configured) return '';
  if (/^-\d+$/.test(configured) || /^@[\w]+$/.test(configured)) return configured;
  if (/^[A-Za-z][A-Za-z0-9_]{4,}$/.test(configured)) return `@${configured}`;
  return configured;
}

export function telegramConfigSummary() {
  return {
    bot_token_present: !!telegramBotToken(),
    webhook_secret_present: !!telegramSecret(),
    source_chat_id_present: !!telegramSourceChatId(),
    configured: !!(telegramBotToken() && telegramSecret() && telegramSourceChatId()),
    required_names: TELEGRAM_ENV_NAMES,
    webhook_path: '/api/integrations/telegram/webhook',
  };
}

/** Constant-time comparison of the exact Telegram secret-token header. */
export function telegramSecretMatches(given: string | null | undefined) {
  const expected = telegramSecret();
  const supplied = String(given || '');
  if (!expected || !supplied) return false;
  const a = createHash('sha256').update(expected).digest();
  const b = createHash('sha256').update(supplied).digest();
  return timingSafeEqual(a, b);
}

/** Exact chat ID, with optional exact @username support when the configured source is not numeric. */
export function telegramChatAllowed(chat: any) {
  const configured = telegramSourceChatId();
  if (!configured || !chat) return false;
  const id = String(chat.id ?? chat.chat_id ?? '').trim();
  if (id && id === configured) return true;
  const username = String(chat.username || '').trim();
  if (!username) return false;
  return configured === `@${username}` || configured === username;
}

export function largestTelegramPhoto(message: any): TelegramPhoto | null {
  const photos = Array.isArray(message?.photo) ? message.photo : [];
  const largest = photos
    .filter((photo: any) => photo?.file_id && photo?.file_unique_id)
    .sort((a: any, b: any) => (Number(b.width || 0) * Number(b.height || 0)) - (Number(a.width || 0) * Number(a.height || 0)))[0];
  if (largest) return largest;
  const document = message?.document;
  if (document?.file_id && /^image\//i.test(String(document.mime_type || ''))) {
    return {
      file_id: String(document.file_id),
      file_unique_id: String(document.file_unique_id || document.file_id),
      file_size: Number(document.file_size || 0) || undefined,
    };
  }
  return null;
}

export function telegramText(message: any) {
  return String(message?.caption || message?.text || '').trim();
}

export function telegramMessageKind(message: any) {
  if (largestTelegramPhoto(message)) return 'photo';
  if (message?.text) return 'text';
  return 'other';
}

export type TelegramAvailability = 'available' | 'unavailable' | 'unspecified';

export function telegramAvailability(text: string, extracted?: unknown): TelegramAvailability {
  const stated = String(extracted || '').toLowerCase();
  if (['available', 'in stock', 'in_stock'].includes(stated)) return 'available';
  if (['sold', 'reserved', 'unavailable', 'not available', 'out of stock'].includes(stated)) return 'unavailable';
  const value = String(text || '');
  const soldMention = /\bsold\b/i.test(value) && !/\b(?:not|never)\s+sold\b/i.test(value);
  if (soldMention || /\b(sold\s*out|sale\s+pending|reserved|deposit\s+(taken|paid)|not\s+available|unavailable|out\s+of\s+stock)\b/i.test(value)) return 'unavailable';
  if (/\b(available|in\s+stock|for\s+sale|ready\s+for\s+shipment)\b/i.test(value)) return 'available';
  return 'unspecified';
}

export type TelegramAutoInput = {
  match_status?: string | null;
  review_status?: string | null;
  extraction_confidence?: number | string | null;
  price_value?: number | string | null;
  price_usd?: number | string | null;
  price_currency?: string | null;
  brand?: string | null;
  model?: string | null;
  model_year?: number | string | null;
  mileage_km?: number | string | null;
  mileage_value?: number | string | null;
  mileage_unit?: string | null;
  category?: string | null;
  availability?: unknown;
  text?: string | null;
  photo_count?: number | string | null;
};

export type TelegramAutoDecision = {
  eligible: boolean;
  reasons: string[];
  price_usd: number | null;
  price_currency: string | null;
  mileage_km: number | null;
};

/**
 * Auto-publication is intentionally strict: a new identity, complete core specs, an original
 * photo, a configured USD price and no sold/reserved signal. Everything else stays in review.
 */
export function decideTelegramAutoPublish(input: TelegramAutoInput, minConfidence = 0.65): TelegramAutoDecision {
  const reasons: string[] = [];
  const price = normalizePrice(input.price_usd ?? input.price_value, input.price_currency);
  const currency = price.currency;
  const priceUsd = currency === 'USD' ? price.value : null;
  const photoCount = Math.max(0, Number(input.photo_count) || 0);
  const confidence = Number(input.extraction_confidence);
  const availability = telegramAvailability(String(input.text || ''), input.availability);

  if (input.match_status !== 'new') reasons.push('vehicle identity is not a confident new listing');
  if (input.review_status && input.review_status !== 'pending') reasons.push('import is not pending automatic review');
  if (!input.brand || !input.model) reasons.push('make or model is missing');
  if (!input.model_year && !String(input.model_year || '').match(/(?:19|20)\d{2}/)) reasons.push('year is missing');
  if (!['car', 'motorcycle', 'truck', 'van', 'bus', 'machinery'].includes(String(input.category || ''))) reasons.push('vehicle category is missing or unverified');
  if (!photoUsd(priceUsd)) reasons.push('an exact USD selling price is required');
  if (currency !== 'USD') reasons.push('price currency is not USD');
  if (photoCount < 1) reasons.push('original vehicle photo is missing');
  if (!Number.isFinite(confidence) || confidence < minConfidence) reasons.push('extraction confidence is below the automatic threshold');
  if (availability === 'unavailable') reasons.push('listing says the vehicle is sold, reserved or unavailable');

  return {
    eligible: reasons.length === 0,
    reasons,
    price_usd: priceUsd,
    price_currency: currency,
    mileage_km: normalizeMileageKm(input.mileage_km ?? input.mileage_value, input.mileage_unit || 'km'),
  };
}

function photoUsd(value: number | null): value is number {
  return value !== null && Number.isFinite(value) && value > 0;
}
