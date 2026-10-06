/*
  Per-chat AI state, kept beside conversations (one row per conversation):
  current car, collected answers (slots), staff flag, AI pause, reply lock and the last
  customer message the AI/staff already answered.
*/
import { db, one } from './db';

let ready: Promise<void> | null = null;
export function ensureConversationState() {
  if (!ready) ready = (async () => {
    await db().execute(`CREATE TABLE IF NOT EXISTS conversation_state(
      conversation_id BIGINT UNSIGNED PRIMARY KEY,
      current_vehicle_id BIGINT UNSIGNED NULL,
      current_vehicle_source VARCHAR(30) NULL,
      slots JSON NULL,
      needs_staff TINYINT(1) NOT NULL DEFAULT 0,
      needs_staff_reason VARCHAR(255) NULL,
      needs_staff_at DATETIME NULL,
      ai_paused_until DATETIME NULL,
      paused_by VARCHAR(40) NULL,
      lock_token VARCHAR(64) NULL,
      lock_until DATETIME NULL,
      answered_through_id BIGINT UNSIGNED NOT NULL DEFAULT 0,
      last_read_message_id BIGINT UNSIGNED NOT NULL DEFAULT 0,
      last_staff_at DATETIME NULL,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX(needs_staff), INDEX(ai_paused_until), INDEX(current_vehicle_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
    // Columns added after the first release (ignore "already exists").
    for (const sql of [
      `ALTER TABLE conversation_state ADD COLUMN last_read_message_id BIGINT UNSIGNED NOT NULL DEFAULT 0`,
      `ALTER TABLE conversation_state ADD COLUMN ai_paused_until DATETIME NULL`,
      `ALTER TABLE messages ADD COLUMN status_updated_at DATETIME NULL`,
      `ALTER TABLE messages ADD COLUMN delivery_error VARCHAR(500) NULL`,
      `ALTER TABLE conversations ADD COLUMN archived_at DATETIME NULL`,
    ]) { try { await db().execute(sql); } catch (e: any) { if (e?.code !== 'ER_DUP_FIELDNAME') console.error('STATE_COLUMN', e?.code); } }
    // Speed for the live inbox (part 7). Ignore "already exists".
    for (const sql of [
      `ALTER TABLE messages ADD INDEX idx_msg_conv_id(conversation_id,id)`,
      `ALTER TABLE messages ADD UNIQUE INDEX uq_msg_ext(external_message_id)`, // parallel duplicate deliveries are stored once
      `ALTER TABLE conversations ADD INDEX idx_conv_last(last_message_at)`,
    ]) { try { await db().execute(sql); } catch (e: any) { if (e?.code !== 'ER_DUP_KEYNAME') console.error('STATE_INDEX', e?.code); } }
  })().catch(e => { ready = null; throw e; });
  return ready;
}

export type ChatState = {
  conversation_id: number; current_vehicle_id: number | null; current_vehicle_source: string | null; slots: Record<string, any>;
  needs_staff: boolean; needs_staff_reason: string | null; ai_paused_until: Date | null; answered_through_id: number; last_staff_at: Date | null;
};

const parse = (v: any) => { if (!v) return {}; if (typeof v === 'object') return v; try { return JSON.parse(v); } catch { return {}; } };

export async function getState(conversationId: number): Promise<ChatState> {
  await ensureConversationState();
  // New state rows start "answered" up to our last outbound message, so old history is never treated as a new burst.
  await db().execute(`INSERT IGNORE INTO conversation_state(conversation_id,answered_through_id)
    SELECT ?, COALESCE((SELECT MAX(id) FROM messages WHERE conversation_id=? AND direction='outbound'),0)`, [conversationId, conversationId]);
  const r = await one<any>(`SELECT * FROM conversation_state WHERE conversation_id=?`, [conversationId]);
  return {
    conversation_id: conversationId, current_vehicle_id: r?.current_vehicle_id ? Number(r.current_vehicle_id) : null,
    current_vehicle_source: r?.current_vehicle_source || null, slots: parse(r?.slots), needs_staff: !!Number(r?.needs_staff),
    needs_staff_reason: r?.needs_staff_reason || null, ai_paused_until: r?.ai_paused_until ? new Date(r.ai_paused_until) : null,
    answered_through_id: Number(r?.answered_through_id || 0), last_staff_at: r?.last_staff_at ? new Date(r.last_staff_at) : null,
  };
}

export async function setCurrentCar(conversationId: number, vehicleId: number | null, source: string) {
  await getState(conversationId);
  await db().execute(`UPDATE conversation_state SET current_vehicle_id=?, current_vehicle_source=? WHERE conversation_id=?`, [vehicleId, vehicleId ? source : null, conversationId]);
}

export async function saveSlots(conversationId: number, slots: Record<string, any>) {
  await db().execute(`UPDATE conversation_state SET slots=? WHERE conversation_id=?`, [JSON.stringify(slots || {}), conversationId]);
}

/** Flags the chat for staff while the AI stays ON (never switches the chat to HUMAN). */
export async function flagForStaff(conversationId: number, reason: string) {
  await getState(conversationId);
  await db().execute(`UPDATE conversation_state SET needs_staff=1, needs_staff_reason=?, needs_staff_at=COALESCE(needs_staff_at,NOW()) WHERE conversation_id=?`, [reason.slice(0, 255), conversationId]);
}
export async function clearStaffFlag(conversationId: number) {
  await db().execute(`UPDATE conversation_state SET needs_staff=0, needs_staff_reason=NULL, needs_staff_at=NULL WHERE conversation_id=?`, [conversationId]);
}

export async function markAnswered(conversationId: number, throughId: number) {
  await db().execute(`UPDATE conversation_state SET answered_through_id=GREATEST(answered_through_id,?) WHERE conversation_id=?`, [throughId, conversationId]);
}

/** Admin has seen the thread up to this message (the unread dot in the inbox). */
export async function markRead(conversationId: number, throughId: number) {
  await getState(conversationId);
  await db().execute(`UPDATE conversation_state SET last_read_message_id=GREATEST(last_read_message_id,?) WHERE conversation_id=?`, [Number(throughId) || 0, conversationId]);
}

/** Atomic per-chat lock: only one reply can be produced for a chat at a time (across workers). */
export async function tryLock(conversationId: number, seconds = 120) {
  await getState(conversationId);
  const token = Math.random().toString(36).slice(2) + Date.now().toString(36);
  const [r]: any = await db().execute(`UPDATE conversation_state SET lock_token=?, lock_until=(NOW() + INTERVAL ? SECOND)
    WHERE conversation_id=? AND (lock_until IS NULL OR lock_until < NOW())`, [token, seconds, conversationId]);
  return Number(r?.affectedRows) === 1 ? token : null;
}
export async function unlock(conversationId: number, token: string) {
  await db().execute(`UPDATE conversation_state SET lock_token=NULL, lock_until=NULL WHERE conversation_id=? AND lock_token=?`, [conversationId, token]);
}

export async function pauseAi(conversationId: number, minutes: number, by: string) {
  await getState(conversationId);
  await db().execute(`UPDATE conversation_state SET ai_paused_until=(NOW() + INTERVAL ? MINUTE), paused_by=?, last_staff_at=NOW() WHERE conversation_id=?`, [Math.max(1, Math.round(minutes)), by.slice(0, 40), conversationId]);
}
export async function resumeAi(conversationId: number) {
  await getState(conversationId);
  await db().execute(`UPDATE conversation_state SET ai_paused_until=NULL, paused_by=NULL WHERE conversation_id=?`, [conversationId]);
}
