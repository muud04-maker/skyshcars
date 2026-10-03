import fallback from '../../data/inventory.json';
import last50 from '../../data/v16_last_50.json';
import { rows, one, dbConfigured, lim, db } from './db';
import { ensureLast50Vehicles } from './inventory-seed';
import { getRepresentativeCover, getRepresentativePhotos } from './representative-photos';

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
const COVER = `(SELECT ${PUBLIC_URL} FROM vehicle_media m WHERE m.vehicle_id=v.id AND ${VERIFIED_MEDIA}
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
  if (v.cover_url) return v;
  const rep = getRepresentativeCover(v.stock_no);
  if (rep) return { ...v, cover_url: rep.url, photo_kind: 'representative' };
  const synthetic = syntheticRepresentativePhotos(v.id || v.stock_no, 1)[0];
  return synthetic ? { ...v, cover_url: synthetic.url, photo_kind: 'representative' } : v;
}

export type VehicleQuery = {
  limit?: number; category?: string; search?: string; brand?: string; steering?: string; fuel?: string; bodyType?: string;
  minPrice?: number; maxPrice?: number; minYear?: number; maxYear?: number; minMileage?: number; maxMileage?: number;
  stock?: string; sort?: string;
};

function num(v: any) { const n = Number(v); return Number.isFinite(n) ? n : null; }
// Group Reader posts stay private until an admin approves them.
export const NOT_PENDING_GROUP = `NOT (COALESCE(v.source,'')='whatsapp_group' AND v.status='pending_verification')`;
function buildWhere(opts: VehicleQuery) {
  const args: any[] = []; let where = `v.status IN ('available','reserved','pending_verification') AND ${NOT_PENDING_GROUP}`;
  where += ` AND NOT (v.category='motorcycle' AND (TRIM(COALESCE(v.brand,''))='' OR TRIM(COALESCE(v.model,''))=''))`;
  if (opts.category) { where += ' AND v.category=?'; args.push(opts.category); }
  if (opts.brand) { where += ' AND LOWER(v.brand)=?'; args.push(String(opts.brand).toLowerCase()); }
  if (opts.search) {
    where += ` AND (LOWER(v.brand) LIKE ? OR LOWER(v.model) LIKE ? OR LOWER(COALESCE(v.trim_name,'')) LIKE ? OR LOWER(v.stock_no) LIKE ?)`;
    const s = '%' + String(opts.search).toLowerCase() + '%'; args.push(s, s, s, s);
  }
  if (opts.steering && ['LHD', 'RHD'].includes(opts.steering)) { where += ' AND v.steering=?'; args.push(opts.steering); }
  if (opts.fuel) { where += ` AND LOWER(COALESCE(v.fuel_type,''))=?`; args.push(String(opts.fuel).toLowerCase()); }
  if (opts.bodyType) { where += ` AND LOWER(COALESCE(JSON_UNQUOTE(JSON_EXTRACT(v.specs,'$.body_type')),''))=?`; args.push(String(opts.bodyType).toLowerCase()); }
  const minP = num(opts.minPrice), maxP = num(opts.maxPrice), minY = num(opts.minYear), maxY = num(opts.maxYear), minM = num(opts.minMileage), maxM = num(opts.maxMileage);
  if (minP !== null) { where += ' AND v.price_usd>=?'; args.push(minP); } if (maxP !== null) { where += ' AND v.price_usd<=?'; args.push(maxP); }
  if (minY !== null) { where += ' AND v.model_year>=?'; args.push(minY); } if (maxY !== null) { where += ' AND v.model_year<=?'; args.push(maxY); }
  if (minM !== null) { where += ' AND v.mileage_km>=?'; args.push(minM); } if (maxM !== null) { where += ' AND v.mileage_km<=?'; args.push(maxM); }
  if (opts.stock === 'available') where += ` AND v.status='available'`; else if (opts.stock === 'preorder') where += ` AND v.status='pending_verification'`;
  return { where, args };
}
function orderOf(sort?: string) {
  switch (sort) {
    case 'price_asc': return 'v.price_usd IS NULL, v.price_usd ASC, v.id DESC';
    case 'price_desc': return 'v.price_usd IS NULL, v.price_usd DESC, v.id DESC';
    case 'year_desc': return 'v.model_year IS NULL, v.model_year DESC, v.id DESC';
    case 'mileage_asc': return 'v.mileage_km IS NULL, v.mileage_km ASC, v.id DESC';
    default: return `v.status='available' DESC, v.updated_at DESC, v.id DESC`;
  }
}

export async function getVehicles(q: VehicleQuery | number = {}) {
  const opts: VehicleQuery = typeof q === 'number' ? { limit: q } : q; const limit = lim(opts.limit ?? 1200);
  if (!dbConfigured()) {
    let list = combinedFallbackInventory();
    if (opts.category) list = list.filter((v: any) => v.category === opts.category);
    if (opts.brand) list = list.filter((v: any) => String(v.brand || '').toLowerCase() === String(opts.brand).toLowerCase());
    if (opts.search) { const s = String(opts.search).toLowerCase(); list = list.filter((v: any) => `${v.brand} ${v.model} ${v.stock_no}`.toLowerCase().includes(s)); }
    if (opts.category === 'motorcycle') list = list.filter((v: any) => String(v.brand || '').trim() && String(v.model || '').trim());
    return list.slice(0, limit).map(withRepresentative);
  }
  try {
    await ensureCatalogueReady();
    const { where, args } = buildWhere(opts);
    const list = await rows<any>(`SELECT v.*, ${COVER} FROM vehicles v WHERE ${where} ORDER BY ${orderOf(opts.sort)} LIMIT ${limit}`, args);
    return list.map(withRepresentative);
  } catch (e) { console.error('GET_VEHICLES_DB_ERROR', e); return []; }
}

export async function getVehicleFilterOptions(category = 'car') {
  if (!dbConfigured()) return { brands: [], fuels: [], bodyTypes: [], minPrice: 0, maxPrice: 0, minYear: 2011, maxYear: new Date().getFullYear(), minMileage: 0, maxMileage: 0 };
  try {
    await ensureCatalogueReady();
    const base = `status IN ('available','reserved','pending_verification') AND NOT (COALESCE(source,'')='whatsapp_group' AND status='pending_verification') AND category=?`;
    const brands = await rows<any>(`SELECT brand,COUNT(*) count FROM vehicles WHERE ${base} AND TRIM(COALESCE(brand,''))<>'' GROUP BY brand ORDER BY brand`, [category]);
    const fuels = await rows<any>(`SELECT LOWER(fuel_type) fuel,COUNT(*) count FROM vehicles WHERE ${base} AND TRIM(COALESCE(fuel_type,''))<>'' GROUP BY LOWER(fuel_type) ORDER BY fuel`, [category]);
    const bodies = await rows<any>(`SELECT LOWER(JSON_UNQUOTE(JSON_EXTRACT(specs,'$.body_type'))) body,COUNT(*) count FROM vehicles WHERE ${base} AND JSON_EXTRACT(specs,'$.body_type') IS NOT NULL GROUP BY body ORDER BY body`, [category]);
    const range: any = await one(`SELECT MIN(price_usd) minPrice,MAX(price_usd) maxPrice,MIN(model_year) minYear,MAX(model_year) maxYear,MIN(mileage_km) minMileage,MAX(mileage_km) maxMileage FROM vehicles WHERE ${base}`, [category]);
    return { brands, fuels, bodyTypes: bodies, ...range };
  } catch (e) { console.error('FILTER_OPTIONS', e); return { brands: [], fuels: [], bodyTypes: [] }; }
}

export async function getVehicle(id: string) {
  if (!dbConfigured()) return withRepresentative(combinedFallbackInventory().find((x: any) => String(x.id) === id || String(x.stock_no) === String(id)));
  try {
    await ensureCatalogueReady();
    const row = await one<any>(`SELECT v.*, ${COVER} FROM vehicles v WHERE (v.id=? OR v.legacy_id=? OR v.stock_no=?) AND v.status IN ('available','reserved','pending_verification','sold') AND ${NOT_PENDING_GROUP} LIMIT 1`, [id, id, id]);
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
    const media = await rows<any>(`SELECT id,${PUBLIC_URL} url,caption,is_cover,sort_order, CASE WHEN COALESCE(caption,'') LIKE 'MODEL PHOTO%' OR COALESCE(caption,'') LIKE '%Representative%' THEN 1 ELSE 0 END is_representative FROM vehicle_media m WHERE m.vehicle_id=? AND ${VERIFIED_MEDIA} ORDER BY is_cover DESC,sort_order,id LIMIT 20`, [vehicleId]);
    if (media.length) return media;
    const vehicle = await getVehicle(String(vehicleId));
    return representativeFor(vehicle);
  } catch (e) { console.error('GET_VEHICLE_MEDIA_DB_ERROR', e); return []; }
}
