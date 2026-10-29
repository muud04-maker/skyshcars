import { bootstrapTelegramWebhook } from '../../../../../lib/telegram-automation';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Fixed-configuration webhook bootstrap. It accepts no URL/token, is rate-limited in MySQL,
 * and returns operational booleans only. The bot token and webhook secret never leave the server.
 */
export async function POST() {
  try {
    const result = await bootstrapTelegramWebhook();
    return Response.json(result, { status: result.ok ? 200 : 503, headers: { 'Cache-Control': 'no-store' } });
  } catch {
    return Response.json({ ok: false, state: 'registration_failed' }, { status: 503, headers: { 'Cache-Control': 'no-store' } });
  }
}

export async function GET() {
  return Response.json({ error: 'Use POST' }, { status: 405 });
}
