/*
  Bulk actions for the admin inbox: take over / return to AI / pause / delete several chats at once.
  Deleting removes the conversations and their messages (foreign key cascade) but never the customer
  record. Bulk "Return to AI" resumes the AI for those chats; it answers their next message (use
  "AI Reply Now" inside a chat for an immediate answer).
*/
import { NextResponse } from 'next/server';
import { db } from '../../../../../lib/db';
import { adminDenied } from '../../../../../lib/admin-guard';
import { agentEvent } from '../../../../../lib/agent-events';
import { clearAiReply, clearStaffFlag, pauseAi, resumeAi } from '../../../../../lib/conversation-state';
import { staffPauseMinutes } from '../../../../../lib/staff';

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  const d = await adminDenied(); if (d) return d;
  const b = await req.json().catch(() => ({}));
  const ids = (Array.isArray(b.ids) ? b.ids : []).map(Number).filter(Boolean).slice(0, 200);
  const action = String(b.action || '');
  if (!ids.length) return NextResponse.json({ error: 'Select at least one conversation.' }, { status: 400 });
  if (!['ai', 'human', 'paused', 'archive', 'unarchive', 'unread', 'delete'].includes(action)) return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
  const inList = `(${ids.map(() => '?').join(',')})`;

  if (action === 'unread') {
    await db().execute(`UPDATE conversation_state SET last_read_message_id=0 WHERE conversation_id IN ${inList}`, ids).catch(() => {});
    return NextResponse.json({ ok: true, action, changed: ids.length, ids });
  }

  // Archive hides a chat from the main inbox but keeps all history (searchable under Archived).
  if (action === 'archive' || action === 'unarchive') {
    const [r]: any = await db().execute(`UPDATE conversations SET archived_at=${action === 'archive' ? 'NOW()' : 'NULL'} WHERE id IN ${inList}`, ids);
    if (action === 'archive') for (const id of ids) await clearAiReply(id).catch(() => {});
    return NextResponse.json({ ok: true, action, changed: Number(r?.affectedRows || 0), ids });
  }

  if (action === 'delete') {
    const { getAdminSession } = await import('../../../../../lib/admin');
    const session = await getAdminSession();
    if (session?.role !== 'owner') return NextResponse.json({ error: 'Only the owner can permanently delete conversations. Use Archive instead.' }, { status: 403 });
    try {
      await db().execute(`DELETE FROM conversation_state WHERE conversation_id IN ${inList}`, ids).catch(() => {});
      await db().execute(`DELETE FROM chat_referrals WHERE conversation_id IN ${inList}`, ids).catch(() => {});
      const [r]: any = await db().execute(`DELETE FROM conversations WHERE id IN ${inList}`, ids);
      const deleted = Number(r?.affectedRows || 0);
      try { await db().execute(`INSERT INTO audit_logs(actor,action,entity_type,entity_id,details) VALUES('admin','bulk_delete','conversations',?,?)`, [ids.join(',').slice(0, 190), JSON.stringify({ requested: ids.length, deleted })]); } catch {}
      await agentEvent(null, null, 'conversations_bulk_deleted', 'ok', { requested: ids.length, deleted }).catch(() => {});
      return NextResponse.json({ ok: true, action, deleted, ids });
    } catch (e: any) {
      return NextResponse.json({ error: e?.message || 'Could not delete the conversations' }, { status: 500 });
    }
  }

  const minutes = await staffPauseMinutes().catch(() => 15);
  let changed = 0;
  for (const id of ids) {
    try {
      if (action === 'human') {
        await db().execute("UPDATE conversations SET mode='human',takeover_by='admin',takeover_at=NOW() WHERE id=?", [id]);
        await clearAiReply(id).catch(() => {});
        await db().execute('INSERT INTO messages(conversation_id,sender,direction,message_type,body) VALUES(?,?,?,?,?)', [id, 'system', 'outbound', 'text', 'Admin took over conversation.']);
      } else if (action === 'paused') {
        await db().execute("UPDATE conversations SET mode='ai',takeover_by=NULL,takeover_at=NULL WHERE id=?", [id]);
        await pauseAi(id, minutes, 'admin').catch(() => {});
        await clearAiReply(id).catch(() => {});
        await db().execute('INSERT INTO messages(conversation_id,sender,direction,message_type,body) VALUES(?,?,?,?,?)', [id, 'system', 'outbound', 'text', `AI paused for ${minutes} min.`]);
      } else {
        await db().execute("UPDATE conversations SET mode='ai',takeover_by=NULL,takeover_at=NULL WHERE id=?", [id]);
        await resumeAi(id).catch(() => {});
        await clearStaffFlag(id).catch(() => {});
        await db().execute('INSERT INTO messages(conversation_id,sender,direction,message_type,body) VALUES(?,?,?,?,?)', [id, 'system', 'outbound', 'text', 'Conversation returned to AI.']);
      }
      changed++;
      await agentEvent(id, null, 'bulk_mode', 'ok', { action }).catch(() => {});
    } catch { /* keep going for the others */ }
  }
  return NextResponse.json({ ok: true, action, changed, ids });
}
