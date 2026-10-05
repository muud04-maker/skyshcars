/*
  Admin inbox helpers (Part 7, pure + testable): unread/pause/waiting maths, filters, message merge
  and day separators. No React, no DB.
*/

export type InboxRow = {
  id: number; channel?: string; external_user_id?: string; mode?: string | null;
  full_name?: string | null; phone?: string | null; preview?: string | null; last_message_at?: string | null;
  needs_reply?: number | null; needs_staff?: number | null; ai_paused_until?: string | null; lock_until?: string | null;
  current_vehicle_id?: number | null; current_stock_no?: string | null; waiting_minutes?: number | null;
  last_inbound_id?: number | null; last_read_message_id?: number | null; unread?: number | null;
};
export type InboxFilter = 'all' | 'waiting' | 'ai' | 'human' | 'paused' | 'needs_staff';
export type InboxMsg = { id: number | string; sender?: string | null; body?: string | null; message_type?: string | null; created_at?: string | null; [k: string]: any };

const ms = (v: any) => { const t = v ? Date.parse(String(v).replace(' ', 'T')) : NaN; return Number.isFinite(t) ? t : 0; };

export function computeUnread(row: InboxRow) {
  return Number(row.last_inbound_id || 0) > Number(row.last_read_message_id || 0) ? 1 : 0;
}

/** AI pause is still running. */
export function isPaused(row: InboxRow, now: number) {
  const t = ms(row.ai_paused_until);
  return !!t && t > now;
}
export function pauseSecondsLeft(row: InboxRow, now: number) {
  const t = ms(row.ai_paused_until);
  return t && t > now ? Math.max(0, Math.round((t - now) / 1000)) : 0;
}
/** Another worker holds the reply lock for this chat right now. */
export function isLocked(row: InboxRow, now: number) {
  const t = ms(row.lock_until);
  return !!t && t > now;
}

/** mm:ss countdown for the "AI paused for 12:34" badge. */
export function countdown(seconds: number) {
  const s = Math.max(0, Math.floor(Number(seconds) || 0));
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, '0')}`;
}

export function waitingLabel(row: InboxRow) {
  const m = Number(row.waiting_minutes);
  if (!Number.isFinite(m) || m < 0) return '';
  if (!row.needs_reply) return '';
  if (m < 1) return 'waiting';
  if (m < 60) return `waiting ${m} min`;
  return `waiting ${Math.floor(m / 60)} h ${m % 60} min`;
}

export function filterRows(rows: InboxRow[], filter: InboxFilter = 'all', q = '') {
  const query = String(q || '').trim().toLowerCase();
  return (rows || []).filter((r) => {
    if (filter === 'waiting' && !r.needs_reply) return false;
    if (filter === 'needs_staff' && !r.needs_staff) return false;
    if ((filter === 'ai' || filter === 'human' || filter === 'paused') && String(r.mode || '') !== filter) return false;
    if (query) {
      const hay = [r.full_name, r.phone, r.external_user_id, r.preview, r.current_stock_no].map((x) => String(x || '').toLowerCase()).join(' ');
      if (!hay.includes(query)) return false;
    }
    return true;
  });
}

/** Merge a delta batch into the messages already on screen (by id, oldest first, updates win). */
export function mergeMessages(prev: InboxMsg[] = [], incoming: InboxMsg[] = []): InboxMsg[] {
  const map = new Map<string, InboxMsg>();
  for (const m of prev) map.set(String(m.id), m);
  for (const m of incoming) map.set(String(m.id), { ...(map.get(String(m.id)) || {}), ...m });
  return [...map.values()].sort((a, b) => Number(a.id) - Number(b.id));
}

export function maxId(rows: InboxMsg[] = []) {
  return rows.reduce((n, m) => Math.max(n, Number(m.id) || 0), 0);
}

/** YYYY-MM-DD of a timestamp ('' when unusable). */
export function dayKey(iso: unknown) {
  const t = ms(iso);
  return t ? new Date(t).toISOString().slice(0, 10) : '';
}

/** "Today" / "Yesterday" / a readable date, for the day separators. */
export function dayLabel(iso: unknown, now: number) {
  const key = dayKey(iso);
  if (!key) return '';
  const today = dayKey(new Date(now).toISOString());
  const yesterday = dayKey(new Date(now - 86400000).toISOString());
  if (key === today) return 'Today';
  if (key === yesterday) return 'Yesterday';
  const d = new Date(ms(iso));
  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

/** Delivery badge for one message: sent / delivered / read / failed (+ reason). */
export function deliveryState(m: InboxMsg): { label: string; tone: 'ok' | 'bad' | 'muted'; reason?: string } | null {
  if (String(m.direction || '') !== 'outbound') return null;
  const s = String(m.delivery_status || '').toLowerCase();
  if (s === 'read') return { label: 'read', tone: 'ok' };
  if (s === 'delivered') return { label: 'delivered', tone: 'ok' };
  if (s === 'sent') return { label: 'sent', tone: 'muted' };
  if (s === 'failed' || s === 'error') return { label: 'failed', tone: 'bad', reason: String(m.delivery_error || '').slice(0, 200) || undefined };
  return null;
}
