/*
  Homepage "New Arrivals" rule (pure + testable).
  ONLY vehicles that are Available AND were added within the last N days (default 10).
  Sold / reserved / hidden / pending / demo rows are excluded, sorting is newest first, and the
  result is capped (default 12). Never falls back to older inventory.
*/

export const ARRIVAL_DAYS = 10;
export const ARRIVAL_LIMIT = 12;

export type ArrivalRow = { status?: any; source?: any; stock_no?: any; created_at?: any; [k: string]: any };

function ts(v: any) {
  if (v instanceof Date) return v.getTime();
  const t = Date.parse(String(v == null ? '' : v).replace(' ', 'T'));
  return Number.isFinite(t) ? t : 0;
}

export function isRecentAvailable(v: ArrivalRow, nowMs: number, days = ARRIVAL_DAYS) {
  if (String(v?.status || '') !== 'available') return false;
  if (String(v?.source || '').startsWith('demo_')) return false;
  if (String(v?.stock_no || '').toUpperCase().startsWith('DEMO-')) return false;
  const t = ts(v?.created_at);
  if (!t) return false;
  return t >= Number(nowMs) - Number(days) * 86400000;
}

export function selectNewArrivals(list: ArrivalRow[], opts: { nowMs: number; days?: number; limit?: number }) {
  const days = opts.days == null ? ARRIVAL_DAYS : Number(opts.days);
  const limit = opts.limit == null ? ARRIVAL_LIMIT : Number(opts.limit);
  return (list || [])
    .filter((v) => isRecentAvailable(v, opts.nowMs, days))
    .sort((a, b) => ts(b.created_at) - ts(a.created_at))
    .slice(0, Math.max(0, limit));
}
