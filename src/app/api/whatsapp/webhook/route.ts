import { inbound, outbound, alreadyProcessed } from '../../../../lib/conversations';
import { salesReply, AI_MODEL } from '../../../../lib/ai';
import { signatureOk, sendWhatsApp, whatsappConfigured } from '../../../../lib/meta';
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
        aiText: caption ? `The customer sent a photo. You cannot see the image. Respond only to this customer caption and database facts: ${caption}` : undefined,
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
        aiText: caption ? `The customer sent a video. You cannot see the video. Respond only to this caption and database facts: ${caption}` : undefined,
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
