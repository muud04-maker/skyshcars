/*
  Cron worker for the 60-second AI reply queue.
  Runs on the server: picks chats whose deadline has passed, re-checks the cancel rules
  (staff reply / HUMAN / paused / archived / nothing to answer), then lets the ONE reply engine
  produce a single reply. Safe to run every minute and safe to run twice at once (engine lock +
  answered marker + clearing the pending deadline).
*/
import { rows } from './db';
import { clearAiReply } from './conversation-state';
import { runReplyEngine } from './sales-engine';
import { shouldCancelQueued } from './ai-rules/ai-queue';

export async function processDueAiReplies(limit = 25) {
  const due = await rows<any>(`SELECT s.conversation_id, s.ai_paused_until, UNIX_TIMESTAMP(s.last_staff_at) staff_at, c.mode, c.archived_at,
      (SELECT COALESCE(MAX(m.id),0) FROM messages m WHERE m.conversation_id=c.id AND m.sender='customer' AND m.direction='inbound') last_inbound,
      (SELECT COALESCE(MAX(m.id),0) FROM messages m WHERE m.conversation_id=c.id AND m.sender IN ('ai','human') AND m.direction='outbound') last_outbound,
      (SELECT UNIX_TIMESTAMP(MAX(m.created_at)) FROM messages m WHERE m.conversation_id=c.id AND m.sender='customer' AND m.direction='inbound') last_inbound_at
    FROM conversation_state s JOIN conversations c ON c.id=s.conversation_id
    WHERE s.pending_ai_reply_at IS NOT NULL AND s.pending_ai_reply_at <= NOW()
    ORDER BY s.pending_ai_reply_at ASC LIMIT ${Math.max(1, Math.min(100, Number(limit) || 25))}`).catch(() => []);
  const results: any[] = [];
  for (const r of due) {
    const id = Number(r.conversation_id);
    const paused = r.ai_paused_until ? new Date(r.ai_paused_until).getTime() > Date.now() : false;
    const verdict = shouldCancelQueued({
      mode: r.mode, paused, archived: !!r.archived_at,
      lastInboundId: r.last_inbound, lastOutboundId: r.last_outbound,
      lastInboundAtMs: Number(r.last_inbound_at || 0) * 1000, lastStaffAtMs: Number(r.staff_at || 0) * 1000,
    });
    if (verdict.cancel) {
      await clearAiReply(id);
      results.push({ conversation_id: id, action: 'cancelled', reason: verdict.reason });
      continue;
    }
    const res: any = await runReplyEngine(id, { trigger: 'sweep' }).catch((e) => ({ status: 'failed', reason: String(e) }));
    await clearAiReply(id);
    results.push({ conversation_id: id, action: 'processed', status: res?.status, reason: res?.reason });
  }
  return results;
}
