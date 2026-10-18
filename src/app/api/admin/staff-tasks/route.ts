/* Admin-only staff workflow: photos, freight quotes, sourcing, serious buyers, follow-ups. */
import { NextResponse } from 'next/server';
import { adminDenied } from '../../../../lib/admin-guard';
import { getAdminSession } from '../../../../lib/admin';
import { listTasks, taskStats, updateTask } from '../../../../lib/staff-tasks';
import { verifyCriticalSchemas } from '../../../../lib/schema-health';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const d = await adminDenied(); if (d) return d;
  const q = new URL(req.url).searchParams;
  /*
    A failed migration must be visible: if staff_tasks is not really usable, answer 503 with the
    reason instead of rendering an empty queue that looks like "no work".
  */
  const health = await verifyCriticalSchemas().catch(() => null);
  const own = health?.checks.find((c) => c.table === 'staff_tasks');
  if (health && !own?.ok) {
    return NextResponse.json({
      error: 'The staff task table is not ready on this server.',
      table: own?.table || 'staff_tasks', missing_columns: own?.missing_columns || [], detail: own?.error || 'schema check failed',
      hint: 'Open /admin/staff-tasks and use "Database check", or run GET /api/admin/schema-health.',
    }, { status: 503 });
  }
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
