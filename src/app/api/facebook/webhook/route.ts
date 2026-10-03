import axios from 'axios';
import { inbound, outbound, alreadyProcessed } from '../../../../lib/conversations';
import { salesReply, AI_MODEL } from '../../../../lib/ai';
import { checkSignature } from '../../../../lib/meta';
import { dbConfigured } from '../../../../lib/db';
import { GRAPH, facebookConfigured, resolvePageToken } from '../../../../lib/facebook';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const u = new URL(req.url);
  if (u.searchParams.get('hub.mode') === 'subscribe' && process.env.META_VERIFY_TOKEN &&
      u.searchParams.get('hub.verify_token') === process.env.META_VERIFY_TOKEN)
    return new Response(u.searchParams.get('hub.challenge') || '');
  return new Response('Forbidden', { status: 403 });
}

// Messenger replies. Without a database or Page token this endpoint accepts the event and does nothing (never errors).
export async function POST(req: Request) {
  const raw = await req.text();
  const sig = checkSignature(raw, req.headers.get('x-hub-signature-256'));
  if (!sig.accept) return new Response('Bad signature', { status: 401 });
  if (!dbConfigured()) return new Response('EVENT_RECEIVED');
  try {
    const b = JSON.parse(raw);
    if (sig.valid !== true && b?.object !== 'page') return new Response('Bad webhook object', { status: 400 });
    for (const e of b.entry || []) for (const m of e.messaging || []) {
      try {
        const id = m.sender?.id, text = m.message?.text, mid = m.message?.mid;
        if (!id || !text || m.message?.is_echo) continue;
        if (await alreadyProcessed(mid)) continue;
        const c: any = await inbound('facebook', id, text, mid);
        if (c.mode !== 'ai' || !facebookConfigured()) continue;
        const reply = await salesReply(text, c.id);
        if (!reply) continue;
        const token = await resolvePageToken();
        await axios.post(`${GRAPH}/me/messages`, { recipient: { id }, messaging_type: 'RESPONSE', message: { text: reply } }, { params: { access_token: token }, timeout: 20000 });
        await outbound(c.id, 'ai', reply, AI_MODEL);
      } catch (err: any) { console.error('FB_MESSAGE_ERROR', err?.response?.data || err?.message || err); }
    }
  } catch (e) { console.error('FB_WEBHOOK', e); }
  return new Response('EVENT_RECEIVED');
}
