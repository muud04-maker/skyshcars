/*
  Owner/admin test action: make the first-contact welcome (website + WhatsApp group) eligible to
  send again on this customer's next AI reply. It only removes the welcome_log claim - it never
  touches messages, customers or vehicles.
*/
import { NextResponse } from 'next/server';
import { one } from '../../../../../../lib/db';
import { adminDenied } from '../../../../../../lib/admin-guard';
import { customerKey, releaseWelcome } from '../../../../../../lib/welcome';
import { agentEvent } from '../../../../../../lib/agent-events';

export async function POST(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const d = await adminDenied(); if (d) return d;
  const { id: raw } = await params; const id = Number(raw);
  if (!id) return NextResponse.json({ ok: false, code: 'BAD_ID', message: 'Invalid conversation id.' }, { status: 400 });
  const c: any = await one<any>('SELECT id,channel,external_user_id FROM conversations WHERE id=? LIMIT 1', [id]);
  if (!c?.id) return NextResponse.json({ ok: false, code: 'NOT_FOUND', message: 'Conversation not found.' }, { status: 404 });
  const key = customerKey(String(c.channel), String(c.external_user_id || ''));
  try {
    await releaseWelcome(key);
    await agentEvent(id, null, 'welcome_reset', 'ok', { key, by: 'admin' });
    return NextResponse.json({ ok: true, key });
  } catch (e: any) {
    return NextResponse.json({ ok: false, code: 'RESET_FAILED', message: 'Could not reset the welcome for this customer.' }, { status: 500 });
  }
}
