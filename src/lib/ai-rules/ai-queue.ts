/*
  The 60-second AI reply queue (pure + testable).

  A customer message does not get an instant AI reply any more: the chat is scheduled for
  `REPLY_DELAY_SECONDS` from the LATEST customer message, and a cron worker sends ONE reply when due.
  Everything here is deterministic so the scheduling/cancel rules can be tested offline.
*/

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

/** Compact inbox label: "AI reply in 42s" while counting down, then "AI reply queued". */
export function countdownLabel(left: number) {
  const s = Math.max(0, Math.round(Number(left) || 0));
  return s > 0 ? `AI reply in ${s}s` : 'AI reply queued';
}

/**
 * Before the worker sends a queued reply it must re-check the chat. Staff (or a mode/pause/archive
 * change) always wins over a pending AI reply.
 */
export function shouldCancelQueued(input: {
  mode?: string | null; paused?: boolean; archived?: boolean;
  lastInboundId?: number | null; lastOutboundId?: number | null;
}) {
  if (input.archived) return { cancel: true, reason: 'archived' };
  if (String(input.mode || 'ai') !== 'ai') return { cancel: true, reason: String(input.mode) === 'human' ? 'human_takeover' : 'paused_mode' };
  if (input.paused) return { cancel: true, reason: 'ai_paused' };
  const inbound = Number(input.lastInboundId || 0);
  const outbound = Number(input.lastOutboundId || 0);
  if (outbound > 0 && outbound > inbound) return { cancel: true, reason: 'staff_replied' };
  if (!inbound) return { cancel: true, reason: 'nothing_to_answer' };
  return { cancel: false, reason: '' };
}
