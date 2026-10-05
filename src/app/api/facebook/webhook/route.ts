import { after } from 'next/server';
import { inbound, alreadyProcessed } from '../../../../lib/conversations';
import { scheduleReply } from '../../../../lib/sales-engine';
import { storeReferral } from '../../../../lib/referrals';
import { checkSignature } from '../../../../lib/meta';
import { dbConfigured } from '../../../../lib/db';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const u = new URL(req.url);
  if (u.searchParams.get('hub.mode') === 'subscribe' && process.env.META_VERIFY_TOKEN &&
      u.searchParams.get('hub.verify_token') === process.env.META_VERIFY_TOKEN)
    return new Response(u.searchParams.get('hub.challenge') || '');
  return new Response('Forbidden', { status: 403 });
}

// Messenger replies go through the shared reply engine. Without a database or Page token this endpoint accepts the event and does nothing (never errors).
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
        if (m.referral) await storeReferral({ id: Number(c.id), channel: 'facebook' }, String(mid || ''), m.referral).catch(() => {});
        // Same reply engine as WhatsApp: AI Catalog, reply rule, one reply per burst, welcome once.
        after(() => scheduleReply(Number(c.id), 'webhook'));
      } catch (err: any) { console.error('FB_MESSAGE_ERROR', err?.response?.data || err?.message || err); }
    }
  } catch (e) { console.error('FB_WEBHOOK', e); }
  return new Response('EVENT_RECEIVED');
}
