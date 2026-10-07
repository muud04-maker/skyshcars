/*
  The 60-second AI reply queue (pure + testable).

  A customer message does not get an instant AI reply any more: the chat is scheduled for
  `REPLY_DELAY_SECONDS` from the LATEST customer message, and a cron worker sends ONE reply when due.
  Everything here is deterministic so the scheduling/cancel rules can be tested offline.
*/

/** Normal AI-first reply: a short debounce so a quick burst is merged into ONE reply. */
export const REPLY_DEBOUNCE_SECONDS = 4;
/** Recovery/retry delay (cron fallback, failed send retry). */
export const REPLY_DELAY_SECONDS = 60;

export function deadlineMs(nowMs: number, seconds = REPLY_DELAY_SECONDS) {
  return Number(nowMs) + Math.max(1, Number(seconds) || REPLY_DELAY_SECONDS) * 1000;
}

/** Is the queued reply due (pending_at has passed)? */
export function isDue(pendingAtMs: number | null | undefined, nowMs: number) {
  if (!pendingAtMs) return false;
  const t = Number(pendingAtMs);
  return Number.isFinite(t) && t <= Number(nowMs);
}

export function secondsLeft(pendingAtMs: number | null | undefined, nowMs: number) {
  if (!pendingAtMs) return 0;
  return Math.max(0, Math.round((Number(pendingAtMs) - Number(nowMs)) / 1000));
}

/** Compact inbox label: "AI replying in 4s" while counting down, then "AI sending...". */
export function countdownLabel(left: number) {
  const s = Math.max(0, Math.round(Number(left) || 0));
  return s > 0 ? `AI replying in ${s}s` : 'AI sending...';
}

/** Admin-visible queue state: pending countdown, sending, or a failed attempt that will retry. */
export function queueStatusLabel(input: { secondsLeft: number; lastResult?: string | null; pending?: boolean }) {
  const last = String(input.lastResult || '');
  if (last.startsWith('failed')) return input.pending ? 'AI reply failed - retrying' : 'AI reply failed';
  if (last.startsWith('gave_up')) return `AI reply failed - ${last.replace(/^gave_up:?\s*/, '') || 'needs staff'}`;
  if (last.startsWith('cancelled')) return `AI queue cancelled - ${last.replace(/^cancelled:?\s*/, '')}`;
  if (input.pending) return countdownLabel(input.secondsLeft);
  return last ? `AI reply ${last}` : '';
}

/**
 * Before the worker sends a queued reply it must re-check the chat. Staff (or a mode/pause/archive
 * change) always wins over a pending AI reply.
 */
export function shouldCancelQueued(input: {
  mode?: string | null; paused?: boolean; archived?: boolean;
  lastInboundId?: number | null; lastOutboundId?: number | null;
  lastInboundAtMs?: number | null; lastStaffAtMs?: number | null;
}) {
  if (input.archived) return { cancel: true, reason: 'archived' };
  const mode = String(input.mode || 'ai');
  // 'ai' and 'both' allow the AI; 'human' (take over) and 'paused' never do.
  if (mode !== 'ai' && mode !== 'both') return { cancel: true, reason: mode === 'human' ? 'human_takeover' : 'paused_mode' };
  if (input.paused) {
    // A staff pause silences only the turn the human answered. If the customer wrote AFTER the staff
    // reply, the AI is eligible again and the queued reply must go ahead.
    const spokeAfterStaff = !!(input.lastInboundAtMs && (!input.lastStaffAtMs || Number(input.lastInboundAtMs) > Number(input.lastStaffAtMs)));
    if (!spokeAfterStaff) return { cancel: true, reason: 'ai_paused' };
  }
  const inbound = Number(input.lastInboundId || 0);
  const outbound = Number(input.lastOutboundId || 0);
  if (outbound > 0 && outbound > inbound) return { cancel: true, reason: 'staff_replied' };
  if (!inbound) return { cancel: true, reason: 'nothing_to_answer' };
  return { cancel: false, reason: '' };
}
