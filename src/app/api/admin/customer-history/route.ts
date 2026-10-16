/*
  Admin-only: the searchable customer list behind /admin/customer-history (Parts 5, 16).
  Nothing here is ever exposed publicly, and one customer's data is never mixed with another's.
*/
import { NextResponse } from 'next/server';
import { adminDenied } from '../../../../lib/admin-guard';
import { customerList } from '../../../../lib/customer-context';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const d = await adminDenied(); if (d) return d;
  const q = new URL(req.url).searchParams;
  try {
    const data = await customerList({
      q: q.get('q') || '',
      channel: q.get('channel') || '',
      category: q.get('category') || '',
      needsReply: q.get('needs_reply') === '1',
      handled: (q.get('handled') === 'ai' || q.get('handled') === 'staff') ? q.get('handled') as 'ai' | 'staff' : '',
      from: q.get('from') || '', to: q.get('to') || '',
      page: Number(q.get('page')) || 1,
      limit: Number(q.get('limit')) || 30,
    });
    return NextResponse.json(data);
  } catch (e: any) {
    return NextResponse.json({ error: 'Could not load customers' }, { status: 500 });
  }
}
