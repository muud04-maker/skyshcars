/* Admin-only: read and version the Sky Cars business policy (shipping guidance, payment, team style). */
import { NextResponse } from 'next/server';
import { adminDenied } from '../../../../lib/admin-guard';
import { getAdminSession } from '../../../../lib/admin';
import { DEFAULT_POLICY, getBusinessPolicy, saveBusinessPolicy } from '../../../../lib/business-policy';

export const dynamic = 'force-dynamic';

export async function GET() {
  const d = await adminDenied(); if (d) return d;
  return NextResponse.json({ policy: await getBusinessPolicy(), defaults: DEFAULT_POLICY });
}

export async function PUT(req: Request) {
  const d = await adminDenied(); if (d) return d;
  const session = await getAdminSession().catch(() => null);
  const b = await req.json().catch(() => ({}));
  try {
    const policy = await saveBusinessPolicy(b, session?.email || 'admin');
    return NextResponse.json({ ok: true, policy });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'Could not save the policy' }, { status: 400 });
  }
}
