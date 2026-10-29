import { NextResponse } from 'next/server';
import { adminDenied } from '../../../../lib/admin-guard';
import { getAdminSession } from '../../../../lib/admin';
import { rows } from '../../../../lib/db';
import { listInstructions, listInstructionHistory, createInstruction } from '../../../../lib/knowledge';
import { listLearningEvents } from '../../../../lib/ai-learning';
import { getBusinessPolicy } from '../../../../lib/business-policy';
import {
  createTrainingCorrection, executeTrainingCommand, mutateTrainingInstruction,
  reviewTrainingCorrection,
} from '../../../../lib/ai-training';

export const dynamic = 'force-dynamic';

async function actorAndRole() {
  const session = await getAdminSession().catch(() => null);
  return { actor: String(session?.email || 'admin'), role: String(session?.role || '') };
}

function ownerOnly(role: string) {
  return role === 'owner'
    ? null
    : NextResponse.json({ error: 'Only the owner can change AI-training instructions and commands' }, { status: 403 });
}

export async function GET() {
  const denied = await adminDenied(); if (denied) return denied;
  const { role } = await actorAndRole();
  const [instructions, history, corrections, policy] = await Promise.all([
    listInstructions(300).catch(() => []),
    listInstructionHistory().catch(() => []),
    listLearningEvents({ status: '', limit: 200 }).catch(() => []),
    getBusinessPolicy().catch(() => null),
  ]);
  const conversations = await rows<any>(`SELECT c.id,c.channel,c.last_message_at,cu.full_name,cu.phone
    FROM conversations c LEFT JOIN customers cu ON cu.id=c.customer_id
    ORDER BY c.last_message_at DESC LIMIT 100`).catch(() => []);
  const vehicles = await rows<any>(`SELECT id,stock_no,brand,model,model_year,status,ai_enabled
    FROM vehicles WHERE status<>'hidden' ORDER BY updated_at DESC LIMIT 300`).catch(() => []);
  const audit = await rows<any>(`SELECT id,actor,action,entity_type,entity_id,details,created_at
    FROM audit_logs WHERE action LIKE 'ai_training.%' OR action LIKE 'ai_instruction.%'
    ORDER BY id DESC LIMIT 250`).catch(() => []);
  return NextResponse.json({ ok: true, role, instructions, history, corrections, policy, conversations, vehicles, audit });
}

export async function POST(req: Request) {
  const denied = await adminDenied(); if (denied) return denied;
  const { actor, role } = await actorAndRole();
  const body = await req.json().catch(() => ({}));
  const action = String(body.action || '');
  try {
    if (action === 'create_instruction') {
      const ownerDenied = ownerOnly(role); if (ownerDenied) return ownerDenied;
      const approve = !!body.approve;
      if (approve && body.confirmed !== true) {
        return NextResponse.json({ error: 'Confirm activation before publishing an instruction to the AI' }, { status: 400 });
      }
      const instruction = await createInstruction(body, actor, approve);
      return NextResponse.json({ ok: true, instruction, message: approve ? 'Instruction approved and active.' : 'Instruction saved as a draft.' });
    }
    if (action === 'create_correction') {
      const correction = await createTrainingCorrection(body, actor);
      return NextResponse.json({ ok: true, correction, message: 'Correction saved pending review.' });
    }
    if (action === 'command') {
      const ownerDenied = ownerOnly(role); if (ownerDenied) return ownerDenied;
      if (body.confirmed !== true) return NextResponse.json({ error: 'This operational command requires explicit confirmation' }, { status: 400 });
      const result = await executeTrainingCommand(String(body.command || ''), body, actor);
      return NextResponse.json({ ok: true, ...result });
    }
    return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'Could not complete the request' }, { status: 400 });
  }
}

export async function PATCH(req: Request) {
  const denied = await adminDenied(); if (denied) return denied;
  const { actor, role } = await actorAndRole();
  const body = await req.json().catch(() => ({}));
  try {
    if (body.kind === 'instruction') {
      const ownerDenied = ownerOnly(role); if (ownerDenied) return ownerDenied;
      if (body.confirmed !== true) return NextResponse.json({ error: 'Confirm this instruction change' }, { status: 400 });
      const result = await mutateTrainingInstruction(String(body.action || ''), body, actor);
      return NextResponse.json({ ok: true, result });
    }
    if (body.kind === 'correction') {
      if (['approve', 'apply', 'undo', 'disable', 'delete'].includes(String(body.action)) && role !== 'owner') {
        return NextResponse.json({ error: 'Only the owner can approve, apply, undo, disable or delete corrections' }, { status: 403 });
      }
      const result = await reviewTrainingCorrection(Number(body.id), String(body.action || ''), body, actor);
      return NextResponse.json({ ok: true, result });
    }
    return NextResponse.json({ error: 'Unknown change type' }, { status: 400 });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'Could not apply the change' }, { status: 400 });
  }
}
