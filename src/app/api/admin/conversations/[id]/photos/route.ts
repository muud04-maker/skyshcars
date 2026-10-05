/*
  Part 7: staff send the EXACT approved photos of one vehicle into a WhatsApp chat.
  Refuses (and says so) when the vehicle has no exact photos, so we never send a wrong/representative image.
*/
import { NextResponse } from 'next/server';
import { one } from '../../../../../../lib/db';
import { adminDenied } from '../../../../../../lib/admin-guard';
import { sendPlannedPhotos } from '../../../../../../lib/whatsapp-photos';
import { whatsappPhotosForVehicle } from '../../../../../../lib/exact-photos';
import { agentEvent } from '../../../../../../lib/agent-events';

export const dynamic = 'force-dynamic';
const SITE = (process.env.NEXT_PUBLIC_SITE_URL || 'https://skyshcars.com').replace(/\/$/, '');

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const d = await adminDenied(); if (d) return d;
  const { id: raw } = await params; const id = Number(raw);
  const b = await req.json().catch(() => ({}));
  const vehicleId = Number(b.vehicle_id);
  if (!vehicleId) return NextResponse.json({ error: 'Pick a vehicle first.' }, { status: 400 });
  const c = await one<any>('SELECT id,channel,external_user_id FROM conversations WHERE id=? LIMIT 1', [id]);
  if (!c) return NextResponse.json({ error: 'Conversation not found' }, { status: 404 });
  if (c.channel !== 'whatsapp') return NextResponse.json({ error: 'Sending photos is available for WhatsApp chats.' }, { status: 400 });
  const v = await one<any>('SELECT id,stock_no,brand,model,trim_name,model_year,price_usd FROM vehicles WHERE id=? LIMIT 1', [vehicleId]);
  if (!v) return NextResponse.json({ error: 'Vehicle not found' }, { status: 404 });
  const images = (await whatsappPhotosForVehicle(vehicleId, 3).catch(() => [])).map(p => p.url);
  if (!images.length) return NextResponse.json({ error: 'This vehicle has no exact approved photos yet - nothing was sent.' }, { status: 400 });
  const title = [v.model_year, v.brand, v.model, v.trim_name].filter(Boolean).join(' ');
  const caption = `${title}${v.stock_no ? ` â€¢ ${v.stock_no}` : ''}${v.price_usd ? ` â€¢ $${Number(v.price_usd).toLocaleString()}` : ''}\nExact photos of this unit\n${SITE}/vehicles/${v.id}`;
  const res = await sendPlannedPhotos(String(c.external_user_id), id, { status: 'sending', vehicleId, stockNo: String(v.stock_no || ''), title, images, caption });
  await agentEvent(id, null, 'staff_photos', res.sent ? 'ok' : 'failed', { vehicle_id: vehicleId, sent: res.sent });
  return NextResponse.json({ ok: true, sent: res.sent });
}
