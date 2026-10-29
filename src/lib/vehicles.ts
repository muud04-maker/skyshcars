import fallback from '../../data/inventory.json';
import last50 from '../../data/v16_last_50.json';
import { rows, one, dbConfigured, lim, db } from './db';
import { ensureLast50Vehicles } from './inventory-seed';
import { getRepresentativeCover, getRepresentativePhotos } from './representative-photos';
import { exactPhotoSql } from './exact-photos';
import { ARRIVAL_DAYS, ARRIVAL_LIMIT, selectNewArrivals } from './ai-rules/arrivals';

const ALLOW_REPRESENTATIVE_MODEL_PHOTOS = process.env.ALLOW_REPRESENTATIVE_MODEL_PHOTOS !== 'false';

function verifiedMediaSql(allowRepresentative = ALLOW_REPRESENTATIVE_MODEL_PHOTOS) {
  return `m.media_type='image' AND m.review_status='approved'
    AND m.url NOT LIKE '/demo/vehicles/%'
    AND m.url NOT LIKE '%vehicle-placeholder%'
    AND m.url NOT LIKE '/api/vehicle-art/%'
    ${allowRepresentative ? '' : "AND COALESCE(m.caption,'') NOT LIKE 'MODEL PHOTO%' AND COALESCE(m.caption,'') NOT LIKE '%Reference image%'"}`;
}

const VERIFIED_MEDIA = verifiedMediaSql();
// Supplier-hosted (external) photos are served through our own URL so supplier domains never appear publicly.
const PUBLIC_URL = `CASE WHEN m.url LIKE 'http%' THEN CONCAT('/api/photo/', m.id) ELSE m.url END`;
const COVER = `(SELECT ${PUBLIC_URL} FROM vehicle_media m WHERE m.vehicle_id=v.id
  AND (CASE WHEN COALESCE(v.source,'')='telegram' THEN (${exactPhotoSql('m')}) ELSE (${VERIFIED_MEDIA}) END)
  ORDER BY m.is_cover DESC, m.sort_order, m.id LIMIT 1) cover_url`;

let readyPromise: Promise<void> | null = null;
async function ensureCatalogueReady() {
  if (!dbConfigured()) return;
  if (readyPromise) return readyPromise;
  readyPromise = (async () => {
    await ensureLast50Vehicles();
    await db().execute(`DELETE FROM vehicle_media WHERE
      url LIKE '/demo/vehicles/%' OR url LIKE '%vehicle-placeholder%' OR url LIKE '/api/vehicle-art/%'`);
    if (!ALLOW_REPRESENTATIVE_MODEL_PHOTOS) {
      await db().execute(`DELETE FROM vehicle_media WHERE COALESCE(caption,'') LIKE 'MODEL PHOTO%' OR COALESCE(caption,'') LIKE '%Reference image%'`);
    }
    await db().execute(`UPDATE vehicles SET status='hidden'
      WHERE category='motorcycle' AND (TRIM(COALESCE(brand,''))='' OR TRIM(COALESCE(model,''))='')
      AND source IN ('inventory_json','import') AND status<>'sold'`);
  })().catch((e) => {
    readyPromise = null;
    console.error('CATALOGUE_READY', e);
  });
  return readyPromise;
}

function legacy(v: any) {
  if (!v) return null;
  const stock_no = v.stock_no || `SC${String(v.id).padStart(5, '0')}`;
  const specs = v.specs || v.specifications || {};
  const rep = getRepresentativeCover(stock_no);
  return {
    id: v.id || stock_no,
    stock_no,
    category: v.category,
    brand: v.brand,
    model: v.model,
    trim_name: v.trim_name || undefined,
    model_year: v.model_year || v.year,
    price_usd: v.price_usd,
    status: v.status || 'available',
    mileage_km: v.mileage_km || specs?.actual_mileage || specs?.mileage,
    transmission: v.transmission || specs?.transmission,
    fuel_type: v.fuel_type || specs?.fuel,
    steering: v.steering || specs?.steering,
    engine: v.engine || specs?.engine,
    location: v.location || 'China',
    cover_url: rep?.url || null,
    photo_kind: rep ? 'representative' : null,
    specs,
  };
}

function combinedFallbackInventory() {
  return [...((fallback as any).inventory || []), ...(Array.isArray(last50) ? last50 : [])]
    .map(legacy)
    .filter(Boolean);
}

function syntheticRepresentativePhotos(ref: any, count = 5) {
  const key = encodeURIComponent(String(ref || 'vehicle'));
  return Array.from({ length: count }, (_, idx) => ({
    url: `/api/model-photo/${key}/${idx}`,
    caption: `Representative model photo ${idx + 1}`,
    source: 'Wikimedia Commons / live lookup',
    isRepresentative: true as const,
  }));
}

function withRepresentative(v: any) {
  if (!v) return v;
  // Supplier imports must never substitute model art for the actual unit.
  if (String(v.source || '') === 'telegram') return v;
  if (v.cover_url) return v;
  const rep = getRepresentativeCover(v.stock_no);
  if (rep) return { ...v, cover_url: rep.url, photo_kind: 'representative' };
  const synthetic = syntheticRepresentativePhotos(v.id || v.stock_no, 1)[0];
  return synthetic ? { ...v, cover_url: synthetic.url, photo_kind: 'representative' } : v;
}

export type VehicleQuery = {
  limit?: number; category?: string; search?: string; brand?: string; steering?: string; fuel?: string; bodyType?: string;
  transmission?: string; engine?: string;
  minPrice?: number; maxPrice?: number; minYear?: number; maxYear?: number; minMileage?: number; maxMileage?: number;
  stock?: string; sort?: string; onlyAvailable?: boolean; createdWithinDays?: number;
  /** Public stock view: available (default, unchanged), sold, or all sellable incl. sold. */
  stockStatus?: 'available' | 'sold' | 'all';
  offset?: number;
};

import { publicStatusCondition } from './bulk-vehicles';
export { publicStatusCondition };

function num(v: any) { const n = Number(v); return Number.isFinite(n) ? n : null; }
// Supplier-reader drafts stay private until approved. This covers both the legacy WhatsApp
// bridge and Telegram; a pending car from either source must never leak through a public query.
export const NOT_PENDING_GROUP = `NOT (COALESCE(v.source,'') IN ('whatsapp_group','telegram') AND v.status='pending_verification')`;
function buildWhere(opts: VehicleQuery) {
  const args: any[] = []; let where = `${publicStatusCondition(opts.stockStatus, 'v')} AND ${NOT_PENDING_GROUP}`;
  where += ` AND NOT (v.category='motorcycle' AND (TRIM(COALESCE(v.brand,''))='' OR TRIM(COALESCE(v.model,''))=''))`;
  if (opts.category) { where += ' AND v.category=?'; args.push(opts.category); }
  if (opts.brand) { where += ' AND LOWER(v.brand)=?'; args.push(String(opts.brand).toLowerCase()); }
  if (opts.search) {
    where += ` AND (LOWER(v.brand) LIKE ? OR LOWER(v.model) LIKE ? OR LOWER(COALESCE(v.trim_name,'')) LIKE ? OR LOWER(v.stock_no) LIKE ?)`;
    const s = '%' + String(opts.search).toLowerCase() + '%'; args.push(s, s, s, s);
  }
  if (opts.steering && ['LHD', 'RHD'].includes(opts.steering)) { where += ' AND v.steering=?'; args.push(opts.steering); }
  if (opts.fuel) {
    const fuel = String(opts.fuel).toLowerCase();
    // The public Electric page is an EV/hybrid landing page, not only one exact fuel label.
    if (fuel === 'electric') where += ` AND LOWER(COALESCE(v.fuel_type,'')) IN ('electric','hybrid','phev','plug-in hybrid')`;
    else { where += ` AND LOWER(COALESCE(v.fuel_type,''))=?`; args.push(fuel); }
  }
  if (opts.transmission) { where += ` AND LOWER(COALESCE(v.transmission,''))=?`; args.push(String(opts.transmission).toLowerCase()); }
  if (opts.engine) { where += ` AND LOWER(TRIM(COALESCE(v.engine,''))) = ?`; args.push(String(opts.engine).trim().toLowerCase()); }
  if (opts.bodyType) { where += ` AND LOWER(COALESCE(JSON_UNQUOTE(JSON_EXTRACT(v.specs,'$.body_type')),''))=?`; args.push(String(opts.bodyType).toLowerCase()); }
  const minP = num(opts.minPrice), maxP = num(opts.maxPrice), minY = num(opts.minYear), maxY = num(opts.maxYear), minM = num(opts.minMileage), maxM = num(opts.maxMileage);
  if (minP !== null) { where += ' AND v.price_usd>=?'; args.push(minP); } if (maxP !== null) { where += ' AND v.price_usd<=?'; args.push(maxP); }
  if (minY !== null) { where += ' AND v.model_year>=?'; args.push(minY); } if (maxY !== null) { where += ' AND v.model_year<=?'; args.push(maxY); }
  if (minM !== null) { where += ' AND v.mileage_km>=?'; args.push(minM); } if (maxM !== null) { where += ' AND v.mileage_km<=?'; args.push(maxM); }
  if (opts.stock === 'available') where += ` AND v.status='available'`; else if (opts.stock === 'preorder') where += ` AND v.status='pending_verification'`;
  if (opts.onlyAvailable) where += ` AND v.status='available'`;
  if (opts.createdWithinDays) { where += ' AND v.created_at >= (NOW() - INTERVAL ? DAY)'; args.push(Number(opts.createdWithinDays)); }
  return { where, args };
}
function orderOf(sort?: string) {
  switch (sort) {
    case 'price_asc': return 'v.price_usd IS NULL, v.price_usd ASC, v.id DESC';
    case 'price_desc': return 'v.price_usd IS NULL, v.price_usd DESC, v.id DESC';
    case 'year_desc': return 'v.model_year IS NULL, v.model_year DESC, v.id DESC';
    case 'mileage_asc': return 'v.mileage_km IS NULL, v.mileage_km ASC, v.id DESC';
    case 'created_desc': return 'v.created_at DESC, v.id DESC';
    default: return `v.status='available' DESC, v.updated_at DESC, v.id DESC`;
  }
}

export async function getVehicles(q: VehicleQuery | number = {}) {
  const opts: VehicleQuery = typeof q === 'number' ? { limit: q } : q; const limit = lim(opts.limit ?? 1200);
  if (!dbConfigured()) {
    let list = combinedFallbackInventory();
    if (opts.stockStatus === 'sold') list = list.filter((v: any) => String(v.status || '') === 'sold');
    else if (opts.stockStatus !== 'all') list = list.filter((v: any) => String(v.status || '') !== 'sold');
    if (opts.category) list = list.filter((v: any) => v.category === opts.category);
    if (opts.brand) list = list.filter((v: any) => String(v.brand || '').toLowerCase() === String(opts.brand).toLowerCase());
    if (opts.search) { const s = String(opts.search).toLowerCase(); list = list.filter((v: any) => `${v.brand} ${v.model} ${v.stock_no}`.toLowerCase().includes(s)); }
    if (opts.steering) list = list.filter((v: any) => String(v.steering || '').toUpperCase() === String(opts.steering).toUpperCase());
    if (opts.fuel) {
      const fuel = String(opts.fuel).toLowerCase();
      const allowed = fuel === 'electric' ? ['electric', 'hybrid', 'phev', 'plug-in hybrid'] : [fuel];
      list = list.filter((v: any) => allowed.includes(String(v.fuel_type || '').toLowerCase()));
    }
    if (opts.transmission) list = list.filter((v: any) => String(v.transmission || '').toLowerCase() === String(opts.transmission).toLowerCase());
    if (opts.engine) list = list.filter((v: any) => String(v.engine || '').trim().toLowerCase() === String(opts.engine).trim().toLowerCase());
    if (opts.bodyType) list = list.filter((v: any) => {
      const specs = typeof v.specs === 'object' && v.specs ? v.specs : {};
      return String(specs.body_type || v.body_type || '').toLowerCase() === String(opts.bodyType).toLowerCase();
    });
    const minP = num(opts.minPrice), maxP = num(opts.maxPrice), minY = num(opts.minYear), maxY = num(opts.maxYear), minM = num(opts.minMileage), maxM = num(opts.maxMileage);
    if (minP !== null) list = list.filter((v: any) => Number(v.price_usd) >= minP);
    if (maxP !== null) list = list.filter((v: any) => Number(v.price_usd) <= maxP);
    if (minY !== null) list = list.filter((v: any) => Number(v.model_year) >= minY);
    if (maxY !== null) list = list.filter((v: any) => Number(v.model_year) <= maxY);
    if (minM !== null) list = list.filter((v: any) => Number(v.mileage_km) >= minM);
    if (maxM !== null) list = list.filter((v: any) => Number(v.mileage_km) <= maxM);
    if (opts.stock === 'available') list = list.filter((v: any) => String(v.status || '') === 'available');
    else if (opts.stock === 'preorder') list = list.filter((v: any) => String(v.status || '') === 'pending_verification');
    if (opts.onlyAvailable) list = list.filter((v: any) => String(v.status || '') === 'available');
    if (opts.category === 'motorcycle') list = list.filter((v: any) => String(v.brand || '').trim() && String(v.model || '').trim());
    const byNumber=(key:string,asc=true)=>(a:any,b:any)=>{const av=Number(a[key]),bv=Number(b[key]);if(!Number.isFinite(av))return 1;if(!Number.isFinite(bv))return -1;return asc?av-bv:bv-av};
    if(opts.sort==='price_asc') list.sort(byNumber('price_usd',true));
    else if(opts.sort==='price_desc') list.sort(byNumber('price_usd',false));
    else if(opts.sort==='year_desc') list.sort(byNumber('model_year',false));
    else if(opts.sort==='mileage_asc') list.sort(byNumber('mileage_km',true));
    else list.sort((a:any,b:any)=>String(a.status||'available')===String(b.status||'available')?0:String(a.status||'')==='available'?-1:1);
    const offset=Math.max(0,Number(opts.offset)||0);
    return list.slice(offset, offset+limit).map(withRepresentative);
  }
  try {
    await ensureCatalogueReady();
    const { where, args } = buildWhere(opts);
    const offset = Math.max(0, Number(opts.offset) || 0);
    const list = await rows<any>(`SELECT v.*, ${COVER} FROM vehicles v WHERE ${where} ORDER BY ${orderOf(opts.sort)} LIMIT ${limit} OFFSET ${offset}`, args);
    return list.map(withRepresentative);
  } catch (e) { console.error('GET_VEHICLES_DB_ERROR', e); return []; }
}

/**
 * Sold vehicles that were publicly listed (brief section 3): the SAME inventory table, no copy. Always
 * excludes hidden, pending and group drafts, and never exposes supplier identity.
 */
export async function getSoldVehicles(opts: Omit<VehicleQuery, 'stockStatus'> = {}) {
  return getVehicles({ ...opts, stockStatus: 'sold' });
}

/**
 * AI-side resolution of a vehicle named in a customer message: an exact stock number or a public
 * vehicle URL. Returns the real record (including a SOLD one) so the agent can answer with its true
 * status instead of asking "which car?" or offering a sold unit as available.
 */
export async function publicVehicleByStockOrUrl(text: unknown) {
  const t = String(text == null ? '' : text);
  if (!t.trim()) return null;
  const urlId = /\/vehicles\/(\d{1,10})/.exec(t)?.[1] || '';
  // Only an explicit stock number counts - never a year or a price ("Stock number: 873", "SC-873").
  const stock = (/(?:\bstock\s*(?:number|no\.?)?\s*[:#]?\s*|\bsc[-\s]?)0*(\d{2,7})\b/i.exec(t)?.[1] || '');
  const stockNo = stock ? 'SC' + String(stock).padStart(5, '0') : '';
  if (!urlId && !stockNo) return null;
  if (!dbConfigured()) {
    const list = combinedFallbackInventory();
    return list.find((v: any) => (urlId && String(v.id) === urlId) || (stockNo && String(v.stock_no || '').replace(/\D/g, '').replace(/^0+/, '') === String(stock).replace(/^0+/, ''))) || null;
  }
  try {
    const where = urlId ? 'v.id=?' : `REPLACE(REPLACE(v.stock_no,'-',''),' ','')=?`;
    const arg = urlId ? Number(urlId) : stockNo;
    const row = await one<any>(`SELECT v.* FROM vehicles v WHERE ${where} AND ${publicStatusCondition('all', 'v')} AND ${NOT_PENDING_GROUP}
      AND NOT (v.category='motorcycle' AND (TRIM(COALESCE(v.brand,''))='' OR TRIM(COALESCE(v.model,''))='')) LIMIT 1`, [arg]);
    return row || null;
  } catch { return null; }
}

/** Real counts behind the Sold showcase (labelled "marked Sold", never "completed sales"). */
export async function soldStats() {
  if (!dbConfigured()) {
    const list = combinedFallbackInventory().filter((v: any) => String(v.status || '') === 'sold');
    return { total: list.length, cars: list.filter((v: any) => v.category !== 'motorcycle').length, motorcycles: list.filter((v: any) => v.category === 'motorcycle').length, recent_30d: 0 };
  }
  try {
    const r = await one<any>(`SELECT COUNT(*) total,
        SUM(category<>'motorcycle') cars, SUM(category='motorcycle') motorcycles,
        SUM(updated_at >= (NOW() - INTERVAL 30 DAY)) recent_30d
      FROM vehicles v WHERE ${publicStatusCondition('sold', 'v')} AND ${NOT_PENDING_GROUP}
        AND NOT (v.category='motorcycle' AND (TRIM(COALESCE(v.brand,''))='' OR TRIM(COALESCE(v.model,''))=''))`);
    return { total: Number(r?.total || 0), cars: Number(r?.cars || 0), motorcycles: Number(r?.motorcycles || 0), recent_30d: Number(r?.recent_30d || 0) };
  } catch { return { total: 0, cars: 0, motorcycles: 0, recent_30d: 0 }; }
}

/**
 * Homepage New Arrivals: Available vehicles added in the last `days` days, newest first, capped.
 * Never falls back to older inventory (returns an empty list instead).
 */
export async function getNewArrivals(limit = ARRIVAL_LIMIT, days = ARRIVAL_DAYS) {
  if (!dbConfigured()) return selectNewArrivals(combinedFallbackInventory(), { nowMs: Date.now(), days, limit }).map(withRepresentative);
  try {
    return await getVehicles({ limit, onlyAvailable: true, createdWithinDays: days, sort: 'created_desc' });
  } catch (e) { console.error('GET_NEW_ARRIVALS_ERROR', e); return []; }
}

export async function getVehicleFilterOptions(category = 'car') {
  if (!dbConfigured()) {
    const list = combinedFallbackInventory().filter((v: any) =>
      v.category === category &&
      ['available', 'reserved', 'pending_verification'].includes(String(v.status || 'available')) &&
      !(['whatsapp_group', 'telegram'].includes(String(v.source || '')) && String(v.status || '') === 'pending_verification') &&
      !(category === 'motorcycle' && (!String(v.brand || '').trim() || !String(v.model || '').trim()))
    );
    const tally = (values: string[]) => {
      const counts = new Map<string, number>();
      for (const value of values) if (value) counts.set(value, (counts.get(value) || 0) + 1);
      return [...counts.entries()].sort(([a], [b]) => a.localeCompare(b));
    };
    const bodyOf = (v: any) => {
      const specs = typeof v.specs === 'object' && v.specs ? v.specs : {};
      return String(specs.body_type || v.body_type || '').toLowerCase();
    };
    const prices = list.map((v: any) => Number(v.price_usd)).filter(Number.isFinite);
    const years = list.map((v: any) => Number(v.model_year)).filter(Number.isFinite);
    const miles = list.map((v: any) => Number(v.mileage_km)).filter(Number.isFinite);
    return {
      brands: tally(list.map((v: any) => String(v.brand || ''))).map(([brand, count]) => ({ brand, count })),
      fuels: tally(list.map((v: any) => String(v.fuel_type || '').toLowerCase())).map(([fuel, count]) => ({ fuel, count })),
      bodyTypes: tally(list.map(bodyOf)).map(([body, count]) => ({ body, count })),
      transmissions: tally(list.map((v: any) => String(v.transmission || '').toLowerCase())).map(([transmission, count]) => ({ transmission, count })),
      engines: tally(list.map((v: any) => String(v.engine || '').trim().toLowerCase())).map(([engine, count]) => ({ engine, count })),
      minPrice: prices.length ? Math.min(...prices) : 0,
      maxPrice: prices.length ? Math.max(...prices) : 0,
      minYear: years.length ? Math.min(...years) : 2011,
      maxYear: years.length ? Math.max(...years) : new Date().getFullYear(),
      minMileage: miles.length ? Math.min(...miles) : 0,
      maxMileage: miles.length ? Math.max(...miles) : 0,
    };
  }
  try {
    await ensureCatalogueReady();
    const base = `status IN ('available','reserved','pending_verification') AND NOT (COALESCE(source,'') IN ('whatsapp_group','telegram') AND status='pending_verification') AND category=?`;
    const brands = await rows<any>(`SELECT brand,COUNT(*) count FROM vehicles WHERE ${base} AND TRIM(COALESCE(brand,''))<>'' GROUP BY brand ORDER BY brand`, [category]);
    const fuels = await rows<any>(`SELECT LOWER(fuel_type) fuel,COUNT(*) count FROM vehicles WHERE ${base} AND TRIM(COALESCE(fuel_type,''))<>'' GROUP BY LOWER(fuel_type) ORDER BY fuel`, [category]);
    const bodies = await rows<any>(`SELECT LOWER(JSON_UNQUOTE(JSON_EXTRACT(specs,'$.body_type'))) body,COUNT(*) count FROM vehicles WHERE ${base} AND JSON_EXTRACT(specs,'$.body_type') IS NOT NULL GROUP BY body ORDER BY body`, [category]);
    const transmissions = await rows<any>(`SELECT LOWER(TRIM(transmission)) transmission,COUNT(*) count FROM vehicles WHERE ${base} AND TRIM(COALESCE(transmission,''))<>'' GROUP BY LOWER(TRIM(transmission)) ORDER BY transmission`, [category]);
    const engines = await rows<any>(`SELECT LOWER(TRIM(engine)) engine,COUNT(*) count FROM vehicles WHERE ${base} AND TRIM(COALESCE(engine,''))<>'' GROUP BY LOWER(TRIM(engine)) ORDER BY engine`, [category]);
    const range: any = await one(`SELECT MIN(price_usd) minPrice,MAX(price_usd) maxPrice,MIN(model_year) minYear,MAX(model_year) maxYear,MIN(mileage_km) minMileage,MAX(mileage_km) maxMileage FROM vehicles WHERE ${base}`, [category]);
    return { brands, fuels, bodyTypes: bodies, transmissions, engines, ...range };
  } catch (e) { console.error('FILTER_OPTIONS', e); return { brands: [], fuels: [], bodyTypes: [] }; }
}

export async function getVehicle(id: string) {
  if (!dbConfigured()) return withRepresentative(combinedFallbackInventory().find((x: any) => String(x.id) === id || String(x.stock_no) === String(id)));
  try {
    await ensureCatalogueReady();
    const row = await one<any>(`SELECT v.*, ${COVER}, (SELECT ${PUBLIC_URL} FROM vehicle_media m WHERE m.vehicle_id=v.id AND ${exactPhotoSql("m")} ORDER BY m.is_cover DESC, m.sort_order, m.id LIMIT 1) exact_cover_url FROM vehicles v WHERE (v.id=? OR v.legacy_id=? OR v.stock_no=?) AND v.status IN ('available','reserved','pending_verification','sold') AND ${NOT_PENDING_GROUP} LIMIT 1`, [id, id, id]);
    return withRepresentative(row);
  } catch (e) { console.error('GET_VEHICLE_DB_ERROR', e); return null; }
}

export async function getVehicleMedia(vehicleId: number | string) {
  const representativeFor = (vehicle: any) => {
    const fromLibrary = getRepresentativePhotos(vehicle?.stock_no).map((m: any, idx: number) => ({
      id: `rep-${idx + 1}`,
      url: m.url,
      caption: m.caption || 'Representative photo',
      source: m.source || 'Representative library',
      is_cover: idx === 0 ? 1 : 0,
      sort_order: idx + 1,
      is_representative: 1,
    }));
    if (fromLibrary.length) return fromLibrary;
    return syntheticRepresentativePhotos(vehicle?.id || vehicle?.stock_no || vehicleId).map((m: any, idx: number) => ({
      id: `rep-${idx + 1}`,
      url: m.url,
      caption: m.caption,
      source: m.source,
      is_cover: idx === 0 ? 1 : 0,
      sort_order: idx + 1,
      is_representative: 1,
    }));
  };
  if (!dbConfigured()) {
    const v = combinedFallbackInventory().find((x: any) => String(x.id) === String(vehicleId) || String(x.stock_no) === String(vehicleId));
    return representativeFor(v);
  }
  try {
    const owner = await one<any>('SELECT v.source FROM vehicles v WHERE v.id=? OR v.stock_no=? LIMIT 1', [vehicleId, String(vehicleId)]);
    if (!owner) return [];
    const mediaPredicate = String(owner.source || '') === 'telegram' ? exactPhotoSql('m') : VERIFIED_MEDIA;
    const media = await rows<any>(`SELECT id,${PUBLIC_URL} url,caption,is_cover,sort_order, CASE WHEN COALESCE(caption,'') LIKE 'MODEL PHOTO%' OR COALESCE(caption,'') LIKE '%Representative%' THEN 1 ELSE 0 END is_representative FROM vehicle_media m WHERE m.vehicle_id=? AND ${mediaPredicate} ORDER BY is_cover DESC,sort_order,id LIMIT 20`, [vehicleId]);
    if (media.length) return media;
    const vehicle = await getVehicle(String(vehicleId));
    if (String(vehicle?.source || '') === 'telegram') return [];
    return representativeFor(vehicle);
  } catch (e) { console.error('GET_VEHICLE_MEDIA_DB_ERROR', e); return []; }
}
