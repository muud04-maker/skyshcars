/*
  Admin pre-check so both vehicle forms can warn about a duplicate stock number BEFORE saving.
  The create endpoint remains the final authority (it also returns DUPLICATE_STOCK on a race).
*/
import { NextResponse } from 'next/server';
import { one } from '../../../../../lib/db';
import { adminDenied } from '../../../../../lib/admin-guard';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const d = await adminDenied(); if (d) return d;
  const stock = String(new URL(req.url).searchParams.get('stock_no') || '').trim();
  if (!stock) return NextResponse.json({ ok: false, code: 'STOCK_REQUIRED', message: 'Stock number is required.' }, { status: 400 });
  const v: any = await one<any>('SELECT id,stock_no,brand,model,model_year,status FROM vehicles WHERE stock_no=? LIMIT 1', [stock]).catch(() => null);
  return NextResponse.json({
    ok: true, exists: !!v,
    vehicle: v ? { id: Number(v.id), stock_no: String(v.stock_no), title: [v.model_year, v.brand, v.model].filter(Boolean).join(' '), status: String(v.status || '') } : null,
  });
}
