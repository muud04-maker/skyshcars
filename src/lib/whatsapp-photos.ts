/*
  WhatsApp photo requests. The plan is decided BEFORE the AI writes its reply so the text never
  promises photos that will not arrive. Only exact photos of a real Available unit are sent,
  and the same vehicle's photos are not re-sent to the same customer within 30 minutes.
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

/** Sends the planned exact photos. If Meta rejects them, sends one honest correction instead of silence. */
export async function sendPlannedPhotos(to: string, conversationId: number, plan: PhotoPlan | null) {
  if (!plan || plan.status !== 'sending' || !plan.images.length) return { sent: 0 };
  let sent = 0;
  try {
    for (let i = 0; i < plan.images.length; i++) {
      await sendWhatsAppImage(to, plan.images[i], i === 0 ? plan.caption : `${plan.title} • photo ${i + 1}`);
      sent++;
    }
  } catch (err: any) {
    await agentEvent(conversationId, null, 'vehicle_image_send', 'failed', err?.response?.data || err?.message || String(err));
    console.error('WHATSAPP_SEND_VEHICLE_IMAGE', err?.response?.data || err);
  }
  if (sent) {
    await outbound(conversationId, 'ai', `${sentMarker(plan.stockNo || '')} ${sent} photo${sent > 1 ? 's' : ''}\n${plan.caption || ''}`, AI_MODEL);
    await agentEvent(conversationId, null, 'vehicle_image_send', 'ok', { stock_no: plan.stockNo, sent });
  } else {
    const sorry = 'Sorry, the photos did not go through just now. Our team will send them to you shortly.';
    try { await sendWhatsApp(to, sorry); await outbound(conversationId, 'ai', sorry, AI_MODEL); } catch {}
  }
  return { sent };
}
