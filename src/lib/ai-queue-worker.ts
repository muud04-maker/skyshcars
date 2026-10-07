/*
  Cron worker for the 60-second AI reply queue.
  Picks chats whose deadline has passed, re-checks the cancel rules (staff reply / HUMAN / paused /
  archived / nothing to answer), then lets the ONE reply engine produce a single reply.

  Safety:
  - one bad chat can never stop the others (each item is isolated),
  - a failed send retries up to 3 times (60s apart) and is then handed to staff with a visible reason,
  - duplicate cron runs are safe (engine lock + answered marker + clearing the deadline).
*/
import { rows } from './db';
import { clearAiReply, flagForStaff, recordAiQueueAttempt, scheduleAiReply } from './conversation-state';
import { runReplyEngine } from './sales-engine';
import { shouldCancelQueued } from './ai-rules/ai-queue';

const MAX_ATTEMPTS = 3;

export async function processDueAiReplies(limit = 25) {
  const due = await rows<any>(`SELECT s.conversation_id, s.ai_paused_until, UNIX_TIMESTAMP(s.last_staff_at) staff_at,
      COALESCE(s.pending_attempts,0) attempts, c.mode, c.archived_at,
      (SELECT COALESCE(MAX(m.id),0) FROM messages m WHERE m.conversation_id=c.id AND m.sender='customer' AND m.direction='inbound') last_inbound,
      (SELECT COALESCE(MAX(m.id),0) FROM messages m WHERE m.conversation_id=c.id AND m.sender IN ('ai','human') AND m.direction='outbound') last_outbound,
      (SELECT UNIX_TIMESTAMP(MAX(m.created_at)) FROM messages m WHERE m.conversation_id=c.id AND m.sender='customer' AND m.direction='inbound') last_inbound_at
    FROM conversation_state s JOIN conversations c ON c.id=s.conversation_id
    WHERE s.pending_ai_reply_at IS NOT NULL AND s.pending_ai_reply_at <= NOW()
    ORDER BY s.pending_ai_reply_at ASC LIMIT ${Math.max(1, Math.min(100, Number(limit) || 25))}`).catch(() => []);
  const results: any[] = [];
  for (const r of due) {
    const id = Number(r.conversation_id);
    try {
      const paused = r.ai_paused_until ? new Date(r.ai_paused_until).getTime() > Date.now() : false;
      const verdict = shouldCancelQueued({
        mode: r.mode, paused, archived: !!r.archived_at,
        lastInboundId: r.last_inbound, lastOutboundId: r.last_outbound,
        lastInboundAtMs: Number(r.last_inbound_at || 0) * 1000, lastStaffAtMs: Number(r.staff_at || 0) * 1000,
      });
      if (verdict.cancel) {
        await recordAiQueueAttempt(id, `cancelled: ${verdict.reason}`, 0);
        await clearAiReply(id);
        results.push({ conversation_id: id, action: 'cancelled', reason: verdict.reason });
        continue;
      }
      const res: any = await runReplyEngine(id, { trigger: 'sweep' }).catch((e) => ({ status: 'failed', reason: String(e?.message || e) }));
      if (res?.status === 'failed') {
        const attempts = Number(r.attempts || 0) + 1;
        await recordAiQueueAttempt(id, `failed (attempt ${attempts}): ${String(res?.reason || 'error').slice(0, 120)}`, attempts);
        if (attempts >= MAX_ATTEMPTS) {
          // Never leave a chat stuck forever: stop retrying, tell staff, keep the chat visible.
          await clearAiReply(id);
          await flagForStaff(id, 'AI could not send its reply after 3 attempts').catch(() => {});
          results.push({ conversation_id: id, action: 'gave_up', attempts, reason: res?.reason });
        } else {
          await scheduleAiReply(id, 60, null);   // retry once more in 60 seconds
          results.push({ conversation_id: id, action: 'retry', attempts, reason: res?.reason });
        }
        continue;
      }
      await recordAiQueueAttempt(id, `${res?.status || 'done'}${res?.reason ? `: ${res.reason}` : ''}`, 0);
      await clearAiReply(id);
      results.push({ conversation_id: id, action: 'processed', status: res?.status, reason: res?.reason });
    } catch (e: any) {
      // Isolate failures: one bad chat must not stop the rest.
      await recordAiQueueAttempt(id, `error: ${String(e?.message || e).slice(0, 120)}`, 0).catch(() => {});
      results.push({ conversation_id: id, action: 'error', reason: String(e?.message || e) });
    }
  }
  return results;
}
