/* Part 7: staff correction of the car this chat is about. */
import { NextResponse } from 'next/server';
import { one } from '../../../../../../lib/db';
import { adminDenied } from '../../../../../../lib/admin-guard';
import { setCurrentCar } from '../../../../../../lib/conversation-state';
import { agentEvent } from '../../../../../../lib/agent-events';

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const d = await adminDenied(); if (d) return d;
  const { id: raw } = await params; const id = Number(raw);
  const b = await req.json().catch(() => ({}));
  const vehicleId = Number(b.vehicle_id);
  if (!vehicleId) return NextResponse.json({ error: 'vehicle_id is required' }, { status: 400 });
  const v = await one<any>('SELECT id,stock_no FROM vehicles WHERE id=? LIMIT 1', [vehicleId]);
  if (!v) return NextResponse.json({ error: 'Vehicle not found' }, { status: 404 });
  try {
    await setCurrentCar(id, vehicleId, 'staff');
    await agentEvent(id, null, 'current_car_set', 'ok', { vehicle_id: vehicleId, source: 'staff' });
    return NextResponse.json({ ok: true, vehicle_id: vehicleId, stock_no: v.stock_no });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'Could not set the current car' }, { status: 500 });
  }
}
