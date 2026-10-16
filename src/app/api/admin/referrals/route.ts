/*
  Part 3 (admin): see the Facebook ad/post referrals for a conversation and, when the AI could not
  match one, tell the system which stock vehicle that post really is. Saved corrections win over
  every automatic resolution from then on.
*/
import { NextResponse } from 'next/server';
import { adminDenied } from '../../../../lib/admin-guard';
import { recentReferrals, setReferralCorrection } from '../../../../lib/referrals';
import { setCurrentCar } from '../../../../lib/conversation-state';
import { one } from '../../../../lib/db';
import { getAdminSession } from '../../../../lib/admin';
import { recordLearningEvent } from '../../../../lib/ai-learning';

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
    const saved = await setReferralCorrection({ channel: b.channel, source_id: b.source_id, source_url: b.source_url, vehicle_id: vehicleId });
    /*
      A correction must take effect immediately, not only on the next referral: point this chat at
      the corrected vehicle (and let the stored referral rows carry match_method='correction').
      Only an Available unit becomes the chat's current vehicle - a sold one would make the next
      follow-up ("price?") unanswerable.
    */
    const conversationId = Number(b.conversation_id);
    const v = conversationId ? await one<any>('SELECT status FROM vehicles WHERE id=? LIMIT 1', [vehicleId]).catch(() => null) : null;
    if (conversationId && String(v?.status || '') === 'available') await setCurrentCar(conversationId, vehicleId, 'correction').catch(() => {});
    /*
      Part 9: a human correction is the best training signal we have, so it becomes a PENDING learning
      event (never an automatic behaviour change). Applying it later turns it into a deterministic
      referral mapping; until then it is only a reviewable candidate.
    */
    try {
      const session = await getAdminSession().catch(() => null);
      const [corrected, previous, referral] = await Promise.all([
        one<any>('SELECT id,stock_no,brand,model,model_year FROM vehicles WHERE id=? LIMIT 1', [vehicleId]),
        one<any>(`SELECT r.matched_vehicle_id, v.stock_no, v.brand, v.model, v.model_year
          FROM chat_referrals r LEFT JOIN vehicles v ON v.id=r.matched_vehicle_id
          WHERE ${b.source_id ? 'r.source_id=?' : 'r.source_url=?'} ORDER BY r.id DESC LIMIT 1`, [String(b.source_id || b.source_url)]).catch(() => null),
        one<any>(`SELECT id,conversation_id,headline,body,matched_vehicle_id FROM chat_referrals WHERE ${b.source_id ? 'source_id=?' : 'source_url=?'} ORDER BY id DESC LIMIT 1`, [String(b.source_id || b.source_url)]).catch(() => null),
      ]);
      const name = (r: any) => (r ? [r.model_year, r.brand, r.model].filter(Boolean).join(' ') || r.stock_no : null);
      if (corrected) {
        await recordLearningEvent({
          conversationId: conversationId || (referral?.conversation_id ? Number(referral.conversation_id) : null),
          eventType: 'referral_correction',
          question: referral?.headline || referral?.body || null,
          aiReply: name(previous) || (referral?.matched_vehicle_id ? `vehicle #${referral.matched_vehicle_id}` : null),
          correction: `${name(corrected)} (stock ${corrected.stock_no})`,
          reason: 'staff corrected a referral mapping',
          lesson: `A Facebook referral for "${String(referral?.headline || referral?.body || '').slice(0, 120)}" must resolve to ${name(corrected)} (stock ${corrected.stock_no}), never ${name(previous) || 'another vehicle'}.`,
          payload: { vehicle_id: Number(vehicleId), source_id: b.source_id || null, source_url: b.source_url || null, channel: b.channel || 'facebook' },
          createdBy: session?.email || 'admin',
        });
      }
    } catch (e) { console.error('LEARNING_FROM_CORRECTION', e); }
    return NextResponse.json({ ok: true, ...saved, conversation_id: conversationId || null });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'Could not save the referral match' }, { status: 400 });
  }
}
