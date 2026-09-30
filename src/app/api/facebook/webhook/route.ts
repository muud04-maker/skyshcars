import axios from 'axios';
import { inbound, outbound, alreadyProcessed } from '../../../../lib/conversations';
import { salesReply, AI_MODEL } from '../../../../lib/ai';
import { signatureOk } from '../../../../lib/meta';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const u = new URL(req.url);
  if (u.searchParams.get('hub.mode') === 'subscribe' && process.env.META_VERIFY_TOKEN &&
      u.searchParams.get('hub.verify_token') === process.env.META_VERIFY_TOKEN)
    return new Response(u.searchParams.get('hub.challenge') || '');
  return new Response('Forbidden', { status: 403 });
}

export async function POST(req: Request) {
  const raw = await req.text();
  if (!signatureOk(raw, req.headers.get('x-hub-signature-256'))) return new Response('Bad signature', { status: 401 });
  try {
    const b = JSON.parse(raw);
    for (const e of b.entry || []) for (const m of e.messaging || []) {
      try {
        const id = m.sender?.id, text = m.message?.text, mid = m.message?.mid;
        if (!id || !text || m.message?.is_echo) continue;
        if (await alreadyProcessed(mid)) continue;
        const c: any = await inbound('facebook', id, text, mid);
        if (c.mode !== 'ai' || !process.env.META_PAGE_ACCESS_TOKEN) continue;
        const reply = await salesReply(text, c.id);
        if (!reply) continue;
        await axios.post(`https://graph.facebook.com/v23.0/me/messages?access_token=${encodeURIComponent(process.env.META_PAGE_ACCESS_TOKEN)}`,
          { recipient: { id }, messaging_type: 'RESPONSE', message: { text: reply } }, { timeout: 20000 });
        await outbound(c.id, 'ai', reply, AI_MODEL);
      } catch (err: any) { console.error('FB_MESSAGE_ERROR', err?.response?.data || err); }
    }
  } catch (e) { console.error('FB_WEBHOOK', e); }
  return new Response('EVENT_RECEIVED');
}
