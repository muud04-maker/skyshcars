/*
  Part 3 (admin): see the Facebook ad/post referrals for a conversation and, when the AI could not
  match one, tell the system which stock vehicle that post really is. Saved corrections win over
  every automatic resolution from then on.
*/
import { NextResponse } from 'next/server';
import { adminDenied } from '../../../../lib/admin-guard';
import { recentReferrals, setReferralCorrection } from '../../../../lib/referrals';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const d = await adminDenied(); if (d) return d;
  const id = Number(new URL(req.url).searchParams.get('conversation'));
  if (!id) return NextResponse.json({ referrals: [] });
  return NextResponse.json({ referrals: await recentReferrals(id, 20).catch(() => []) });
}

export async function POST(req: Request) {
  const d = await adminDenied(); if (d) return d;
  const b = await req.json().catch(() => ({}));
  const vehicleId = Number(b.vehicle_id);
  if (!vehicleId) return NextResponse.json({ error: 'vehicle_id is required' }, { status: 400 });
  try {
    return NextResponse.json({ ok: true, ...(await setReferralCorrection({ channel: b.channel, source_id: b.source_id, source_url: b.source_url, vehicle_id: vehicleId })) });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'Could not save the referral match' }, { status: 400 });
  }
}
