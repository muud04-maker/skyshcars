/*
  Every change of "the vehicle this chat is about", with its source and the previous value.

  Why: staff often correct the vehicle the AI chose. We need to know
    - which vehicle the AI had (source 'ai'/'match'/'referral'),
    - which vehicle a HUMAN picked afterwards (source 'staff'/'human'/'correction'),
    - when a Facebook referral changed it,
  both for the admin stream and so a human selection inside the same chat can be reused as context.
  Additive table only; no existing data is touched.
*/
import { db, rows } from './db';

export type VehicleEventSource = 'ai' | 'match' | 'referral' | 'staff' | 'human' | 'correction' | 'admin';

let ready: Promise<void> | null = null;
export function ensureVehicleEventsSchema() {
  if (!ready) ready = db().execute(`CREATE TABLE IF NOT EXISTS conversation_vehicle_events (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    conversation_id BIGINT UNSIGNED NOT NULL,
    customer_id BIGINT UNSIGNED NULL,
    vehicle_id BIGINT UNSIGNED NULL,
    previous_vehicle_id BIGINT UNSIGNED NULL,
    source VARCHAR(40) NOT NULL DEFAULT 'ai',
    reason VARCHAR(191) NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_vehicle_event_conv(conversation_id,created_at),
    INDEX idx_vehicle_event_customer(customer_id,created_at),
    INDEX idx_vehicle_event_vehicle(vehicle_id,created_at),
    INDEX idx_vehicle_event_source(source,created_at)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`).then(() => undefined).catch(e => { ready = null; throw e; });
  return ready;
}

/** A human (staff/admin) chose the vehicle - never the AI. Used by the Facebook lead priority list. */
export function isHumanVehicleSource(source: unknown) {
  return ['staff', 'human', 'correction', 'admin'].includes(String(source || '').toLowerCase());
}

export async function recordVehicleEvent(input: {
  conversationId: number; customerId?: number | null; vehicleId: number | null;
  previousVehicleId?: number | null; source: string; reason?: string | null;
}) {
  if (!input?.conversationId) return null;
  try {
    await ensureVehicleEventsSchema();
    const [r]: any = await db().execute(
      `INSERT INTO conversation_vehicle_events(conversation_id,customer_id,vehicle_id,previous_vehicle_id,source,reason) VALUES(?,?,?,?,?,?)`,
      [Number(input.conversationId), input.customerId || null, input.vehicleId || null,
       input.previousVehicleId || null, String(input.source || 'ai').slice(0, 40),
       input.reason ? String(input.reason).slice(0, 191) : null]);
    return Number(r?.insertId) || null;
  } catch (e) { console.error('VEHICLE_EVENT', e); return null; }
}

export async function vehicleEventsForConversation(conversationId: number, limit = 30) {
  if (!conversationId) return [];
  await ensureVehicleEventsSchema();
  return rows<any>(`SELECT e.id,e.conversation_id,e.customer_id,e.vehicle_id,e.previous_vehicle_id,e.source,e.reason,e.created_at,
      v.stock_no,v.brand,v.model,v.model_year,v.category
    FROM conversation_vehicle_events e LEFT JOIN vehicles v ON v.id=e.vehicle_id
    WHERE e.conversation_id=? ORDER BY e.id DESC LIMIT ${Math.max(1, Math.min(200, limit))}`, [conversationId]).catch(() => []);
}

/** The most recent vehicle a HUMAN selected in this chat (Facebook lead priority step 4). */
export async function lastHumanVehicleSelection(conversationId: number) {
  if (!conversationId) return null;
  try {
    await ensureVehicleEventsSchema();
    const r = await rows<any>(`SELECT vehicle_id,source,created_at FROM conversation_vehicle_events
      WHERE conversation_id=? AND vehicle_id IS NOT NULL AND source IN ('staff','human','correction','admin')
      ORDER BY id DESC LIMIT 1`, [conversationId]);
    return r[0] ? { vehicle_id: Number(r[0].vehicle_id), source: String(r[0].source), created_at: r[0].created_at } : null;
  } catch { return null; }
}

/** Human-selected vehicles across the whole day (daily sales patterns). */
export async function humanVehicleSelectionsForDay(day: string, limit = 200) {
  await ensureVehicleEventsSchema();
  return rows<any>(`SELECT e.vehicle_id,e.conversation_id,e.source,e.created_at,v.stock_no,v.brand,v.model,v.category
    FROM conversation_vehicle_events e LEFT JOIN vehicles v ON v.id=e.vehicle_id
    WHERE e.created_at >= ? AND e.created_at <= ? AND e.vehicle_id IS NOT NULL
      AND e.source IN ('staff','human','correction','admin','referral')
    ORDER BY e.id DESC LIMIT ${Math.max(1, Math.min(1000, limit))}`, [`${day} 00:00:00`, `${day} 23:59:59`]).catch(() => []);
}
