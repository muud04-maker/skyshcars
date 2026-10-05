/*
  Part 6 (admin): one-tap actions on the car this chat is about.
  "Sold" marks the current vehicle sold; "Not available" hides it. Both stop the AI offering it and
  leave a system note in the conversation.
*/
import { NextResponse } from 'next/server';
import { db } from '../../../../../../lib/db';
import { adminDenied } from '../../../../../../lib/admin-guard';
import { getState } from '../../../../../../lib/conversation-state';
import { agentEvent } from '../../../../../../lib/agent-events';

const ACTIONS: Record<string, { status: 'sold' | 'hidden'; note: string }> = {
  sold: { status: 'sold', note: 'Marked as sold by staff.' },
  not_available: { status: 'hidden', note: 'Marked not available by staff.' },
};

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const d = await adminDenied(); if (d) return d;
  const { id: raw } = await params; const id = Number(raw);
  const b = await req.json().catch(() => ({}));
  const action = ACTIONS[String(b.action || '')];
  if (!action) return NextResponse.json({ error: 'action must be "sold" or "not_available"' }, { status: 400 });
  const s = await getState(id).catch(() => null);
  const vehicleId = s?.current_vehicle_id ? Number(s.current_vehicle_id) : 0;
  if (!vehicleId) return NextResponse.json({ error: 'No current vehicle on this chat yet.' }, { status: 400 });
  try {
    await db().execute('UPDATE vehicles SET status=? WHERE id=?', [action.status, vehicleId]);
    await db().execute('INSERT INTO messages(conversation_id,sender,direction,message_type,body) VALUES(?,?,?,?,?)', [id, 'system', 'outbound', 'text', action.note]);
    await agentEvent(id, null, 'quick_action', 'ok', { action: String(b.action), vehicle_id: vehicleId, status: action.status });
    return NextResponse.json({ ok: true, vehicle_id: vehicleId, status: action.status });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'Could not update the vehicle' }, { status: 500 });
  }
}
