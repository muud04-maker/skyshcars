/*
  WhatsApp photo requests. The plan is decided BEFORE the AI writes its reply so the text never
  promises photos that will not arrive. Only exact photos of a real Available unit are sent, and the
  same vehicle's photos are not re-sent to the same customer within 30 minutes.

  Every image Meta accepts is stored as its own outbound message row (type=image, our media URL, Meta
  message id, delivery status) so the admin transcript can show the real photos the customer got.
  Separators are plain ASCII on purpose - no bullet characters that can break in transport/encoding.
*/
import { one } from './db';
import { outbound } from './conversations';
import { sendWhatsApp, sendWhatsAppImage } from './meta';
import { agentEvent } from './agent-events';
import { AI_MODEL, vehicleMediaForMessage, wantsPhotos, type PhotoPlan } from './ai';

const RESEND_WINDOW_MIN = 30;
const sentMarker = (stockNo: string) => `[Sent exact photos of ${stockNo}]`;

export async function planPhotos(text: string, conversationId: number): Promise<PhotoPlan | null> {
  if (!wantsPhotos(text)) return null;
  const media = await vehicleMediaForMessage(text, conversationId);
  if (!media) return { status: 'no_vehicle', images: [] };
  const base = { vehicleId: media.vehicleId, stockNo: media.stockNo, title: media.title, caption: media.caption };
  if (!media.exact) return { ...base, status: 'no_exact_photos', images: [] };
  const recent = await one<any>(`SELECT m.id FROM messages m JOIN conversations c ON c.id=m.conversation_id
    WHERE (m.conversation_id=? OR c.customer_id=(SELECT customer_id FROM conversations WHERE id=?)) AND m.sender='ai' AND m.direction='outbound'
      AND m.body LIKE ? AND m.created_at >= (NOW() - INTERVAL ${RESEND_WINDOW_MIN} MINUTE) LIMIT 1`,
    [conversationId, conversationId, sentMarker(media.stockNo) + '%']);
  if (recent) return { ...base, status: 'already_sent', images: [] };
  return { ...base, status: 'sending', images: media.images };
}

/** Sends the planned exact photos. If Meta rejects them all, sends one honest correction instead of silence. */
export async function sendPlannedPhotos(to: string, conversationId: number, plan: PhotoPlan | null) {
  if (!plan || plan.status !== 'sending' || !plan.images.length) return { sent: 0 };
  let sent = 0;
  // Each photo is tried on its own: one bad image must not stop the others.
  for (let i = 0; i < plan.images.length; i++) {
    try {
      const caption = sent === 0 ? String(plan.caption || '') : `${plan.title || 'Vehicle'} | photo ${i + 1}`;
      const metaId = await sendWhatsAppImage(to, plan.images[i], caption);
      // Persist what was really sent: one row per image, with our own media URL (never a supplier URL).
      await outbound(conversationId, 'ai', caption, AI_MODEL, { type: 'image', mediaUrl: plan.images[i], externalId: metaId, status: metaId ? 'sent' : null });
      sent++;
    } catch (err: any) {
      await agentEvent(conversationId, null, 'vehicle_image_send', 'failed', { url: plan.images[i], error: err?.response?.data || err?.message || String(err) });
      console.error('WHATSAPP_SEND_VEHICLE_IMAGE', err?.response?.data || err);
    }
  }
  if (sent) {
    // Short metadata label carrying the ACTUAL successful count (never claims more than was delivered).
    await outbound(conversationId, 'ai', `${sentMarker(plan.stockNo || '')} ${sent} photo${sent > 1 ? 's' : ''}`, AI_MODEL);
    await agentEvent(conversationId, null, 'vehicle_image_send', 'ok', { stock_no: plan.stockNo, sent });
  } else {
    const sorry = 'Sorry, the photos did not go through just now. Our team will send them to you shortly.';
    try { await sendWhatsApp(to, sorry); await outbound(conversationId, 'ai', sorry, AI_MODEL); } catch {}
  }
  return { sent };
}
