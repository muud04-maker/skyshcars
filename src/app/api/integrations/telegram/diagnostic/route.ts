import { runTelegramDiagnosticPing } from '../../../../../lib/telegram-automation';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Fixed no-input live delivery test; rate-limited and never accepts message content. */
export async function POST() {
  try {
    const result = await runTelegramDiagnosticPing();
    return Response.json(result, { status: result.ok ? 200 : 409, headers: { 'Cache-Control': 'no-store' } });
  } catch (error: any) {
    return Response.json({ ok: false, state: 'diagnostic_failed', error: String(error?.message || 'Diagnostic failed').slice(0, 500) },
      { status: 503, headers: { 'Cache-Control': 'no-store' } });
  }
}

export async function GET() {
  return Response.json({ error: 'Use POST' }, { status: 405 });
}
