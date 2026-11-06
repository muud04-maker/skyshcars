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
  const media: any = await vehicleMediaForMessage(text, conversationId);
  if (!media) return { status: 'no_vehicle', images: [] };
  if (media.none) return { status: 'no_vehicle', images: [], wanted: String(media.none) };
  const base = { vehicleId: media.vehicleId, stockNo: media.stockNo, title: media.title, caption: media.caption };
  if (!media.exact) return { ...base, status: 'no_exact_photos', images: [] };
  if (await sentRecently(conversationId, media.stockNo)) return { ...base, status: 'already_sent', images: [] };
  // Another unit of the same model (e.g. the 2016 and the 2018 MT-09): send both, each captioned.
  const more: PhotoPlan[] = [];
  for (const o of (media.others || []).slice(0, 1)) {
    if (o.exact && !(await sentRecently(conversationId, o.stockNo))) {
      more.push({ status: 'sending', vehicleId: o.vehicleId, stockNo: o.stockNo, title: o.title, caption: o.caption, images: o.images });
    }
  }
  return { ...base, status: 'sending', images: media.images, more: more.length ? more : undefined };
}

async function sentRecently(conversationId: number, stockNo: string) {
  const recent = await one<any>(`SELECT m.id FROM messages m JOIN conversations c ON c.id=m.conversation_id
    WHERE (m.conversation_id=? OR c.customer_id=(SELECT customer_id FROM conversations WHERE id=?)) AND m.sender='ai' AND m.direction='outbound'
      AND m.body LIKE ? AND m.created_at >= (NOW() - INTERVAL ${RESEND_WINDOW_MIN} MINUTE) LIMIT 1`,
    [conversationId, conversationId, sentMarker(stockNo) + '%']);
  return !!recent;
}

/** Plan photos for specific catalogue units (used when the customer names a model, e.g. "Yamaha MT-09"). */
export async function planPhotosForVehicles(conversationId: number, vehicles: any[]): Promise<PhotoPlan | null> {
  const { whatsappPhotosForVehicle } = await import('./exact-photos');
  const { vehicleDisplayTitle } = await import('./display-title');
  const site = (process.env.NEXT_PUBLIC_SITE_URL || 'https://skyshcars.com').replace(/\/$/, '');
  const plans: PhotoPlan[] = [];
  for (const v of vehicles.slice(0, 2)) {
    const stockNo = String(v.stock_no || '');
    if (stockNo && await sentRecently(conversationId, stockNo).catch(() => false)) continue;
    const images = (await whatsappPhotosForVehicle(Number(v.id), 3).catch(() => [] as any[])).map((p: any) => p.url);
    if (!images.length) continue;
    const title = vehicleDisplayTitle(v);
    plans.push({ status: 'sending', vehicleId: Number(v.id), stockNo, title, images,
      caption: `${title}${stockNo ? ` | ${stockNo}` : ''}${v.price_usd ? ` | $${Number(v.price_usd).toLocaleString()}` : ''}\nExact photos of this unit\n${site}/vehicles/${v.id}` });
  }
  if (!plans.length) return null;
  return { ...plans[0], more: plans.slice(1).length ? plans.slice(1) : undefined };
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
    /*
      Phase 4 items 5-8: zero photos delivered must never look like a successful send, and the real
      photos have to be fetched by a human - so create a tracked staff request (visible in the inbox
      as "needs staff") instead of quietly failing.
    */
    await agentEvent(conversationId, null, 'photo_send_failed', 'needs_staff', { stock_no: plan.stockNo || null, attempted: plan.images.length }).catch(() => {});
    try {
      const { flagForStaff } = await import('./conversation-state');
      await flagForStaff(conversationId, `photo send failed: 0 of ${plan.images.length} photos delivered for ${plan.stockNo || plan.title || 'that vehicle'} - send them manually`);
    } catch { /* flagging must never break the reply */ }
  }
  // Other units of the same model (e.g. 2016 and 2018 MT-09), each with its own caption and marker.
  for (const extra of (plan.more || []).slice(0, 1)) {
    const r = await sendPlannedPhotos(to, conversationId, { ...extra, more: undefined });
    sent += r.sent;
  }
  return { sent };
}
