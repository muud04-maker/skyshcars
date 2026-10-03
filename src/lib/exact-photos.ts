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
