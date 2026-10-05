/*
  Photo Check: why the AI does (or does not) send photos of each Available vehicle.
  Uses the same exactPhotoSql / unsupportedFormat / whatsappPhotoUrl rules as the WhatsApp reply path,
  so what this page says is exactly what the AI will do.
*/
import { rows, one } from './db';
import { ensureMediaStore } from './media-store';
import { exactPhotoSql, sellableVehicleSql, unsupportedFormat, whatsappPhotoUrl, WHATSAPP_IMAGE_MIME, WHATSAPP_IMAGE_MAX_BYTES } from './exact-photos';

export type PhotoVerdict = { id: number; url: string; publicUrl: string; exact: boolean; sendable: boolean; reason: string | null; isCover: boolean };

function rejectReason(m: any): string {
  const url = String(m.url || '').trim(), cap = String(m.caption || '');
  if (m.media_type && m.media_type !== 'image') return `not an image (${m.media_type})`;
  if (m.review_status === 'pending') return 'pending review';
  if (m.review_status === 'rejected') return 'rejected by admin';
  if (/^\/demo\/|vehicle-placeholder|^\/api\/vehicle-art\//i.test(url)) return 'demo / placeholder';
  if (/^\/api\/(model-photo|representative-photo)\//i.test(url) || /^MODEL PHOTO|Reference image|Representative/i.test(cap)) return 'representative (model photo, not this unit)';
  if (!url || !(/^https?:\/\//i.test(url) || url.startsWith('/'))) return 'wrong URL';
  return 'not approved';
}

async function blobSql() {
  try { await ensureMediaStore(); return { join: `LEFT JOIN media_blobs b ON m.url=CONCAT('/media/',b.name)`, col: 'b.mime blob_mime' }; }
  catch { return { join: '', col: 'NULL blob_mime' }; }
}

export async function photoCheckList() {
  const b = await blobSql();
  const vehicles = await rows<any>(`SELECT v.id,v.stock_no,v.brand,v.model,v.model_year FROM vehicles v
    WHERE ${sellableVehicleSql('v')} ORDER BY v.updated_at DESC LIMIT 1000`);
  if (!vehicles.length) return [];
  const media = await rows<any>(`SELECT m.id,m.vehicle_id,m.url,m.caption,m.media_type,m.review_status,m.is_cover,
      CASE WHEN ${exactPhotoSql('m')} THEN 1 ELSE 0 END exact, ${b.col}
    FROM vehicle_media m ${b.join} JOIN vehicles v ON v.id=m.vehicle_id WHERE ${sellableVehicleSql('v')}
    ORDER BY m.vehicle_id,m.is_cover DESC,m.sort_order,m.id`);
  const by = new Map<number, PhotoVerdict[]>();
  for (const m of media) {
    const exact = !!Number(m.exact);
    const url = String(m.url || '').trim();
    const bad = !url ? 'wrong URL' : unsupportedFormat(url, m.blob_mime);
    const v: PhotoVerdict = {
      id: Number(m.id), url, publicUrl: url ? whatsappPhotoUrl(m.id, url) : '', exact, isCover: !!Number(m.is_cover),
      sendable: exact && !bad,
      reason: !exact ? rejectReason(m) : bad ? (bad === 'wrong URL' ? bad : `format WhatsApp refuses (${bad})`) : null,
    };
    const list = by.get(Number(m.vehicle_id)) || []; list.push(v); by.set(Number(m.vehicle_id), list);
  }
  return vehicles.map(v => {
    const photos = by.get(Number(v.id)) || [];
    return {
      id: Number(v.id), stock_no: v.stock_no, title: [v.model_year, v.brand, v.model].filter(Boolean).join(' ') || 'Vehicle',
      exactCount: photos.filter(p => p.exact).length, sendableCount: photos.filter(p => p.sendable).length, photos,
    };
  });
}

/** Fetches the URL the way WhatsApp would: anonymous, HTTPS, status 200, JPEG/PNG, at most 5 MB. */
export async function reachability(publicUrl: string) {
  if (!/^https:\/\//i.test(publicUrl)) return { ok: false, reason: 'URL is not public HTTPS (WhatsApp needs https)' };
  if (/\/\/(localhost|127\.|10\.|192\.168\.)/i.test(publicUrl)) return { ok: false, reason: 'URL points to a private address' };
  const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 15000);
  try {
    const r = await fetch(publicUrl, { signal: ctl.signal, redirect: 'follow', cache: 'no-store', headers: { 'user-agent': 'SkyCarsPhotoCheck/1.0' } });
    const type = String(r.headers.get('content-type') || '').split(';')[0].trim();
    if (!r.ok) return { ok: false, status: r.status, reason: `HTTP ${r.status}` };
    const buf = Buffer.from(await r.arrayBuffer());
    if (!WHATSAPP_IMAGE_MIME.test(type)) return { ok: false, status: r.status, type, bytes: buf.length, reason: `content type ${type || 'missing'} (WhatsApp needs image/jpeg or image/png)` };
    if (!buf.length) return { ok: false, status: r.status, type, reason: 'empty file' };
    if (buf.length > WHATSAPP_IMAGE_MAX_BYTES) return { ok: false, status: r.status, type, bytes: buf.length, reason: 'larger than 5 MB' };
    return { ok: true, status: r.status, type, bytes: buf.length, reason: null };
  } catch (e: any) {
    return { ok: false, reason: e?.name === 'AbortError' ? 'timed out after 15 s' : 'could not connect' };
  } finally { clearTimeout(t); }
}

export async function photoForTest(mediaId: number) {
  const m = await one<any>(`SELECT m.id,m.url,v.stock_no,v.brand,v.model,v.model_year FROM vehicle_media m JOIN vehicles v ON v.id=m.vehicle_id WHERE m.id=? LIMIT 1`, [mediaId]);
  if (!m) return null;
  return { publicUrl: whatsappPhotoUrl(m.id, m.url), title: [m.model_year, m.brand, m.model].filter(Boolean).join(' '), stockNo: m.stock_no };
}
