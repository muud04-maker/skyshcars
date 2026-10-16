/*
  Admin-only review of ONE learning lesson (Parts 9, 20):
    approve -> the lesson becomes usable context (and can be applied),
    reject  -> it is ignored forever,
    reopen  -> put a rejected lesson back in the queue,
    apply   -> turn an approved lesson into its permanent form (referral mapping / knowledge /
               prompt context) - this is the only step that changes deterministic behaviour.
*/
import { NextResponse } from 'next/server';
import { adminDenied } from '../../../../../lib/admin-guard';
import { getAdminSession } from '../../../../../lib/admin';
import { applyLearningEvent, learningEventById, reviewLearningEvent } from '../../../../../lib/ai-learning';

export const dynamic = 'force-dynamic';

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const d = await adminDenied(); if (d) return d;
  const { id } = await params;
  const event = await learningEventById(Number(id)).catch(() => null);
  if (!event) return NextResponse.json({ error: 'Lesson not found' }, { status: 404 });
  return NextResponse.json({ event });
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const d = await adminDenied(); if (d) return d;
  const { id } = await params;
  const session = await getAdminSession().catch(() => null);
  const by = session?.email || 'admin';
  const b = await req.json().catch(() => ({}));
  const action = String(b.action || '');
  try {
    const out = action === 'apply'
      ? await applyLearningEvent(Number(id), by)
      : await reviewLearningEvent(Number(id), action as any, { lesson: b.lesson ?? null, appliesTo: b.applies_to, by });
    const event = await learningEventById(Number(id));
    return NextResponse.json({ ok: true, ...out, event });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'Could not review the lesson' }, { status: 400 });
  }
}
