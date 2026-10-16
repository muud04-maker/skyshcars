/* Admin-only: one page of the all-customer history stream (GOAL 1). Read-only. */
import { NextResponse } from 'next/server';
import { adminDenied } from '../../../../lib/admin-guard';
import { historyCount, historyPage, type HistoryFilters } from '../../../../lib/all-history';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const d = await adminDenied(); if (d) return d;
  const url = new URL(req.url);
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
  const [page, count] = await Promise.all([
    historyPage(filters, { limit: Number(url.searchParams.get('limit')) || 100, order, cursor: cursorTs && cursorId ? { ts: cursorTs, id: cursorId } : null }).catch(() => ({ rows: [], nextCursor: null, exhausted: true })),
    cursorTs ? Promise.resolve(0) : historyCount(filters).catch(() => 0),
  ]);
  return NextResponse.json({ ...page, count: count || undefined, order, filters });
}
