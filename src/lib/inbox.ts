/*
  Server side of the Part 7 inbox: one capped conversation list query (used by the page and the
  polling endpoint), a change cursor, and the small per-chat state row. No websockets - the client
  polls this with a delta and gets a tiny answer when nothing changed.
*/
import { rows, one } from './db';
import { ensureConversationState } from './conversation-state';
import type { InboxRow } from './ai-rules/inbox';

export const INBOX_LIMIT = 300;

const LIST_SELECT = `
  co.id, co.channel, co.external_user_id, co.mode, co.last_message_at, co.archived_at,
  c.full_name, c.phone,
  (SELECT body FROM messages m WHERE m.conversation_id=co.id ORDER BY m.id DESC LIMIT 1) preview,
  CASE WHEN (SELECT COALESCE(MAX(m1.id),0) FROM messages m1 WHERE m1.conversation_id=co.id AND m1.sender='customer' AND m1.direction='inbound')
         > (SELECT COALESCE(MAX(m2.id),0) FROM messages m2 WHERE m2.conversation_id=co.id AND m2.sender IN ('ai','human') AND m2.direction='outbound')
       THEN 1 ELSE 0 END needs_reply,
  (SELECT COALESCE(MAX(m3.id),0) FROM messages m3 WHERE m3.conversation_id=co.id AND m3.sender='customer' AND m3.direction='inbound') last_inbound_id,
  (SELECT TIMESTAMPDIFF(MINUTE,(SELECT MAX(m4.created_at) FROM messages m4 WHERE m4.conversation_id=co.id AND m4.sender='customer' AND m4.direction='inbound'),NOW())) waiting_minutes,
  s.needs_staff, s.needs_staff_reason, s.ai_paused_until, s.lock_until,
  s.current_vehicle_id, s.answered_through_id, s.last_read_message_id, s.slots,
  (SELECT v.stock_no FROM vehicles v WHERE v.id=s.current_vehicle_id) current_stock_no`;

export async function listConversations(limit = INBOX_LIMIT, opts: { archived?: boolean } = {}): Promise<InboxRow[]> {
  await ensureConversationState().catch(() => {});
  const cap = Math.max(1, Math.min(1000, Number(limit) || INBOX_LIMIT));
  const arch = opts.archived ? 'co.archived_at IS NOT NULL' : 'co.archived_at IS NULL';
  try {
    const list = await rows<any>(`SELECT ${LIST_SELECT}
      FROM conversations co
      LEFT JOIN customers c ON c.id=co.customer_id
      LEFT JOIN conversation_state s ON s.conversation_id=co.id
      WHERE ${arch}
      ORDER BY co.last_message_at DESC, co.id DESC LIMIT ${cap}`);
    return list.map(normRow);
  } catch {
    const list = await rows<any>(`SELECT co.id, co.channel, co.external_user_id, co.mode, co.last_message_at, c.full_name, c.phone,
      (SELECT body FROM messages m WHERE m.conversation_id=co.id ORDER BY m.id DESC LIMIT 1) preview,
      CASE WHEN (SELECT COALESCE(MAX(m1.id),0) FROM messages m1 WHERE m1.conversation_id=co.id AND m1.sender='customer' AND m1.direction='inbound')
             > (SELECT COALESCE(MAX(m2.id),0) FROM messages m2 WHERE m2.conversation_id=co.id AND m2.sender IN ('ai','human') AND m2.direction='outbound')
           THEN 1 ELSE 0 END needs_reply,
      (SELECT COALESCE(MAX(m3.id),0) FROM messages m3 WHERE m3.conversation_id=co.id AND m3.sender='customer' AND m3.direction='inbound') last_inbound_id,
      (SELECT TIMESTAMPDIFF(MINUTE,(SELECT MAX(m4.created_at) FROM messages m4 WHERE m4.conversation_id=co.id AND m4.sender='customer' AND m4.direction='inbound'),NOW())) waiting_minutes
      FROM conversations co LEFT JOIN customers c ON c.id=co.customer_id
      WHERE ${arch}
      ORDER BY co.last_message_at DESC, co.id DESC LIMIT ${cap}`);
    return list.map(normRow);
  }
}

function normRow(r: any): InboxRow {
  return {
    ...r,
    id: Number(r.id),
    needs_reply: Number(r.needs_reply || 0),
    needs_staff: Number(r.needs_staff || 0),
    last_inbound_id: Number(r.last_inbound_id || 0),
    last_read_message_id: Number(r.last_read_message_id || 0),
    current_vehicle_id: r.current_vehicle_id ? Number(r.current_vehicle_id) : null,
    waiting_minutes: r.waiting_minutes == null ? null : Number(r.waiting_minutes),
  };
}

/** Cheap cursor: any change in the conversation rows moves it. */
export async function inboxCursor() {
  try {
    const r = await one<any>(`SELECT COUNT(*) n, COALESCE(MAX(last_message_at),'1970-01-01 00:00:00') m, COALESCE(MAX(mode),'') md FROM conversations`);
    const s = await one<any>(`SELECT COALESCE(MAX(updated_at),'1970-01-01 00:00:00') u FROM conversation_state`).catch(() => null);
    return `${Number(r?.n || 0)}:${String(r?.m || '')}:${String(r?.md || '')}:${String(s?.u || '')}`;
  } catch { return ''; }
}

/** The per-chat state shown in the right-hand context panel. */
export async function conversationStateRow(conversationId: number) {
  await ensureConversationState().catch(() => {});
  try {
    const s = await one<any>(`SELECT s.needs_staff,s.needs_staff_reason,s.ai_paused_until,s.lock_until,s.current_vehicle_id,s.answered_through_id,s.last_read_message_id,s.slots,s.updated_at,
      (SELECT v.stock_no FROM vehicles v WHERE v.id=s.current_vehicle_id) current_stock_no
      FROM conversation_state s WHERE s.conversation_id=? LIMIT 1`, [conversationId]);
    if (!s) return null;
    return { ...s, needs_staff: Number(s.needs_staff || 0), current_vehicle_id: s.current_vehicle_id ? Number(s.current_vehicle_id) : null, answered_through_id: Number(s.answered_through_id || 0), last_read_message_id: Number(s.last_read_message_id || 0) };
  } catch { return null; }
}
