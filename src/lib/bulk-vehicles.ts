/*
  Bulk availability (brief section 5). Two explicit actions only - available / sold - never hidden
  (Sold and Hidden are different states and must not be conflated). The selection is either an explicit
  id list (manual ticks, including ticks made on other pages) or the current filtered result set.

  Pure SQL builder + validation so the rules are testable without a database; the route runs it inside a
  transaction and reports updated / skipped / failed counts.
*/

export const BULK_ACTIONS = ['available', 'sold'] as const;
export type BulkAction = (typeof BULK_ACTIONS)[number];

export type BulkSelection = {
  ids?: number[] | null;
  all_matching?: {
    q?: string; status?: string; category?: string; brand?: string; model?: string;
    year?: string | number; minPrice?: string | number; maxPrice?: string | number;
    noPhotos?: boolean; aiOn?: boolean; aiOff?: boolean;
  } | null;
};

export const STATUSES = ['available', 'sold', 'reserved', 'pending_verification', 'hidden'] as const;
export const CATEGORIES = ['car', 'motorcycle', 'truck', 'van', 'bus', 'machinery', 'other'] as const;

/** Validate an action; anything else (including 'hidden') is refused. */
export function normalizeBulkAction(v: unknown): BulkAction | null {
  const s = String(v || '').toLowerCase();
  return (BULK_ACTIONS as readonly string[]).includes(s) ? s as BulkAction : null;
}

/** Clean, de-duplicate and cap an explicit id list (a stale checkbox cannot smuggle junk). */
export function cleanIds(input: unknown, max = 5000) {
  const list = Array.isArray(input) ? input : [];
  const out: number[] = [];
  const seen = new Set<number>();
  for (const raw of list) {
    const n = Number(raw);
    if (!Number.isInteger(n) || n <= 0 || seen.has(n)) continue;
    seen.add(n); out.push(n);
    if (out.length >= max) break;
  }
  return out;
}

/**
 * Build the WHERE clause for "select all matching results". Only whitelisted fields become SQL; every
 * value is a bound parameter. Returns {where, args} and throws on an invalid status/category.
 */
export function buildBulkWhere(filters: BulkSelection['all_matching']): { where: string; args: any[] } {
  const w: string[] = ['1=1']; const a: any[] = [];
  const f: any = filters || {};
  const status = String(f.status || '').trim();
  if (status) { if (!(STATUSES as readonly string[]).includes(status)) throw new Error('Invalid status filter'); w.push('v.status=?'); a.push(status); }
  const category = String(f.category || '').trim();
  if (category) { if (!(CATEGORIES as readonly string[]).includes(category)) throw new Error('Invalid category filter'); w.push('v.category=?'); a.push(category); }
  if (f.brand) { w.push('v.brand=?'); a.push(String(f.brand).slice(0, 120)); }
  if (f.model) { w.push('v.model LIKE ?'); a.push(`%${String(f.model).slice(0, 120)}%`); }
  const year = Number(f.year);
  if (Number.isFinite(year) && year > 1900) { w.push('v.model_year=?'); a.push(year); }
  const minP = Number(f.minPrice), maxP = Number(f.maxPrice);
  if (Number.isFinite(minP)) { w.push('v.price_usd>=?'); a.push(minP); }
  if (Number.isFinite(maxP)) { w.push('v.price_usd<=?'); a.push(maxP); }
  const q = String(f.q || '').trim();
  if (q) {
    w.push('(v.stock_no LIKE ? OR v.brand LIKE ? OR v.model LIKE ? OR v.trim_name LIKE ?)');
    const like = `%${q}%`; a.push(like, like, like, like);
  }
  if (f.noPhotos) w.push(`(SELECT COUNT(*) FROM vehicle_media m WHERE m.vehicle_id=v.id AND m.media_type='image' AND m.review_status='approved')=0`);
  if (f.aiOn) w.push('v.ai_enabled=1');
  if (f.aiOff) w.push('v.ai_enabled=0');
  return { where: w.join(' AND '), args: a };
}

/**
 * Which ids a bulk request will touch. Explicit ids win; otherwise the filtered set is resolved by the
 * caller inside the same transaction (so a page refresh cannot change what was ticked).
 */
export function describeBulkRequest(input: BulkSelection) {
  const ids = cleanIds(input?.ids);
  if (ids.length) return { mode: 'ids' as const, ids };
  const { where, args } = buildBulkWhere(input?.all_matching || null);
  return { mode: 'matching' as const, where, args };
}
