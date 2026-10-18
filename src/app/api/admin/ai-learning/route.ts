/*
  Admin-only AI learning (Parts 7-11, 20).

  GET  -> the learning queue (pending first) + counters.
  POST -> create a learning candidate from staff feedback:
            thumbs_up   : a good reply worth reusing (recorded as an approved example),
            thumbs_down : the AI answer was wrong/incomplete -> PENDING lesson,
            correction  : "use this as the correct answer" for a specific AI reply -> PENDING.

  Nothing here changes AI behaviour on its own: only an approved/applied lesson is ever used, and the
  owner applies it explicitly.
*/
import { NextResponse } from 'next/server';
import { adminDenied } from '../../../../lib/admin-guard';
import { getAdminSession } from '../../../../lib/admin';
import { LEARNING_TYPES, detectContradictions, learningStats, listLearningEvents, recordLearningEvent, typeFromReason, type LearningType } from '../../../../lib/ai-learning';
import { one } from '../../../../lib/db';
import { todayPatterns } from '../../../../lib/sales-patterns';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const d = await adminDenied(); if (d) return d;
  const q = new URL(req.url).searchParams;
  const [events, stats, patterns] = await Promise.all([
    listLearningEvents({
      status: q.get('status') || '', type: q.get('type') || '', q: q.get('q') || '',
      customerId: Number(q.get('customer')) || 0, limit: Number(q.get('limit')) || 60,
    }).catch(() => []),
    learningStats().catch(() => ({ pending: 0, approved: 0, applied: 0, rejected: 0, total: 0 })),
    // GOAL 3: the day's real human sales patterns (suggestions only, never automatic rules).
    q.get('patterns') === '1' ? todayPatterns(q.get('day') || undefined).catch(() => null) : Promise.resolve(null),
  ]);
  // Brief item 33: warn the admin when two approved lessons say different things in similar situations.
  const contradictions = detectContradictions(events.filter((e: any) => ['approved', 'applied'].includes(String(e.status)))
    .map((e: any) => ({ id: e.id, event_type: e.event_type, lesson: e.lesson, question: e.question })));
  return NextResponse.json({ events, stats, patterns, contradictions });
}

export async function POST(req: Request) {
  const d = await adminDenied(); if (d) return d;
  const session = await getAdminSession().catch(() => null);
  const by = session?.email || 'admin';
  const b = await req.json().catch(() => ({}));
  const action = String(b.action || 'create');
  const conversationId = Number(b.conversation_id) || null;
  const messageId = Number(b.message_id) || null;
  try {
    // Resolve the customer (for isolation + the 360 page) from the conversation, never from the body.
    let customerId: number | null = null;
    if (conversationId) {
      const c: any = await one<any>('SELECT customer_id FROM conversations WHERE id=? LIMIT 1', [conversationId]).catch(() => null);
      customerId = c?.customer_id ? Number(c.customer_id) : null;
    }
    const question = b.question == null ? null : String(b.question).slice(0, 4000);
    const aiReply = b.ai_reply == null ? null : String(b.ai_reply).slice(0, 4000);
    const correction = b.correction == null ? null : String(b.correction).slice(0, 4000);

    if (action === 'thumbs_up') {
      const out = await recordLearningEvent({
        conversationId, customerId, messageId, question, aiReply,
        eventType: 'good_reply', reason: 'staff marked this reply as good',
        lesson: b.lesson ? String(b.lesson) : null,
        appliesTo: b.applies_to === 'customer' ? 'customer' : 'global',
        status: 'approved', createdBy: by,
      });
      return NextResponse.json({ ok: true, ...out, message: 'Saved as a good reply example.' });
    }

    if (action === 'thumbs_down') {
      const reason = String(b.reason || 'other').slice(0, 191);
      const out = await recordLearningEvent({
        conversationId, customerId, messageId, question, aiReply, correction,
        eventType: String(b.event_type || typeFromReason(reason)),
        reason, lesson: b.lesson ? String(b.lesson) : null,
        appliesTo: b.applies_to === 'customer' ? 'customer' : 'global',
        status: 'pending', createdBy: by,
      });
      return NextResponse.json({ ok: true, ...out, message: 'Thanks - the lesson is waiting for approval.' });
    }

    if (action === 'correction') {
      if (!correction) return NextResponse.json({ error: 'The corrected answer is required' }, { status: 400 });
      const out = await recordLearningEvent({
        conversationId, customerId, messageId, question, aiReply, correction,
        eventType: String(b.event_type || 'better_sales_reply'),
        reason: String(b.reason || 'staff wrote the correct answer').slice(0, 191),
        lesson: b.lesson ? String(b.lesson) : null,
        appliesTo: b.applies_to === 'customer' ? 'customer' : 'global',
        status: 'pending', createdBy: by,
      });
      return NextResponse.json({ ok: true, ...out, message: 'Correction saved for approval.' });
    }

    // Generic create (used by the referral-correction flow and by the learning page itself).
    const eventType = (LEARNING_TYPES.includes(String(b.event_type) as LearningType) ? String(b.event_type) : 'other') as LearningType;
    const out = await recordLearningEvent({
      conversationId, customerId, messageId, question, aiReply, correction,
      eventType, reason: b.reason ? String(b.reason) : null,
      lesson: b.lesson ? String(b.lesson) : null,
      appliesTo: b.applies_to === 'customer' ? 'customer' : 'global',
      payload: b.payload || null, status: 'pending', createdBy: by,
    });
    return NextResponse.json({ ok: true, ...out });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'Could not save the learning event' }, { status: 400 });
  }
}
