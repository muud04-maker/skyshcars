/*
  AI Catalog: the cars the WhatsApp/Messenger AI is allowed to sell.
  - vehicles.ai_enabled (0 for every pre-existing row).
  - business_settings 'ai_catalog' = {mode:'selected'|'all', migrated_at, migration_enabled:[...]}
  - 'selected' (default): only Available + ai_enabled=1 cars. 'all': every Available (sellable) car.
  Every AI lookup must go through aiCarSql() / loadAiCars(). The public website does not use this.
*/
import { db, one, rows } from './db';
import { exactPhotoSql, sellableVehicleSql } from './exact-photos';

export type CatalogMode = 'selected' | 'all';
type CatalogSetting = { mode: CatalogMode; migrated_at?: string; migration_enabled?: { id: number; stock_no: string; title: string }[] };

let ready: Promise<void> | null = null;
export function ensureAiCatalog() {
  if (!ready) ready = (async () => {
    try { await db().execute(`ALTER TABLE vehicles ADD COLUMN ai_enabled TINYINT(1) NOT NULL DEFAULT 0`); }
    catch (e: any) { if (e?.code !== 'ER_DUP_FIELDNAME') throw e; }
    try { await db().execute(`ALTER TABLE vehicles ADD INDEX idx_vehicles_ai(ai_enabled,status)`); }
    catch (e: any) { if (e?.code !== 'ER_DUP_KEYNAME') throw e; }
    // One-time migration, claimed atomically: only the process whose INSERT succeeds runs it.
    const [claim]: any = await db().execute(`INSERT IGNORE INTO business_settings(setting_key,setting_value) VALUES('ai_catalog',?)`,
      [JSON.stringify({ mode: 'selected', migrating: true })]);
    if (Number(claim?.affectedRows) === 1) {
      await db().execute(`UPDATE vehicles SET ai_enabled=0`);
      await db().execute(`UPDATE vehicles v SET v.ai_enabled=1 WHERE ${sellableVehicleSql('v')} AND v.created_at >= (NOW() - INTERVAL 72 HOUR)`);
      const enabled = await rows<any>(`SELECT id,stock_no,model_year,brand,model FROM vehicles WHERE ai_enabled=1 ORDER BY created_at DESC LIMIT 500`);
      const setting: CatalogSetting = {
        mode: 'selected', migrated_at: new Date().toISOString(),
        migration_enabled: enabled.map(v => ({ id: Number(v.id), stock_no: v.stock_no, title: [v.model_year, v.brand, v.model].filter(Boolean).join(' ') })),
      };
      await db().execute(`UPDATE business_settings SET setting_value=? WHERE setting_key='ai_catalog'`, [JSON.stringify(setting)]);
      console.log('AI_CATALOG_MIGRATION enabled', enabled.length, 'cars');
    }
  })().catch(e => { ready = null; throw e; });
  return ready;
}

const parse = (v: any) => { if (!v) return {}; if (typeof v === 'object') return v; try { return JSON.parse(v); } catch { return {}; } };

export async function getCatalogSetting(): Promise<CatalogSetting> {
  try {
    await ensureAiCatalog();
    const r = await one<any>(`SELECT setting_value FROM business_settings WHERE setting_key='ai_catalog'`);
    const v = parse(r?.setting_value);
    return { ...v, mode: v.mode === 'all' ? 'all' : 'selected' };
  } catch { return { mode: 'selected' }; }
}

export async function setCatalogMode(mode: CatalogMode) {
  const cur = await getCatalogSetting();
  await db().execute(`INSERT INTO business_settings(setting_key,setting_value) VALUES('ai_catalog',?) ON DUPLICATE KEY UPDATE setting_value=VALUES(setting_value)`,
    [JSON.stringify({ ...cur, mode: mode === 'all' ? 'all' : 'selected' })]);
}

/** SQL condition: car is in the AI catalog (alias a). */
export function aiCarSqlFor(mode: CatalogMode, a = 'v') {
  return `${sellableVehicleSql(a)}${mode === 'all' ? '' : ` AND ${a}.ai_enabled=1`}`;
}
export async function aiCarSql(a = 'v') { return aiCarSqlFor((await getCatalogSetting()).mode, a); }

export type AiCar = {
  id: number; stock_no: string; category: string; brand: string | null; model: string | null; trim_name: string | null;
  model_year: number | null; price_usd: number | null; mileage_km: number | null; engine: string | null; transmission: string | null;
  fuel_type: string | null; steering: string | null; color: string | null; location: string | null; exact_photo_count: number; created_at?: any;
};

const CAR_COLS = (a: string) => `${a}.id,${a}.stock_no,${a}.category,${a}.brand,${a}.model,${a}.trim_name,${a}.model_year,${a}.price_usd,${a}.mileage_km,${a}.engine,
  ${a}.transmission,${a}.fuel_type,${a}.steering,${a}.color,${a}.location,${a}.created_at,
  (SELECT COUNT(*) FROM vehicle_media m WHERE m.vehicle_id=${a}.id AND ${exactPhotoSql('m')}) exact_photo_count`;

const norm = (r: any): AiCar => ({ ...r, id: Number(r.id), price_usd: r.price_usd == null ? null : Number(r.price_usd), model_year: r.model_year == null ? null : Number(r.model_year),
  mileage_km: r.mileage_km == null ? null : Number(r.mileage_km), exact_photo_count: Number(r.exact_photo_count || 0) });

/** Every car the AI may sell (newest first). */
export async function loadAiCars(limit = 400): Promise<AiCar[]> {
  const cond = await aiCarSql('v');
  return (await rows<any>(`SELECT ${CAR_COLS('v')} FROM vehicles v WHERE ${cond} ORDER BY v.created_at DESC, v.id DESC LIMIT ${Math.max(1, Math.min(1000, limit))}`)).map(norm);
}

/** Available cars that are NOT in the AI catalog: only names/stock numbers are used, never price or photos. */
export async function loadDisabledCars(limit = 600) {
  const { mode } = await getCatalogSetting();
  if (mode === 'all') return [];
  return (await rows<any>(`SELECT v.id,v.stock_no,v.category,v.brand,v.model,v.trim_name,v.model_year FROM vehicles v
    WHERE ${sellableVehicleSql('v')} AND v.ai_enabled=0 ORDER BY v.created_at DESC LIMIT ${limit}`))
    .map(r => ({ id: Number(r.id), stock_no: r.stock_no, category: r.category, brand: r.brand, model: r.model, trim_name: r.trim_name, model_year: r.model_year == null ? null : Number(r.model_year) }));
}

/*
  Referral resolution inventory: EVERY sellable unit (cars AND motorcycles), whether or not the AI
  is allowed to sell it. A tapped Facebook ad/post names one exact vehicle, so we must be able to
  identify it even before the owner enables it for AI replies. Price is only selected for AI-enabled
  units, so a non-quotable vehicle can never leak a price into a reply.
*/
export type ReferralInventoryRow = {
  id: number; stock_no: string; category: string | null; brand: string | null; model: string | null;
  trim_name: string | null; model_year: number | null; price_usd: number | null; ai_enabled: boolean;
};
export async function loadReferralInventory(limit = 800): Promise<ReferralInventoryRow[]> {
  await ensureAiCatalog();
  const cap = Math.max(1, Math.min(2000, Number(limit) || 800));
  return (await rows<any>(`SELECT v.id,v.stock_no,v.category,v.brand,v.model,v.trim_name,v.model_year,v.ai_enabled,
      CASE WHEN v.ai_enabled=1 THEN v.price_usd ELSE NULL END price_usd
    FROM vehicles v WHERE ${sellableVehicleSql('v')} ORDER BY v.created_at DESC, v.id DESC LIMIT ${cap}`))
    .map(r => ({
      id: Number(r.id), stock_no: r.stock_no, category: r.category || null, brand: r.brand || null,
      model: r.model || null, trim_name: r.trim_name || null,
      model_year: r.model_year == null ? null : Number(r.model_year),
      price_usd: r.price_usd == null ? null : Number(r.price_usd),
      ai_enabled: !!Number(r.ai_enabled),
    }));
}

export async function isAiCar(vehicleId: number) {
  if (!vehicleId) return false;
  const cond = await aiCarSql('v');
  return !!(await one<any>(`SELECT v.id FROM vehicles v WHERE v.id=? AND ${cond} LIMIT 1`, [vehicleId]));
}

export async function aiCarById(vehicleId: number): Promise<AiCar | null> {
  if (!vehicleId) return null;
  const cond = await aiCarSql('v');
  const r = await one<any>(`SELECT ${CAR_COLS('v')} FROM vehicles v WHERE v.id=? AND ${cond} LIMIT 1`, [vehicleId]);
  return r ? norm(r) : null;
}

export async function catalogCounts() {
  const s = await getCatalogSetting();
  const total = await one<any>(`SELECT COUNT(*) n FROM vehicles v WHERE ${sellableVehicleSql('v')}`);
  const ai = await one<any>(`SELECT COUNT(*) n FROM vehicles v WHERE ${aiCarSqlFor(s.mode, 'v')}`);
  const cars = await one<any>(`SELECT COUNT(*) n FROM vehicles v WHERE ${sellableVehicleSql('v')} AND v.category='car'`).catch(() => null);
  const motos = await one<any>(`SELECT COUNT(*) n FROM vehicles v WHERE ${sellableVehicleSql('v')} AND v.category='motorcycle'`).catch(() => null);
  return { mode: s.mode, aiCount: Number(ai?.n || 0), availableCount: Number(total?.n || 0), carCount: Number(cars?.n || 0), motorcycleCount: Number(motos?.n || 0) };
}

// ---------- admin ----------

/**
 * Admin list for the AI Catalog. Shows EVERY vehicle (any status) so the owner can always find and
 * switch on the cars they want. A car only becomes sellable by the AI when its status is Available
 * (the AI queries still require status='available' AND ai_enabled=1).
 */
export async function listCatalogForAdmin(opts: {
  q?: string; filter?: 'all' | 'on' | 'off'; days?: number; status?: string;
  category?: string; brand?: string; noPhotos?: boolean; sort?: string; page?: number; limit?: number;
} = {}) {
  await ensureAiCatalog();
  const w: string[] = ['1=1'], a: any[] = [];
  const status = String(opts.status || '').trim();
  if (['available', 'reserved', 'sold', 'pending_verification', 'hidden'].includes(status)) { w.push('v.status=?'); a.push(status); }
  if (opts.q) { w.push(`(v.brand LIKE ? OR v.model LIKE ? OR v.stock_no LIKE ? OR v.trim_name LIKE ? OR CAST(v.model_year AS CHAR) LIKE ?)`); const q = `%${opts.q}%`; a.push(q, q, q, q, q); }
  if (opts.filter === 'on') w.push('v.ai_enabled=1');
  if (opts.filter === 'off') w.push('v.ai_enabled=0');
  if (opts.category === 'car' || opts.category === 'motorcycle') { w.push('v.category=?'); a.push(opts.category); }
  if (opts.brand) { w.push('v.brand=?'); a.push(String(opts.brand)); }
  if (opts.noPhotos) w.push(`(SELECT COUNT(*) FROM vehicle_media m WHERE m.vehicle_id=v.id AND ${exactPhotoSql('m')})=0`);
  if (opts.days) { w.push('v.created_at >= (NOW() - INTERVAL ? DAY)'); a.push(Number(opts.days)); }
  const order = opts.sort === 'price_asc' ? 'v.price_usd ASC, v.id DESC' : opts.sort === 'price_desc' ? 'v.price_usd DESC, v.id DESC'
    : opts.sort === 'year_desc' ? 'v.model_year DESC, v.id DESC' : 'v.created_at DESC, v.id DESC';
  const limit = Math.max(10, Math.min(200, Number(opts.limit) || 50));
  const page = Math.max(1, Number(opts.page) || 1);
  const where = w.join(' AND ');
  const total = Number((await one<any>(`SELECT COUNT(*) n FROM vehicles v WHERE ${where}`, a).catch(() => null))?.n || 0);
  const list = await rows<any>(`SELECT ${CAR_COLS('v')}, v.ai_enabled, v.status,
      (SELECT m.url FROM vehicle_media m WHERE m.vehicle_id=v.id AND m.review_status='approved' AND m.media_type='image' ORDER BY m.is_cover DESC,m.sort_order,m.id LIMIT 1) cover_url,
      (SELECT m.id FROM vehicle_media m WHERE m.vehicle_id=v.id AND m.review_status='approved' AND m.media_type='image' ORDER BY m.is_cover DESC,m.sort_order,m.id LIMIT 1) cover_id
    FROM vehicles v WHERE ${where} ORDER BY ${order} LIMIT ${limit} OFFSET ${(page - 1) * limit}`, a);
  return {
    list: list.map(r => ({ ...norm(r), ai_enabled: !!Number(r.ai_enabled), status: String(r.status || ''), sellable: String(r.status) === 'available', cover: r.cover_url ? (String(r.cover_url).startsWith('http') ? `/api/photo/${r.cover_id}` : r.cover_url) : null })),
    total, page, limit, pages: Math.max(1, Math.ceil(total / limit)),
  };
}

/** Brands present in inventory, for the AI Catalog brand filter. */
export async function catalogBrands() {
  try { return (await rows<any>(`SELECT DISTINCT brand FROM vehicles WHERE COALESCE(brand,'')<>'' ORDER BY brand LIMIT 300`)).map((r: any) => String(r.brand)); }
  catch { return [] as string[]; }
}

export async function setCarsEnabled(ids: number[], enabled: boolean) {
  await ensureAiCatalog();
  const clean = ids.map(Number).filter(Boolean).slice(0, 2000);
  if (!clean.length) return 0;
  const [r]: any = await db().execute(`UPDATE vehicles SET ai_enabled=? WHERE id IN (${clean.map(() => '?').join(',')})`, [enabled ? 1 : 0, ...clean]);
  return Number(r?.affectedRows || 0);
}

export async function bulkCatalog(action: 'only_recent' | 'enable_all' | 'disable_all', days = 3) {
  await ensureAiCatalog();
  const s = sellableVehicleSql('v');
  if (action === 'enable_all') { const [r]: any = await db().execute(`UPDATE vehicles v SET v.ai_enabled=1 WHERE ${s}`); return Number(r?.affectedRows || 0); }
  if (action === 'disable_all') { const [r]: any = await db().execute(`UPDATE vehicles SET ai_enabled=0`); return Number(r?.affectedRows || 0); }
  const d = Math.max(1, Math.min(365, Math.round(Number(days) || 3)));
  await db().execute(`UPDATE vehicles SET ai_enabled=0`);
  const [r]: any = await db().execute(`UPDATE vehicles v SET v.ai_enabled=1 WHERE ${s} AND v.created_at >= (NOW() - INTERVAL ? DAY)`, [d]);
  return Number(r?.affectedRows || 0);
}
