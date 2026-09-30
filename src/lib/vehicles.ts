import fallback from '../../data/inventory.json';
import { rows, one, dbConfigured, lim } from './db';

/*
  SINGLE SOURCE OF TRUTH: the `vehicles` table.
  The website pages, the /api/vehicles endpoint and the WhatsApp AI all read from here.
  The old inventory.json is used ONLY when no database is configured at all
  (e.g. local preview). If the database is configured but fails, we show nothing
  rather than stale data, so a sold car can never reappear as available.
*/

const COVER = `(SELECT url FROM vehicle_media m WHERE m.vehicle_id=v.id AND m.review_status='approved'
  ORDER BY m.is_cover DESC, m.sort_order, m.id LIMIT 1) cover_url`;

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

export type VehicleQuery = { limit?: number; category?: string };

export async function getVehicles(q: VehicleQuery | number = {}) {
  const opts: VehicleQuery = typeof q === 'number' ? { limit: q } : q;
  const limit = lim(opts.limit ?? 500);
  if (!dbConfigured()) {
    let list = (fallback as any).inventory.map(legacy);
    if (opts.category) list = list.filter((v: any) => v.category === opts.category);
    return list.slice(0, limit);
  }
  try {
    const args: any[] = [];
    let where = `v.status IN ('available','reserved')`;
    if (opts.category) { where += ' AND v.category=?'; args.push(opts.category); }
    return await rows<any>(
      `SELECT v.*, ${COVER} FROM vehicles v WHERE ${where}
       ORDER BY v.status='available' DESC, v.updated_at DESC LIMIT ${limit}`, args);
  } catch (e) {
    console.error('GET_VEHICLES_DB_ERROR', e);
    return [];
  }
}

export async function getVehicle(id: string) {
  if (!dbConfigured()) return legacy((fallback as any).inventory.find((x: any) => String(x.id) === id));
  try {
    // Publicly visible statuses only; hidden / pending vehicles return 404.
    return await one<any>(
      `SELECT v.*, ${COVER} FROM vehicles v
       WHERE (v.id=? OR v.legacy_id=? OR v.stock_no=?) AND v.status IN ('available','reserved','sold') LIMIT 1`,
      [id, id, id]);
  } catch (e) {
    console.error('GET_VEHICLE_DB_ERROR', e);
    return null;
  }
}
