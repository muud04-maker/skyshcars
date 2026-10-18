/*
  Bulk availability (brief section 5). Admin-only, transaction, parameterised, and it only ever touches
  the explicitly selected ids OR the resolved filtered set - never "everything".
  Returns updated / skipped / failed counts and keeps Sold and Hidden separate.
*/
import { NextResponse } from 'next/server';
import { adminDenied } from '../../../../../lib/admin-guard';
import { getAdminSession } from '../../../../../lib/admin';
import { db, one, rows } from '../../../../../lib/db';
import { describeBulkRequest, normalizeBulkAction } from '../../../../../lib/bulk-vehicles';

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  const d = await adminDenied(); if (d) return d;
  const session = await getAdminSession().catch(() => null);
  const b = await req.json().catch(() => ({}));
  const action = normalizeBulkAction(b.action);
  if (!action) return NextResponse.json({ error: 'Action must be "available" or "sold". Hidden is a separate state and cannot be set here.' }, { status: 400 });

  let selection;
  try { selection = describeBulkRequest({ ids: b.ids, all_matching: b.all_matching }); }
  catch (e: any) { return NextResponse.json({ error: e?.message || 'Invalid filters' }, { status: 400 }); }
  if (selection.mode === 'ids' && !selection.ids.length) return NextResponse.json({ error: 'No vehicles selected' }, { status: 400 });

  const conn: any = await db().getConnection();
  try {
    await conn.beginTransaction();
    let ids: number[];
    if (selection.mode === 'ids') {
      // Re-read inside the transaction: only real ids are touched, and the current status is recorded.
      const found = await conn.query(`SELECT id,status FROM vehicles WHERE id IN (${selection.ids.map(() => '?').join(',')})`, selection.ids);
      ids = (found[0] as any[]).map((r) => Number(r.id));
    } else {
      const found = await conn.query(`SELECT v.id FROM vehicles v WHERE ${selection.where} LIMIT 5000`, selection.args);
      ids = (found[0] as any[]).map((r) => Number(r.id));
    }
    if (!ids.length) { await conn.rollback(); return NextResponse.json({ ok: true, updated: 0, skipped: 0, failed: 0, note: 'Nothing matched that selection.' }); }

    // No-op rows are "skipped" (already in the target status) so the counts are honest.
    const [res]: any = await conn.query(`UPDATE vehicles SET status=?, updated_at=NOW() WHERE id IN (${ids.map(() => '?').join(',')}) AND status<>?`, [action, ...ids, action]);
    const updated = Number(res?.affectedRows || 0);
    const skipped = ids.length - updated;
    await conn.commit();

    const actor = session?.email || 'admin';
    try { await db().execute('INSERT INTO audit_logs(actor,action,entity_type,entity_id,details) VALUES(?,?,?,?,?)', [actor, 'vehicles.bulk_status', 'vehicles', String(ids.length), JSON.stringify({ action, updated, skipped, ids: ids.slice(0, 200) }).slice(0, 8000)]); } catch { /* audit must not fail the update */ }
    return NextResponse.json({ ok: true, action, updated, skipped, failed: 0, selected: ids.length, note: action === 'sold' ? 'Sold vehicles are excluded from all available/AI/public stock queries.' : 'Vehicles marked available again.' });
  } catch (e: any) {
    await conn.rollback().catch(() => {});
    console.error('BULK_VEHICLE_STATUS', e?.code || e?.message);
    return NextResponse.json({ error: 'Could not update the selected vehicles. Nothing was changed.', failed: true }, { status: 500 });
  } finally {
    conn.release();
  }
}

/** Inventory summary for the dashboard (brief section 6). Read-only, one query. */
export async function GET() {
  const d = await adminDenied(); if (d) return d;
  const r = await one<any>(`SELECT
      COUNT(*) total,
      SUM(status='available') available_vehicles,
      SUM(status='sold') sold,
      SUM(status='reserved') reserved,
      SUM(status='pending_verification') pending,
      SUM(status='hidden') hidden,
      SUM(category='car') cars,
      SUM(category='motorcycle') motorcycles,
      SUM(ai_enabled=1) ai_catalog,
      SUM(status='available' AND ai_enabled=1) available_in_ai,
      SUM((SELECT COUNT(*) FROM vehicle_media m WHERE m.vehicle_id=vehicles.id AND m.media_type='image' AND m.review_status='approved')=0) without_photos
    FROM vehicles`).catch(() => null);
  const recent = await rows<any>(`SELECT id,stock_no,brand,model,status,updated_at FROM vehicles ORDER BY updated_at DESC LIMIT 8`).catch(() => []);
  return NextResponse.json({ summary: r || {}, recent_status_changes: recent });
}
