/*
  One definition of an "exact photo": an approved image of the actual stock unit.
  Excludes demo art, placeholders, generated art, Wikimedia model photos and representative sets.
  Used wherever a photo is presented to a customer as the real vehicle (WhatsApp, Facebook).
*/
export function exactPhotoSql(a = 'm') {
  return `${a}.media_type='image' AND ${a}.review_status='approved'
    AND ${a}.url NOT LIKE '/demo/%' AND ${a}.url NOT LIKE '%vehicle-placeholder%'
    AND ${a}.url NOT LIKE '/api/vehicle-art/%' AND ${a}.url NOT LIKE '/api/model-photo/%' AND ${a}.url NOT LIKE '/api/representative-photo/%'
    AND COALESCE(${a}.caption,'') NOT LIKE 'MODEL PHOTO%' AND COALESCE(${a}.caption,'') NOT LIKE '%Reference image%'
    AND COALESCE(${a}.caption,'') NOT LIKE '%Representative%'`;
}

/** Real, sellable inventory: Available status and not a demo/test listing. */
export function sellableVehicleSql(a = 'v') {
  return `${a}.status='available' AND COALESCE(${a}.source,'') NOT LIKE 'demo%' AND COALESCE(${a}.stock_no,'') NOT LIKE 'DEMO-%'`;
}

const SITE = (process.env.NEXT_PUBLIC_SITE_URL || 'https://skyshcars.com').replace(/\/$/, '');
export function absoluteMediaUrl(u: string) { return u.startsWith('http') ? u : SITE + (u.startsWith('/') ? u : '/' + u); }

/*
  WhatsApp Cloud API fetches the image itself from the link we give it. It accepts only JPEG and PNG
  (max 5 MB). Supplier-hosted photos are given as our own /api/photo/<id> proxy URL, exactly like the
  public site, so WhatsApp never hits a supplier server (hotlink blocks) and the supplier stays private.
*/
export const WHATSAPP_IMAGE_MIME = /^image\/(jpe?g|png)$/i;
export const WHATSAPP_IMAGE_MAX_BYTES = 5 * 1024 * 1024;

export function whatsappPhotoUrl(mediaId: number | string, url: string) {
  const u = String(url || '').trim();
  if (/^https?:\/\//i.test(u)) return `${SITE}/api/photo/${mediaId}`;
  return absoluteMediaUrl(u);
}

/** Format WhatsApp would refuse, judged from what we know without fetching. null = unknown/ok. */
export function unsupportedFormat(url: string, blobMime?: string | null) {
  if (blobMime) return WHATSAPP_IMAGE_MIME.test(blobMime) ? null : blobMime;
  const ext = /\.([a-z0-9]{2,5})(?:[?#]|$)/i.exec(String(url || ''))?.[1]?.toLowerCase();
  if (ext && ['webp', 'gif', 'svg', 'heic', 'heif', 'avif', 'bmp', 'tif', 'tiff'].includes(ext)) return 'image/' + ext;
  return null;
}

/** Exact photos of one vehicle that WhatsApp can accept, as public URLs, cover first. */
export async function whatsappPhotosForVehicle(vehicleId: number, limit = 3) {
  const { rows } = await import('./db');
  let blobJoin = '', blobCol = 'NULL blob_mime';
  try { const { ensureMediaStore } = await import('./media-store'); await ensureMediaStore(); blobJoin = `LEFT JOIN media_blobs b ON m.url=CONCAT('/media/',b.name)`; blobCol = 'b.mime blob_mime'; } catch {}
  const r = await rows<any>(`SELECT m.id,m.url,${blobCol} FROM vehicle_media m ${blobJoin}
    WHERE m.vehicle_id=? AND ${exactPhotoSql('m')} ORDER BY m.is_cover DESC,m.sort_order,m.id LIMIT 20`, [vehicleId]);
  return r.filter(m => String(m.url || '').trim() && !unsupportedFormat(m.url, m.blob_mime))
    .slice(0, limit).map(m => ({ id: Number(m.id), url: whatsappPhotoUrl(m.id, m.url) }));
}
