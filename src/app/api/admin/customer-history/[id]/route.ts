/*
  Admin-only: one customer's complete 360 view + unified timeline (Parts 4, 5, 6).
  POST handles the small edits the page needs (notes, memory, assigned staff) and always answers with
  the refreshed view so the UI never shows stale data.
*/
import { NextResponse } from 'next/server';
import { adminDenied } from '../../../../../lib/admin-guard';
import { getAdminSession } from '../../../../../lib/admin';
import { customer360, customerTimeline, setAssignedStaff } from '../../../../../lib/customer-context';
import { addNote, deleteNote, updateNote } from '../../../../../lib/staff-notes';
import { deleteFact, setFact } from '../../../../../lib/customer-facts';

export const dynamic = 'force-dynamic';

async function view(id: number, limit = 120) {
  const [detail, timeline] = await Promise.all([customer360(id), customerTimeline(id, { limit })]);
  return { detail, timeline: timeline.events };
}

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const d = await adminDenied(); if (d) return d;
  const { id } = await params;
  const limit = Number(new URL(req.url).searchParams.get('limit')) || 120;
  const data = await view(Number(id), limit).catch(() => null);
  if (!data?.detail) return NextResponse.json({ error: 'Customer not found' }, { status: 404 });
  return NextResponse.json(data);
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const d = await adminDenied(); if (d) return d;
  const { id } = await params;
  const customerId = Number(id);
  if (!customerId) return NextResponse.json({ error: 'Customer not found' }, { status: 404 });
  const session = await getAdminSession().catch(() => null);
  const by = session?.email || 'admin';
  const b = await req.json().catch(() => ({}));
  const action = String(b.action || '');
  try {
    if (action === 'add_note') await addNote(customerId, b.note, by);
    else if (action === 'update_note') await updateNote(customerId, Number(b.note_id), b.note, by);
    else if (action === 'delete_note') await deleteNote(customerId, Number(b.note_id));
    else if (action === 'set_fact') await setFact(customerId, String(b.fact_key || ''), String(b.fact_value || ''), by);
    else if (action === 'delete_fact') await deleteFact(customerId, String(b.fact_key || ''), by);
    else if (action === 'assign_staff') await setAssignedStaff(customerId, b.staff == null ? null : String(b.staff));
    else return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
    const data = await view(customerId);
    return NextResponse.json({ ok: true, ...data });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'Could not save' }, { status: 400 });
  }
}
