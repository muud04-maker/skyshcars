import { discoverTelegramSourceGroup } from '../../../../../lib/telegram-automation';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Fixed-source discovery; accepts no token, chat ID or arbitrary webhook URL from the caller. */
export async function POST() {
  try {
    const result = await discoverTelegramSourceGroup();
    return Response.json(result, { status: result.ok ? 200 : 409, headers: { 'Cache-Control': 'no-store' } });
  } catch {
    return Response.json({ ok: false, state: 'discovery_failed' }, { status: 503, headers: { 'Cache-Control': 'no-store' } });
  }
}

export async function GET() {
  return Response.json({ error: 'Use POST' }, { status: 405 });
}
