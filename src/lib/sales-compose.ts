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

export async function composeReply(i: ComposeIn & { dryRun?: boolean }): Promise<ComposeOut> {
  const text = i.words || 'The customer sent a photo/voice note/document without words. Reply briefly and ask what they are looking for.';
  const lang = detectLanguage(i.words);
  const photoPlan = i.dryRun ? null : await planPhotos(text, i.conversationId).catch(() => null);
  const reply = await salesReply(text, i.conversationId, photoPlan, { note: welcomeNote(i) + ` Reply in ${lang === 'ar' ? 'Arabic' : lang === 'so' ? 'Somali' : 'English'}.` });
  return { text: String(reply || ''), lang, model: AI_MODEL, vehicleId: photoPlan?.vehicleId || null, photoPlan };
}
