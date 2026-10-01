import { adminDenied } from '../../../../../../lib/admin-guard';
import { one } from '../../../../../../lib/db';
import { downloadWhatsAppMedia } from '../../../../../../lib/meta';

export const dynamic = 'force-dynamic';

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const denied = await adminDenied();
  if (denied) return denied;
  const { id } = await params;
  const msg = await one<any>('SELECT id,message_type,media_url FROM messages WHERE id=? LIMIT 1', [id]);
  if (!msg?.media_url || !String(msg.media_url).startsWith('meta:')) return new Response('Media not available', { status: 404 });
  try {
    const mediaId = String(msg.media_url).slice(5);
    const media = await downloadWhatsAppMedia(mediaId);
    return new Response(media.data, {
      headers: {
        'Content-Type': media.mimeType || 'application/octet-stream',
        'Cache-Control': 'private, max-age=60',
        'Content-Disposition': 'inline',
      },
    });
  } catch (err) {
    console.error('ADMIN_MEDIA_PROXY', err);
    return new Response('Media temporarily unavailable', { status: 502 });
  }
}
