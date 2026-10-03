import { one } from '../../../../lib/db';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/*
  Serves an approved, externally hosted vehicle photo from our own domain so the public site never
  reveals which supplier website hosts it. Only photos of publicly visible vehicles are served.
*/
const MAX_BYTES = 15 * 1024 * 1024;

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^\d{1,18}$/.test(id)) return new Response('Not found', { status: 404 });
  try {
    const m = await one<any>(`SELECT m.url FROM vehicle_media m JOIN vehicles v ON v.id=m.vehicle_id
      WHERE m.id=? AND m.media_type='image' AND m.review_status='approved'
        AND v.status IN ('available','reserved','pending_verification','sold')
        AND NOT (COALESCE(v.source,'')='whatsapp_group' AND v.status='pending_verification') LIMIT 1`, [id]);
    const url = String(m?.url || '');
    if (!/^https?:\/\//i.test(url)) return new Response('Not found', { status: 404 });
    const ctl = new AbortController(); const timer = setTimeout(() => ctl.abort(), 20000);
    try {
      const r = await fetch(url, { signal: ctl.signal, redirect: 'follow', headers: { 'user-agent': 'SkyCarsImage/1.0' } });
      const type = String(r.headers.get('content-type') || '').split(';')[0];
      if (!r.ok || !/^image\//i.test(type) || /svg/i.test(type)) return new Response('Not found', { status: 404 });
      const buf = Buffer.from(await r.arrayBuffer());
      if (buf.length > MAX_BYTES) return new Response('Not found', { status: 404 });
      return new Response(new Uint8Array(buf), { headers: { 'content-type': type, 'cache-control': 'public, max-age=86400, s-maxage=604800', 'x-content-type-options': 'nosniff' } });
    } finally { clearTimeout(timer); }
  } catch { return new Response('Unavailable', { status: 503 }); }
}
