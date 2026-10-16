/*
  Admin-only: one page of the all-customer history stream (GOAL 1). Read-only.
  ?diagnostics=1 returns per-source counts so the admin can reconcile the page with the database.
  A database error is returned as an error (HTTP 500) - never as an empty history.
*/
import { NextResponse } from 'next/server';
import { adminDenied } from '../../../../lib/admin-guard';
import { historyCount, historyDiagnostics, historyPage, type HistoryFilters } from '../../../../lib/all-history';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const d = await adminDenied(); if (d) return d;
  const url = new URL(req.url);
  if (url.searchParams.get('diagnostics') === '1') {
    const diag = await historyDiagnostics().catch((e) => ({ error: String(e?.message || e) }));
    return NextResponse.json({ ok: !('error' in diag), ...diag });
  }
  const filters: HistoryFilters = {
    from: url.searchParams.get('from') || '', to: url.searchParams.get('to') || '',
    channel: url.searchParams.get('channel') || '', role: url.searchParams.get('role') || '',
    kind: url.searchParams.get('kind') || '', q: url.searchParams.get('q') || '',
    stock: url.searchParams.get('stock') || '', category: url.searchParams.get('category') || '',
    customerId: Number(url.searchParams.get('customer')) || 0,
    facebookOnly: url.searchParams.get('facebook') === '1',
  };
  const order = url.searchParams.get('order') === 'asc' ? 'asc' : 'desc';
  const cursorTs = url.searchParams.get('cursor_ts');
  const cursorId = url.searchParams.get('cursor_id');
  const countResult = cursorTs ? { count: 0, error: null } : await historyCount(filters);
  const [page, count] = await Promise.all([
    historyPage(filters, { limit: Number(url.searchParams.get('limit')) || 100, order, cursor: cursorTs && cursorId ? { ts: cursorTs, id: cursorId } : null })
      .catch((e) => ({ rows: [], nextCursor: null, exhausted: true, error: String(e?.message || e), sources: [] })),
    Promise.resolve(countResult),
  ]);
  const error = page.error || count.error || null;
  if (error) {
    return NextResponse.json({
      error: `Could not read the history from the database: ${error}`,
      hint: 'The page is working; the query failed. Run the diagnostics (Data check) to see which source tables exist.',
      sources: (page as any).sources || [],
    }, { status: 500 });
  }
  return NextResponse.json({ ...page, count: count.count || undefined, order, filters });
}
