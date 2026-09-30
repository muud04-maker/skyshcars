import { inbound, outbound, alreadyProcessed } from '../../../../lib/conversations';
import { salesReply, AI_MODEL } from '../../../../lib/ai';
import { signatureOk, sendWhatsApp, whatsappConfigured } from '../../../../lib/meta';
import { dbConfigured } from '../../../../lib/db';

export const dynamic = 'force-dynamic';

// Meta webhook verification (done once when you connect the webhook in Meta)
export async function GET(req: Request) {
  const u = new URL(req.url);
  if (u.searchParams.get('hub.mode') === 'subscribe' && process.env.WHATSAPP_VERIFY_TOKEN &&
      u.searchParams.get('hub.verify_token') === process.env.WHATSAPP_VERIFY_TOKEN)
    return new Response(u.searchParams.get('hub.challenge') || '');
  return new Response('Forbidden', { status: 403 });
}

function describe(m: any): { text: string; type: any } | null {
  switch (m.type) {
    case 'text': return { text: m.text?.body || '', type: 'text' };
    case 'image': return { text: m.image?.caption ? `[Photo] ${m.image.caption}` : '[Customer sent a photo]', type: 'image' };
    case 'video': return { text: m.video?.caption ? `[Video] ${m.video.caption}` : '[Customer sent a video]', type: 'video' };
    case 'audio': return { text: '[Customer sent a voice message]', type: 'audio' };
    case 'document': return { text: `[Customer sent a document${m.document?.filename ? ': ' + m.document.filename : ''}]`, type: 'document' };
    case 'button': return { text: m.button?.text || '', type: 'text' };
    case 'interactive': return { text: m.interactive?.button_reply?.title || m.interactive?.list_reply?.title || '', type: 'text' };
    default: return { text: `[Unsupported message: ${m.type}]`, type: 'other' };
  }
}

async function handle(m: any, contacts: any[]) {
  const from = m.from;
  const d = describe(m);
  if (!from || !d || !d.text) return;
  if (await alreadyProcessed(m.id)) return; // Meta retry: already handled
  const name = contacts.find(c => c.wa_id === from)?.profile?.name;
  const c: any = await inbound('whatsapp', from, d.text, m.id, { type: d.type, name });

  // HUMAN or PAUSED: store only, AI stays silent
  if (c.mode !== 'ai') return;
  if (!whatsappConfigured()) return;

  let reply: string | null = null;
  if (d.type === 'audio') reply = 'Thanks! I can only read text messages. Please type your question, or a team member will listen to your voice note shortly.';
  else reply = await salesReply(d.text, c.id);
  if (!reply) return;

  await sendWhatsApp(from, reply);
  await outbound(c.id, 'ai', reply, d.type === 'audio' ? 'auto' : AI_MODEL);
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
