import { adminDenied } from '../../../../lib/admin-guard';
import {
  getTelegramSettings,
  processTelegramQueue,
  registerTelegramWebhook,
  retryTelegramFailures,
  saveTelegramSettings,
  telegramConnectionProbe,
  telegramDashboard,
  telegramSampleVehicles,
  telegramV37Diagnostic,
  telegramV38Diagnostic,
  testTelegramSampleVehicle,
} from '../../../../lib/telegram-automation';
import { needsSetupJson } from '../../../../lib/setup';
import { repairApprovedTelegramImports } from '../../../../lib/group-import';
import { repairTelegramSourceAssociations } from '../../../../lib/telegram-repair';

export const dynamic = 'force-dynamic';

export async function GET() {
  const denied = await adminDenied();
  if (denied) return denied;
  try {
    const [dashboard, samples] = await Promise.all([telegramDashboard(), telegramSampleVehicles()]);
    return Response.json({ ...dashboard, sample_vehicles: samples });
  } catch {
    return needsSetupJson();
  }
}

export async function PATCH(req: Request) {
  const denied = await adminDenied();
  if (denied) return denied;
  const body = await req.json().catch(() => ({}));
  try {
    return Response.json({ ok: true, settings: await saveTelegramSettings(body) });
  } catch {
    return needsSetupJson();
  }
}

export async function POST(req: Request) {
  const denied = await adminDenied();
  if (denied) return denied;
  const body = await req.json().catch(() => ({}));
  const action = String(body.action || '');
  try {
    if (action === 'probe') return Response.json({ ok: true, connection: await telegramConnectionProbe() });
    if (action === 'register_webhook') return Response.json({ ok: true, registration: await registerTelegramWebhook() });
    if (action === 'retry') return Response.json({ ok: true, ...(await retryTelegramFailures()) });
    if (action === 'process_queue') return Response.json({ ok: true, processed: await processTelegramQueue(20) });
    if (action === 'repair_imports') return Response.json({ ok: true, ...(await repairApprovedTelegramImports()) });
    if (action === 'repair_source_associations') return Response.json(await repairTelegramSourceAssociations());
    if (action === 'v37_diagnostic') return Response.json({ ok: true, diagnostic: await telegramV37Diagnostic() });
    if (action === 'v38_diagnostic') return Response.json(await telegramV38Diagnostic());
    if (action === 'save_settings') return Response.json({ ok: true, settings: await saveTelegramSettings(body.settings || {}) });
    if (action === 'test_sample') {
      const result = await testTelegramSampleVehicle(Number(body.vehicle_id));
      return Response.json(result, { status: result.ok ? 200 : 409 });
    }
    return Response.json({ error: 'Unknown action' }, { status: 400 });
  } catch (error: any) {
    return Response.json({ error: String(error?.message || 'Telegram operation failed').slice(0, 500) }, { status: 400 });
  }
}
