/* Read-only policy version history from audit_logs (brief section 7). No restore action exists. */
import { NextResponse } from 'next/server';
import { adminDenied } from '../../../../../lib/admin-guard';
import { rows } from '../../../../../lib/db';

export const dynamic = 'force-dynamic';

export async function GET() {
  const d = await adminDenied(); if (d) return d;
  const list = await rows<any>(`SELECT id,actor,created_at,details FROM audit_logs
    WHERE action='business_policy.updated' ORDER BY id DESC LIMIT 25`).catch(() => []);
  return NextResponse.json({
    versions: list.map((r) => {
      let details: any = {};
      try { details = typeof r.details === 'string' ? JSON.parse(r.details) : r.details || {}; } catch { details = {}; }
      const before = details.before || {}, after = details.after || {};
      const changed: string[] = [];
      for (const group of ['shipping', 'payment', 'style']) {
        for (const k of Object.keys(after[group] || {})) {
          if (JSON.stringify(before[group]?.[k]) !== JSON.stringify(after[group]?.[k])) changed.push(`${group}.${k}`);
        }
      }
      return { version: after.version ?? null, at: r.created_at, by: r.actor || null, changed, before, after };
    }),
    note: 'Read-only history. Restoring an old version is a deliberate edit, never automatic.',
  });
}
