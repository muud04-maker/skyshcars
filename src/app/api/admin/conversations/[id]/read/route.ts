/* Part 7: the admin has seen this thread (clears the unread dot). */
import { NextResponse } from 'next/server';
import { one } from '../../../../../../lib/db';
import { adminDenied } from '../../../../../../lib/admin-guard';
import { markRead } from '../../../../../../lib/conversation-state';

export async function POST(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const d = await adminDenied(); if (d) return d;
  const { id: raw } = await params; const id = Number(raw);
  const last = await one<any>('SELECT COALESCE(MAX(id),0) m FROM messages WHERE conversation_id=?', [id]).catch(() => null);
  await markRead(id, Number(last?.m || 0)).catch(() => {});
  return NextResponse.json({ ok: true, read_through: Number(last?.m || 0) });
}
