/* Admin-only staff workflow: photos, freight quotes, sourcing, serious buyers, follow-ups. */
import { NextResponse } from 'next/server';
import { adminDenied } from '../../../../lib/admin-guard';
import { getAdminSession } from '../../../../lib/admin';
import { listTasks, taskStats, updateTask } from '../../../../lib/staff-tasks';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const d = await adminDenied(); if (d) return d;
  const q = new URL(req.url).searchParams;
  const [tasks, stats] = await Promise.all([
    listTasks({ status: q.get('status') || 'pending', type: q.get('type') || '', limit: Number(q.get('limit')) || 100 }),
    taskStats(),
  ]);
  return NextResponse.json({ tasks, stats });
}

export async function PATCH(req: Request) {
  const d = await adminDenied(); if (d) return d;
  const session = await getAdminSession().catch(() => null);
  const b = await req.json().catch(() => ({}));
  try {
    const out = await updateTask(Number(b.id), String(b.action || ''), { by: session?.email || 'admin', notes: b.notes ?? null });
    return NextResponse.json({ ok: true, ...out, stats: await taskStats() });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'Could not update the task' }, { status: 400 });
  }
}
