import { db, one, rows } from './db';
import { sellableVehicleSql } from './exact-photos';

let ready: Promise<void> | null = null;
export function ensureAdCampaignSchema() {
  if (!ready) ready = db().execute(`CREATE TABLE IF NOT EXISTS ai_ad_campaigns(
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    vehicle_id BIGINT UNSIGNED NOT NULL,
    facebook_ref VARCHAR(191) NULL,
    notes TEXT NULL,
    starts_at DATETIME NULL,
    ends_at DATETIME NULL,
    status ENUM('active','paused','ended') NOT NULL DEFAULT 'active',
    featured BOOLEAN NOT NULL DEFAULT FALSE,
    created_by VARCHAR(191) NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX(vehicle_id),INDEX(status,starts_at,ends_at),INDEX(facebook_ref)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`).then(() => undefined).catch((error) => {
    ready = null;
    throw error;
  });
  return ready;
}

export async function listAdCampaigns() {
  await ensureAdCampaignSchema();
  return rows<any>(`SELECT a.*,v.stock_no,v.category,v.brand,v.model,v.trim_name,v.model_year,
      v.price_usd,v.status vehicle_status
    FROM ai_ad_campaigns a JOIN vehicles v ON v.id=a.vehicle_id
    ORDER BY a.featured DESC,a.updated_at DESC LIMIT 100`);
}

export async function saveAdCampaign(input: any, actor = 'admin') {
  await ensureAdCampaignSchema();
  const vehicleId = Number(input.vehicle_id);
  if (!vehicleId) throw new Error('Choose an advertised vehicle');
  const vehicle: any = await one<any>(`SELECT id,status FROM vehicles v WHERE id=? AND ${sellableVehicleSql('v')} LIMIT 1`, [vehicleId]);
  if (!vehicle) throw new Error('Only an Available vehicle can be marked as advertised');
  const status = ['active', 'paused', 'ended'].includes(String(input.status)) ? String(input.status) : 'active';
  const sqlDate = (value: any) => String(value || '').trim().replace('T', ' ').slice(0, 19) || null;
  const values = [
    vehicleId, String(input.facebook_ref || '').trim().slice(0, 191) || null,
    String(input.notes || '').trim().slice(0, 4000) || null,
    sqlDate(input.starts_at), sqlDate(input.ends_at), status, input.featured ? 1 : 0, actor,
  ];
  const id = Number(input.id);
  if (id) {
    await db().execute(`UPDATE ai_ad_campaigns SET vehicle_id=?,facebook_ref=?,notes=?,starts_at=?,ends_at=?,
      status=?,featured=?,created_by=? WHERE id=?`, [...values, id]);
    return { ok: true, id };
  }
  const [result]: any = await db().execute(`INSERT INTO ai_ad_campaigns(
    vehicle_id,facebook_ref,notes,starts_at,ends_at,status,featured,created_by
  ) VALUES(?,?,?,?,?,?,?,?)`, values);
  return { ok: true, id: Number(result.insertId) };
}

export async function activeAdVehicleForSource(sourceId: unknown) {
  const ref = String(sourceId || '').trim();
  if (!ref) return null;
  await ensureAdCampaignSchema();
  return one<any>(`SELECT vehicle_id FROM ai_ad_campaigns
    WHERE facebook_ref=? AND status='active'
      AND (starts_at IS NULL OR starts_at<=NOW()) AND (ends_at IS NULL OR ends_at>=NOW())
    ORDER BY featured DESC,updated_at DESC LIMIT 1`, [ref]);
}

export async function recentActiveAdContext(limit = 6) {
  await ensureAdCampaignSchema();
  return rows<any>(`SELECT a.id,a.vehicle_id,a.facebook_ref,a.notes,a.starts_at,a.ends_at,v.stock_no,v.brand,v.model,v.model_year,v.price_usd
    FROM ai_ad_campaigns a JOIN vehicles v ON v.id=a.vehicle_id
    WHERE a.status='active' AND (a.starts_at IS NULL OR a.starts_at<=NOW()) AND (a.ends_at IS NULL OR a.ends_at>=NOW())
    ORDER BY a.featured DESC,a.updated_at DESC LIMIT ${Math.max(1, Math.min(20, Number(limit) || 6))}`);
}
