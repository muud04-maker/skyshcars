import { db, one, rows } from './db';
import { exactPhotoSql, sellableVehicleSql } from './exact-photos';

export const WHATSAPP_TARGET_GROUP_ID = '120363429404519527@g.us';

export type WhatsAppGroupDeliveryStatus = {
  supported: boolean;
  configured: boolean;
  state: 'disabled' | 'ready';
  reason: string;
  target_group_id: string;
  missing_requirement: string | null;
};

/**
 * The current Sky Cars integration uses WhatsApp Cloud API for individual customer chats and a
 * read-only WhatsApp Web reader for the supplier group. Neither is an authorized group sender for
 * the existing @g.us JID. Keep that path explicitly disabled; do not imitate group delivery by
 * messaging individual customers.
 */
export function whatsappGroupDeliveryStatus(): WhatsAppGroupDeliveryStatus {
  return {
    supported: false,
    configured: false,
    state: 'disabled',
    reason: 'No authorized WhatsApp group-sending connection is configured for this existing @g.us group.',
    target_group_id: WHATSAPP_TARGET_GROUP_ID,
    missing_requirement: 'A supported WhatsApp Groups API connection or an authorized group sending adapter, migrated and verified against this exact group.',
  };
}

export async function deliverVehicleToWhatsAppGroup(vehicleId: number) {
  const status = whatsappGroupDeliveryStatus();
  const vehicle: any = await one<any>(`SELECT id,stock_no,status,price_usd FROM vehicles v WHERE id=? AND ${sellableVehicleSql('v')} LIMIT 1`, [vehicleId]).catch(() => null);
  const photo: any = await one<any>(`SELECT id,url FROM vehicle_media m WHERE m.vehicle_id=? AND ${exactPhotoSql('m')} ORDER BY m.is_cover DESC,m.sort_order,m.id LIMIT 1`, [vehicleId]).catch(() => null);
  await db().execute(`CREATE TABLE IF NOT EXISTS social_publications(
    vehicle_id BIGINT UNSIGNED NOT NULL,channel VARCHAR(40) NOT NULL,
    state ENUM('processing','sent','failed','uncertain') NOT NULL DEFAULT 'processing',
    external_id VARCHAR(191) NULL,approved_price_usd DECIMAL(12,2) NULL,exact_photo_url TEXT NULL,
    attempt_count INT UNSIGNED NOT NULL DEFAULT 1,last_attempt_at DATETIME NULL,last_error TEXT NULL,
    publication_history JSON NULL,created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY(vehicle_id,channel),INDEX(state),INDEX(external_id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`).catch(() => {});
  await db().execute(`INSERT INTO social_publish_log(vehicle_id,channel,status,details)
    VALUES(?, 'whatsapp_group', 'skipped', ?)`,
  [vehicleId, JSON.stringify({ target_group_id: WHATSAPP_TARGET_GROUP_ID, reason: status.reason, missing_requirement: status.missing_requirement })]).catch(() => {});
  return {
    ok: false,
    skipped: true,
    status,
    vehicle: vehicle ? { id: Number(vehicle.id), stock_no: vehicle.stock_no, price_usd: vehicle.price_usd == null ? null : Number(vehicle.price_usd), has_exact_photo: !!photo } : null,
  };
}

export async function recentWhatsAppGroupAttempts(limit = 20) {
  return rows<any>(`SELECT l.*,v.stock_no,v.brand,v.model FROM social_publish_log l
    LEFT JOIN vehicles v ON v.id=l.vehicle_id
    WHERE l.channel='whatsapp_group' ORDER BY l.id DESC LIMIT ${Math.max(1, Math.min(100, Number(limit) || 20))}`).catch(() => []);
}
