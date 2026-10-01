import fallback from '../../data/inventory.json';
import { rows, one, dbConfigured, lim, db } from './db';
import { ensureLast50Vehicles } from './inventory-seed';

/*
  SINGLE SOURCE OF TRUTH: the `vehicles` table.
  The website, admin, API and WhatsApp all read the same records.
  The old JSON is used only for local preview when no database is configured.
*/

const VERIFIED_MEDIA = `m.media_type='image' AND m.review_status='approved'
  AND m.url NOT LIKE '/demo/vehicles/%'
  AND m.url NOT LIKE '%vehicle-placeholder%'
  AND m.url NOT LIKE '/api/vehicle-art/%'
  AND COALESCE(m.caption,'') NOT LIKE 'MODEL PHOTO%'
  AND COALESCE(m.caption,'') NOT LIKE '%Reference image%'`;

const COVER = `(SELECT url FROM vehicle_media m WHERE m.vehicle_id=v.id AND ${VERIFIED_MEDIA}
  ORDER BY m.is_cover DESC, m.sort_order, m.id LIMIT 1) cover_url`;

let readyPromise:Promise<void>|null=null;
async function ensureCatalogueReady(){
  if(!dbConfigured()) return;
  if(readyPromise) return readyPromise;
  readyPromise=(async()=>{
    await ensureLast50Vehicles();
    // Old V12/V15 demo/reference media caused unrelated vehicles to share pictures.
    // Remove only known generated/reference rows; real admin/supplier photos are untouched.
    await db().execute(`DELETE FROM vehicle_media WHERE
      url LIKE '/demo/vehicles/%' OR url LIKE '%vehicle-placeholder%' OR url LIKE '/api/vehicle-art/%'
      OR COALESCE(caption,'') LIKE 'MODEL PHOTO%' OR COALESCE(caption,'') LIKE '%Reference image%'`);
  })().catch(e=>{readyPromise=null;console.error('CATALOGUE_READY',e)});
  return readyPromise;
}

function legacy(v: any) {
  if (!v) return null;
  return {
    id: v.id, stock_no: `SC${String(v.id).padStart(5, '0')}`, category: v.category,
    brand: v.brand, model: v.model, model_year: v.year, price_usd: v.price_usd,
    status: 'available', mileage_km: v.specifications?.actual_mileage || v.specifications?.mileage,
    transmission: v.specifications?.transmission, engine: v.specifications?.engine,
    location: v.location || 'China', cover_url: null,
  };
}

export type VehicleQuery = { limit?: number; category?: string; search?: string; brand?: string };

export async function getVehicles(q: VehicleQuery | number = {}) {
  const opts: VehicleQuery = typeof q === 'number' ? { limit: q } : q;
  const limit = lim(opts.limit ?? 500);
  if (!dbConfigured()) {
    let list = (fallback as any).inventory.map(legacy);
    if (opts.category) list = list.filter((v: any) => v.category === opts.category);
    if (opts.brand) list = list.filter((v:any)=>String(v.brand||'').toLowerCase().includes(String(opts.brand).toLowerCase()));
    if (opts.search) {const s=String(opts.search).toLowerCase();list=list.filter((v:any)=>`${v.brand} ${v.model} ${v.stock_no}`.toLowerCase().includes(s));}
    return list.slice(0, limit);
  }
  try {
    await ensureCatalogueReady();
    const args: any[] = [];
    // During testing/public catalogue, show the full active inventory. Pending-verification
    // stock is visible but is labelled "Check availability" instead of pretending it is verified.
    let where = `v.status IN ('available','reserved','pending_verification')`;
    if (opts.category) { where += ' AND v.category=?'; args.push(opts.category); }
    if (opts.brand) { where += ' AND LOWER(CONCAT_WS(\' \',v.brand,v.model,v.trim_name)) LIKE ?'; args.push('%'+String(opts.brand).toLowerCase()+'%'); }
    if (opts.search) {
      where += ' AND (LOWER(v.brand) LIKE ? OR LOWER(v.model) LIKE ? OR LOWER(COALESCE(v.trim_name,\'\')) LIKE ? OR LOWER(v.stock_no) LIKE ?)';
      const s='%'+String(opts.search).toLowerCase()+'%'; args.push(s,s,s,s);
    }
    return await rows<any>(
      `SELECT v.*, ${COVER} FROM vehicles v WHERE ${where}
       ORDER BY v.status='available' DESC, v.updated_at DESC, v.id DESC LIMIT ${limit}`, args);
  } catch (e) {
    console.error('GET_VEHICLES_DB_ERROR', e);
    return [];
  }
}

export async function getVehicle(id: string) {
  if (!dbConfigured()) return legacy((fallback as any).inventory.find((x: any) => String(x.id) === id));
  try {
    await ensureCatalogueReady();
    return await one<any>(
      `SELECT v.*, ${COVER} FROM vehicles v
       WHERE (v.id=? OR v.legacy_id=? OR v.stock_no=?) AND v.status IN ('available','reserved','pending_verification','sold') LIMIT 1`,
      [id, id, id]);
  } catch (e) {
    console.error('GET_VEHICLE_DB_ERROR', e);
    return null;
  }
}

export async function getVehicleMedia(vehicleId:number|string){
  if(!dbConfigured()) return [];
  try{
    return await rows<any>(`SELECT id,url,caption,source,is_cover,sort_order FROM vehicle_media m
      WHERE m.vehicle_id=? AND ${VERIFIED_MEDIA}
      ORDER BY is_cover DESC,sort_order,id LIMIT 12`,[vehicleId]);
  }catch(e){console.error('GET_VEHICLE_MEDIA_DB_ERROR',e);return []}
}
