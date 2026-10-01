import { inbound, outbound, alreadyProcessed } from '../../../../lib/conversations';
import { salesReply, AI_MODEL, vehicleMediaForMessage } from '../../../../lib/ai';
import { signatureOk, sendWhatsApp, sendWhatsAppImage, whatsappConfigured } from '../../../../lib/meta';
import { db, dbConfigured } from '../../../../lib/db';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const u = new URL(req.url);
  if (u.searchParams.get('hub.mode') === 'subscribe' && process.env.WHATSAPP_VERIFY_TOKEN &&
      u.searchParams.get('hub.verify_token') === process.env.WHATSAPP_VERIFY_TOKEN)
    return new Response(u.searchParams.get('hub.challenge') || '');
  return new Response('Forbidden', { status: 403 });
}

type Described = { storedText: string; aiText?: string; type: any; mediaId?: string; needsHuman?: boolean };
function describe(m: any): Described | null {
  switch (m.type) {
    case 'text': {
      const text = String(m.text?.body || '').trim();
      return text ? { storedText: text, aiText: text, type: 'text' } : null;
    }
    case 'image': {
      const caption = String(m.image?.caption || '').trim();
      return {
        storedText: caption ? `PHOTO\nCaption: ${caption}` : 'PHOTO\nNo caption supplied — human review may be needed.',
        aiText: caption ? `Customer sent a photo with this caption: ${caption}. Continue naturally from the conversation and answer the caption using verified Sky Cars facts. Do not make any claim about unseen visual details.` : undefined,
        type: 'image', mediaId: m.image?.id, needsHuman: !caption,
      };
    }
    case 'audio':
      return {
        storedText: 'VOICE NOTE\nHuman review required — no automatic transcription is enabled.',
        type: 'audio', mediaId: m.audio?.id, needsHuman: true,
      };
    case 'video': {
      const caption = String(m.video?.caption || '').trim();
      return {
        storedText: caption ? `VIDEO\nCaption: ${caption}` : 'VIDEO\nNo caption supplied — human review required.',
        aiText: caption ? `Customer sent a video with this caption: ${caption}. Continue naturally and answer the caption using verified Sky Cars facts. Do not make any claim about unseen video details.` : undefined,
        type: 'video', mediaId: m.video?.id, needsHuman: !caption,
      };
    }
    case 'document': return { storedText: `[Customer sent a document${m.document?.filename ? ': ' + m.document.filename : ''}]`, type: 'document', mediaId: m.document?.id, needsHuman: true };
    case 'button': {
      const text = String(m.button?.text || '').trim();
      return text ? { storedText: text, aiText: text, type: 'text' } : null;
    }
    case 'interactive': {
      const text = String(m.interactive?.button_reply?.title || m.interactive?.list_reply?.title || '').trim();
      return text ? { storedText: text, aiText: text, type: 'text' } : null;
    }
    default: return { storedText: `[Unsupported message: ${m.type}]`, type: 'other', needsHuman: true };
  }
}

async function handle(m: any, contacts: any[]) {
  const from = m.from;
  const d = describe(m);
  if (!from || !d) return;
  if (await alreadyProcessed(m.id)) return;

  const name = contacts.find(c => c.wa_id === from)?.profile?.name;
  const c: any = await inbound('whatsapp', from, d.storedText, m.id, {
    type: d.type,
    name,
    mediaRef: d.mediaId ? `meta:${d.mediaId}` : undefined,
  });

  // Voice notes, uncaptained photos/videos and documents require a person.
  if (d.needsHuman) {
    await db().execute("UPDATE conversations SET mode='human', takeover_by='media-review', takeover_at=NOW() WHERE id=?", [c.id]);
    return;
  }

  if (c.mode !== 'ai') return;
  if (!d.aiText || !whatsappConfigured()) return;

  const reply = await salesReply(d.aiText, c.id);
  if (!reply) return;
  await sendWhatsApp(from, reply);
  await outbound(c.id, 'ai', reply, AI_MODEL);

  // When the customer asks about a specific vehicle or asks to see a photo,
  // send the matching website image as a separate WhatsApp image message.
  // Only approved real vehicle photos are sent to customers. Website reference imagery is never sent as exact stock media.
  try {
    const wantsImage = /\b(photo|photos|picture|pictures|image|images|show|see|look|send.*pic|car.*pic|vehicle.*pic)\b/i.test(d.aiText)
      || /\bSC\s?-?\d{1,6}\b/i.test(d.aiText);
    const media = await vehicleMediaForMessage(d.aiText, c.id);
    if (media && (wantsImage || /\b(have|available|price|cost|stock|model|toyota|nissan|honda|byd|changan|geely|motorcycle|bike|suv|sedan)\b/i.test(d.aiText))) {
      const imgs = Array.isArray((media as any).images) ? (media as any).images.slice(0,3) : [media.image];
      for (let i=0;i<imgs.length;i++) await sendWhatsAppImage(from, imgs[i], i===0 ? media.caption : `${media.title} • photo ${i+1}`);
      await outbound(c.id, 'ai', `[${imgs.length} vehicle photo${imgs.length>1?'s':''} sent] ${media.caption}`, AI_MODEL);
    }
  } catch (err) {
    console.error('WHATSAPP_SEND_VEHICLE_IMAGE', err);
  }
}

export async function POST(req: Request) {
  const raw = await req.text();
  if (!signatureOk(raw, req.headers.get('x-hub-signature-256'))) return new Response('Bad signature', { status: 401 });
  if (!dbConfigured()) { console.error('WHATSAPP_WEBHOOK: database not configured'); return new Response('EVENT_RECEIVED'); }
  try {
    const body = JSON.parse(raw);
    for (const e of body.entry || []) for (const ch of e.changes || []) {
      const v = ch.value || {};
      for (const m of v.messages || []) {
        try { await handle(m, v.contacts || []); }
        catch (err: any) { console.error('WHATSAPP_MESSAGE_ERROR', err?.response?.data || err); }
      }
    }
  } catch (err) { console.error('WHATSAPP_WEBHOOK', err); }
  return new Response('EVENT_RECEIVED');
}
