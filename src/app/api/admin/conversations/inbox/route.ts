/*
  Part 7 polling endpoint (no websockets). Returns only what changed:
    - conversations: only when the list cursor moved
    - messages:      only messages newer than after_message_id, plus status changes since since_messages
    - state:         the small per-chat state row (needs_staff, pause, lock, current car, slots)
  When nothing changed the answer is tiny ({ unchanged:true }).
*/
import { NextResponse } from 'next/server';
import { one, rows } from '../../../../../lib/db';
import { adminDenied } from '../../../../../lib/admin-guard';
import { conversationStateRow, inboxCursor, listConversations } from '../../../../../lib/inbox';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const d = await adminDenied(); if (d) return d;
  const q = new URL(req.url).searchParams;
  const conversationId = Number(q.get('conversation')) || 0;
  const afterMessageId = Number(q.get('after_message_id')) || 0;
  const sinceMessages = String(q.get('since_messages') || '');
  const since = String(q.get('since') || '');

  const nowRow = await one<any>('SELECT NOW() n').catch(() => null);
  const statusCursor = nowRow?.n ? new Date(nowRow.n).toISOString() : new Date().toISOString();
  const cursor = await inboxCursor();

  const out: any = { cursor, status_cursor: statusCursor };

  if (since !== cursor) out.conversations = await listConversations().catch(() => []);

  if (conversationId) {
    // Newest messages plus any message whose delivery status changed since the last poll.
    const withStatus = sinceMessages ? ' OR (status_updated_at IS NOT NULL AND status_updated_at > ?)' : '';
    const args: any[] = sinceMessages ? [conversationId, afterMessageId, sinceMessages] : [conversationId, afterMessageId];
    out.messages = await rows<any>(`SELECT id,sender,direction,message_type,body,media_url,delivery_status,delivery_error,created_at
      FROM messages WHERE conversation_id=? AND (id > ?${withStatus}) ORDER BY id ASC LIMIT 300`, args).catch(() => []);
    out.state = await conversationStateRow(conversationId).catch(() => null);
    if (out.messages.length) out.message_cursor = out.messages.reduce((n: number, m: any) => Math.max(n, Number(m.id) || 0), afterMessageId);
  }

  if (!out.conversations && !out.messages) { out.unchanged = true; delete out.messages; }
  return NextResponse.json(out);
}
