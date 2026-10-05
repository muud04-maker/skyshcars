/*
  Builds the reply text for a customer burst (no sending). Used by the sales engine and the admin
  "Test the AI" box. Parts 3-5 extend this: referral, strict matching, context, slots.
*/
import { salesReply, AI_MODEL } from './ai';
import { planPhotos } from './whatsapp-photos';
import { detectLanguage } from './ai-rules/welcome';
import type { ComposeIn, ComposeOut } from './ai-rules/engine-core';

export function welcomeNote(i: { welcomeDue: boolean }) {
  return i.welcomeDue
    ? 'The system automatically adds our website and WhatsApp group invitation after your answer. Do NOT include any website or group link yourself.'
    : 'The welcome (website + WhatsApp group invitation) was already sent to this customer earlier. Do NOT send our website or group link again unless the customer explicitly asks for it.';
}

const money = (n: any) => { const v = Number(n); return Number.isFinite(v) && v > 0 ? '$' + v.toLocaleString('en-US') : ''; };

/** Part 3: what the AI knows and must say when the customer tapped a Facebook ad/post. */
export function referralNote(i: ComposeIn) {
  if (!i.referral) return '';
  const v: any = i.referralVehicle;
  if (!v) return ' The customer arrived by tapping a Facebook ad/post, but that exact post could not be matched to our stock. Say so honestly in one short line, then ask which vehicle they are looking for. Never invent what the post said.';
  const title = [v.model_year, v.brand, v.model, v.trim_name].filter(Boolean).join(' ') || `stock ${v.stock_no || ''}`;
  if (i.referralAiEnabled === false) {
    return ` The customer tapped the Facebook post for ${title}${v.stock_no ? ` (our stock ${v.stock_no})` : ''}, but that car is NOT available for sale right now. Say briefly that it is not available right now, do NOT quote a price and do NOT offer photos of it, then offer one or two alternatives we can sell.`;
  }
  const bits = [money(v.price_usd) && `price ${money(v.price_usd)}`, v.transmission, v.fuel_type, v.steering,
    v.mileage_km ? `${Number(v.mileage_km).toLocaleString('en-US')} km` : null].filter(Boolean).join(', ');
  return ` The customer tapped our Facebook post for exactly this car: ${title}${v.stock_no ? `, stock ${v.stock_no}` : ''}${bits ? ` (${bits})` : ''}, ${Number(v.exact_photo_count || 0)} exact photo(s) on file. Answer with its name, year, price and the key specs above, then ask ONLY for the destination. Do NOT ask which vehicle they mean.`;
}

export async function composeReply(i: ComposeIn & { dryRun?: boolean }): Promise<ComposeOut> {
  const text = i.words || 'The customer sent a photo/voice note/document without words. Reply briefly and ask what they are looking for.';
  const lang = detectLanguage(i.words);
  const photoPlan = i.dryRun ? null : await planPhotos(text, i.conversationId).catch(() => null);
  const reply = await salesReply(text, i.conversationId, photoPlan, { note: welcomeNote(i) + referralNote(i) + ` Reply in ${lang === 'ar' ? 'Arabic' : lang === 'so' ? 'Somali' : 'English'}.` });
  return { text: String(reply || ''), lang, model: AI_MODEL, vehicleId: photoPlan?.vehicleId || null, photoPlan };
}
