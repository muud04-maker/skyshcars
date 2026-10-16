/* Part 7: staff correction of the car this chat is about. */
import { NextResponse } from 'next/server';
import { one } from '../../../../../../lib/db';
import { adminDenied } from '../../../../../../lib/admin-guard';
import { setCurrentCar } from '../../../../../../lib/conversation-state';
import { agentEvent } from '../../../../../../lib/agent-events';
import { getAdminSession } from '../../../../../../lib/admin';
import { recordHumanVehicleChange } from '../../../../../../lib/shadow-learning';
import { one as oneRow } from '../../../../../../lib/db';

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const d = await adminDenied(); if (d) return d;
  const { id: raw } = await params; const id = Number(raw);
  const b = await req.json().catch(() => ({}));
  const vehicleId = Number(b.vehicle_id);
  // Clearing the current car is allowed (staff correction), as is pointing it at a real vehicle.
  if (!vehicleId || b.clear) {
    try { await setCurrentCar(id, null, 'staff'); return NextResponse.json({ ok: true, vehicle_id: null }); }
    catch (e: any) { return NextResponse.json({ error: e?.message || 'Could not clear the current car' }, { status: 500 }); }
  }
  const v = await one<any>('SELECT id,stock_no FROM vehicles WHERE id=? LIMIT 1', [vehicleId]);
  if (!v) return NextResponse.json({ error: 'Vehicle not found' }, { status: 404 });
  try {
    // GOAL 4: remember what the AI had, so a human switch is recorded as a learning signal.
    const before = await oneRow<any>('SELECT current_vehicle_id FROM conversation_state WHERE conversation_id=? LIMIT 1', [id]).catch(() => null);
    await setCurrentCar(id, vehicleId, 'staff');
    await agentEvent(id, null, 'current_car_set', 'ok', { vehicle_id: vehicleId, source: 'staff' });
    const session = await getAdminSession().catch(() => null);
    await recordHumanVehicleChange({ conversationId: id, previousVehicleId: before?.current_vehicle_id ? Number(before.current_vehicle_id) : null, vehicleId, by: session?.email || 'staff' }).catch(() => {});
    return NextResponse.json({ ok: true, vehicle_id: vehicleId, stock_no: v.stock_no });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'Could not set the current car' }, { status: 500 });
  }
}
