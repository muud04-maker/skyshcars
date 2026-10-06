import { adminDenied } from '../../../../lib/admin-guard';
import { needsSetupJson } from '../../../../lib/setup';
import { bulkCatalog, catalogCounts, getCatalogSetting, listCatalogForAdmin, setCarsEnabled, setCatalogMode } from '../../../../lib/ai-catalog';
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const d = await adminDenied(); if (d) return d;
  const u = new URL(req.url);
  try {
    const f = u.searchParams.get('filter');
    const list = await listCatalogForAdmin({ q: u.searchParams.get('q') || '', filter: f === 'on' || f === 'off' ? f : 'all', days: Number(u.searchParams.get('days')) || undefined, status: u.searchParams.get('status') || undefined });
    const s = await getCatalogSetting();
    return Response.json({ list, counts: await catalogCounts(), migration: { at: s.migrated_at || null, enabled: s.migration_enabled || [] } });
  } catch { return needsSetupJson(); }
}

export async function POST(req: Request) {
  const d = await adminDenied(); if (d) return d;
  const b = await req.json().catch(() => ({}));
  try {
    if (b.action === 'mode') await setCatalogMode(b.mode === 'all' ? 'all' : 'selected');
    else if (b.action === 'set') await setCarsEnabled(Array.isArray(b.ids) ? b.ids : [b.id], !!b.enabled);
    else if (['only_recent', 'enable_all', 'disable_all'].includes(b.action)) {
      const n = await bulkCatalog(b.action, Number(b.days) || 3);
      return Response.json({ ok: true, changed: n, counts: await catalogCounts() });
    } else return Response.json({ error: 'Unknown action' }, { status: 400 });
    return Response.json({ ok: true, counts: await catalogCounts() });
  } catch { return needsSetupJson(); }
}
