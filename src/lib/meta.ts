import { createHmac, timingSafeEqual } from 'crypto';
import axios from 'axios';

const GRAPH = 'https://graph.facebook.com/v23.0';

/** Verifies Meta's X-Hub-Signature-256 header. If META_APP_SECRET is not set, allows the request but logs a warning. */
export function signatureOk(raw: string, header: string | null) {
  const secret = process.env.META_APP_SECRET;
  if (!secret) { console.warn('META_APP_SECRET not set: webhook signature NOT verified'); return true; }
  if (!header) return false;
  const expected = 'sha256=' + createHmac('sha256', secret).update(raw).digest('hex');
  try { return timingSafeEqual(Buffer.from(header), Buffer.from(expected)); } catch { return false; }
}

export function whatsappConfigured() {
  return !!(process.env.WHATSAPP_ACCESS_TOKEN && process.env.WHATSAPP_PHONE_NUMBER_ID);
}

export async function sendWhatsApp(to: string, body: string) {
  const r = await axios.post(`${GRAPH}/${process.env.WHATSAPP_PHONE_NUMBER_ID}/messages`,
    { messaging_product: 'whatsapp', recipient_type: 'individual', to, type: 'text', text: { preview_url: true, body: body.slice(0, 4000) } },
    { headers: { Authorization: `Bearer ${process.env.WHATSAPP_ACCESS_TOKEN}`, 'Content-Type': 'application/json' }, timeout: 20000 });
  return r.data?.messages?.[0]?.id || null;
}
