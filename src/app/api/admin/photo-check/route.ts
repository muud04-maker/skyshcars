import { adminDenied } from '../../../../lib/admin-guard';
import { getAdminSession } from '../../../../lib/admin';
import { needsSetupJson } from '../../../../lib/setup';
import { photoCheckList, photoForTest, reachability } from '../../../../lib/photo-check';
import { sendWhatsAppImage, whatsappConfigured } from '../../../../lib/meta';
import { agentEvent } from '../../../../lib/agent-events';
import { rateLimit } from '../../../../lib/ratelimit';
export const dynamic = 'force-dynamic';

export async function GET() {
  const d = await adminDenied(); if (d) return d;
  try { return Response.json({ vehicles: await photoCheckList(), whatsappReady: whatsappConfigured() }); }
  catch { return needsSetupJson(); }
}

export async function POST(req: Request) {
  const d = await adminDenied(); if (d) return d;
  const b = await req.json().catch(() => ({}));
  if (b.action === 'reach') {
    const urls: string[] = (Array.isArray(b.urls) ? b.urls : []).map(String).slice(0, 20);
    const out: Record<string, any> = {};
    await Promise.all(urls.map(async u => { out[u] = await reachability(u); }));
    return Response.json({ results: out });
  }
  if (b.action === 'send') {
    // Test photos go only to the number the admin types here. Nothing is written to any customer conversation.
    const admin = await getAdminSession();
    const rl = rateLimit('photo-test:' + (admin?.email || 'admin'), 10, 10 * 60 * 1000);
    if (!rl.ok) return Response.json({ error: `Too many test sends. Try again in ${rl.retryAfter} s.` }, { status: 429 });
    const phone = String(b.phone || '').replace(/[^\d]/g, '');
    if (phone.length < 8 || phone.length > 15) return Response.json({ error: 'Type the full number with country code, digits only.' }, { status: 400 });
    if (!whatsappConfigured()) return needsSetupJson();
    try {
      const p = await photoForTest(Number(b.mediaId));
      if (!p) return Response.json({ error: 'Photo not found' }, { status: 404 });
      const id = await sendWhatsAppImage(phone, p.publicUrl, `[Sky Cars admin photo test] ${p.title}${p.stockNo ? ' • ' + p.stockNo : ''}`);
      await agentEvent(null, id, 'photo_test_send', 'ok', { by: admin?.email || null, to_last4: phone.slice(-4), media_id: Number(b.mediaId) }).catch(() => {});
      return Response.json({ ok: true, messageId: id, url: p.publicUrl });
    } catch (e: any) {
      const err = e?.response?.data?.error;
      await agentEvent(null, null, 'photo_test_send', 'failed', { media_id: Number(b.mediaId), error: err || e?.message }).catch(() => {});
      const windowHint = err?.code === 131047 || /24 hours|re-engagement/i.test(String(err?.message || ''))
        ? ' WhatsApp only allows this if that phone messaged the business number in the last 24 hours. Send it a message first, then retry.' : '';
      return Response.json({ error: `WhatsApp refused the photo: ${String(err?.message || e?.message || 'unknown error').slice(0, 300)}.${windowHint}` }, { status: 502 });
    }
  }
  return Response.json({ error: 'Unknown action' }, { status: 400 });
}
