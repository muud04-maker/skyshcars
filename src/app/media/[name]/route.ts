import { db } from '../../../lib/db';
import { ensureMediaStore } from '../../../lib/media-store';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(_: Request, { params }: { params: Promise<{ name: string }> }) {
  const { name } = await params;
  if (!/^[A-Za-z0-9._-]{1,120}$/.test(name)) return new Response('Not found', { status: 404 });
  try {
    await ensureMediaStore();
    const [r]: any = await db().execute('SELECT mime,data FROM media_blobs WHERE name=? LIMIT 1', [name]);
    if (!r?.[0]) return new Response('Not found', { status: 404 });
    return new Response(new Uint8Array(r[0].data), {
      headers: { 'content-type': r[0].mime, 'cache-control': 'public, max-age=31536000, immutable', 'x-content-type-options': 'nosniff' },
    });
  } catch { return new Response('Unavailable', { status: 503 }); }
}
