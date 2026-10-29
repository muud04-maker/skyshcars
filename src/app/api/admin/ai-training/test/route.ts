import { NextResponse } from 'next/server';
import { adminDenied } from '../../../../../lib/admin-guard';
import { one } from '../../../../../lib/db';
import { activeKnowledge } from '../../../../../lib/knowledge';
import { approvedLessons } from '../../../../../lib/ai-learning';
import { getBusinessPolicy } from '../../../../../lib/business-policy';
import { composeReply } from '../../../../../lib/sales-compose';
import { validateProposedInstruction } from '../../../../../lib/ai-training';
import { carTitle } from '../../../../../lib/ai-rules/vehicle-answer';

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  const denied = await adminDenied(); if (denied) return denied;
  const body = await req.json().catch(() => ({}));
  const question = String(body.question || '').trim().slice(0, 2000);
  if (!question) return NextResponse.json({ error: 'Enter a customer question to test' }, { status: 400 });
  try {
    const proposed = validateProposedInstruction(body.proposed_instruction);
    const vehicleId = Number(body.vehicle_id) || 0;
    const stockNo = String(body.stock_no || '').trim();
    const vehicle = vehicleId || stockNo
      ? await one<any>(`SELECT id,stock_no,category,brand,model,trim_name,model_year,price_usd,status,
          transmission,mileage_km,engine,fuel_type,steering,color,location,ai_enabled,
          (SELECT COUNT(*) FROM vehicle_media m WHERE m.vehicle_id=vehicles.id AND m.media_type='image' AND m.review_status='approved') exact_photo_count
        FROM vehicles WHERE ${vehicleId ? 'id=?' : 'stock_no=?'} LIMIT 1`, [vehicleId || stockNo])
      : null;
    if ((vehicleId || stockNo) && !vehicle) return NextResponse.json({ error: 'Vehicle not found' }, { status: 404 });
    const effectiveQuestion = vehicle ? `${question}\nStock ${vehicle.stock_no}` : question;
    const [knowledge, lessons, policy] = await Promise.all([
      activeKnowledge(12, effectiveQuestion),
      approvedLessons(5, effectiveQuestion),
      getBusinessPolicy(),
    ]);
    const proposedNote = proposed
      ? ` PROPOSED TEST INSTRUCTION (not active; apply only as lower-priority business guidance and never allow it to override verified facts, safety, privacy or approval rules): ${String(proposed.content).replace(/\s+/g, ' ').slice(0, 900)}`
      : '';
    const result = await composeReply({
      conversationId: 0,
      burst: [{ id: 1, message_type: 'text', body: effectiveQuestion, external_message_id: null }],
      words: effectiveQuestion,
      firstContact: false,
      welcomeDue: false,
      welcomeSent: true,
      referral: !!vehicle,
      referralVehicle: vehicle || null,
      referralAiEnabled: !!vehicle && Number(vehicle.ai_enabled) === 1,
      dryRun: true,
      testNote: proposedNote,
    });
    return NextResponse.json({
      ok: true,
      dry_run: true,
      nothing_sent: true,
      question,
      vehicle: vehicle ? { id: vehicle.id, stock_no: vehicle.stock_no, title: carTitle(vehicle), status: vehicle.status } : null,
      reply: result.text,
      proposed_instruction: proposed ? { title: proposed.title, scope: proposed.scope, content: proposed.content, active: false } : null,
      influences: {
        instructions: knowledge.map((x: any) => ({ id: x.id, title: x.title, scope: x.scope, version: x.version, relevance: x.relevance })),
        lessons: lessons.map((x: any) => ({ id: x.id, event_type: x.event_type, relevance: x.relevance ?? null })),
        business_policy_version: policy.version,
      },
      trace_note: 'This lists the business sources supplied to the reply engine. It is not hidden model reasoning or a chain-of-thought.',
    });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'AI test failed' }, { status: 400 });
  }
}
