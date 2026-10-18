/*
  Admin-only release check: are all critical tables + columns really present?
  A failed migration must be a visible error, never a silently half-working app.
*/
import { NextResponse } from 'next/server';
import { adminDenied } from '../../../../lib/admin-guard';
import { verifyCriticalSchemas } from '../../../../lib/schema-health';

export const dynamic = 'force-dynamic';

export async function GET() {
  const d = await adminDenied(); if (d) return d;
  const result = await verifyCriticalSchemas().catch((e) => ({ ok: false, checked_at: new Date().toISOString(), checks: [], error: String(e?.message || e) }));
  return NextResponse.json(result, { status: result.ok ? 200 : 503 });
}
