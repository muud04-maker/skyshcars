/*
  Launch readiness facts (brief section 12), admin-only. Presence is never presented as "working":
  every integration gets a real probe (a query, a stored event, a config check) and optional items are
  labelled separately from launch blockers. No secret value is ever returned.
*/
import { NextResponse } from 'next/server';
import { adminDenied } from '../../../../lib/admin-guard';
import { one, rows } from '../../../../lib/db';
import { verifyCriticalSchemas } from '../../../../lib/schema-health';
import { taskStats } from '../../../../lib/staff-tasks';
import { mediaAiConfigured } from '../../../../lib/media-ai';

export const dynamic = 'force-dynamic';

export async function GET() {
  const d = await adminDenied(); if (d) return d;
  const [schema, tasks] = await Promise.all([
    verifyCriticalSchemas().catch(() => ({ ok: false, checks: [] as any[] })),
    taskStats().catch(() => ({ pending: 0, in_progress: 0 })),
  ]);
  const [webhook, lastAi, queue, group, bridge] = await Promise.all([
    one<any>(`SELECT MAX(created_at) at FROM ai_agent_events WHERE event_type='webhook_received' AND status='ok'`).catch(() => null),
    one<any>(`SELECT MAX(created_at) at FROM ai_agent_events WHERE event_type IN ('reply','ai_queued')`).catch(() => null),
    one<any>(`SELECT COUNT(*) n FROM conversation_state WHERE pending_ai_reply_at IS NOT NULL`).catch(() => null),
    one<any>(`SELECT COUNT(*) n FROM inventory_import_items WHERE review_status='pending'`).catch(() => null),
    rows<any>(`SELECT status,last_heartbeat_at FROM whatsapp_group_bridge_status ORDER BY last_heartbeat_at DESC LIMIT 1`).catch(() => []),
  ]);
  const secretPresent = !!(process.env.WHATSAPP_APP_SECRET || '').trim();
  const requireSig = String(process.env.REQUIRE_WHATSAPP_SIGNATURE || '').toLowerCase() === 'true';
  const sc = (schema as any).checks || [];
  return NextResponse.json({
    deployed_commit: String(process.env.DEPLOYED_COMMIT || process.env.GIT_COMMIT || process.env.SOURCE_VERSION || '').trim() || null,
    schema: { ok: !!(schema as any).ok, failed: sc.filter((c: any) => !c.ok).map((c: any) => ({ table: c.table, missing: c.missing_columns, error: c.error })) },
    tasks: { pending: tasks.pending, in_progress: tasks.in_progress },
    last_webhook_at: webhook?.at || null,
    last_ai_activity_at: lastAi?.at || null,
    ai_queue_pending: Number(queue?.n || 0),
    signature: { secret_present: secretPresent, enforced: secretPresent && requireSig, mode: !secretPresent ? 'compatibility (no app secret)' : requireSig ? 'secure' : 'monitor' },
    media_ai: { configured: (() => { try { return mediaAiConfigured(); } catch { return false; } })(), note: 'Code path ready; configure OPENAI_API_KEY or MEDIA_AI_API_KEY in Hostinger.' },
    group_reader: { bridge_seen: bridge[0] ? String(bridge[0].last_heartbeat_at || '') : null, online: bridge[0]?.status === 'online', pending_drafts: Number(group?.n || 0) },
    optional: ['media_ai', 'group_reader'],
  });
}
