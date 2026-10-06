/* Staff can cancel a queued AI reply for one chat (staff always wins over a pending AI answer). */
import { NextResponse } from 'next/server';
import { adminDenied } from '../../../../../../lib/admin-guard';
import { clearAiReply } from '../../../../../../lib/conversation-state';
import { agentEvent } from '../../../../../../lib/agent-events';

export async function POST(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const d = await adminDenied(); if (d) return d;
  const { id: raw } = await params; const id = Number(raw);
  if (!id) return NextResponse.json({ ok: false, code: 'BAD_ID', message: 'Invalid conversation id.' }, { status: 400 });
  await clearAiReply(id);
  await agentEvent(id, null, 'ai_reply_cancelled', 'ok', { by: 'admin' }).catch(() => {});
  return NextResponse.json({ ok: true });
}
