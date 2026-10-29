import { telegramV38Diagnostic } from '../../../../../lib/telegram-automation';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST() {
  try {
    return Response.json(await telegramV38Diagnostic(), {
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch {
    return Response.json({ ok: false, error: 'Diagnostic failed', private_content_included: false }, {
      status: 503,
      headers: { 'Cache-Control': 'no-store' },
    });
  }
}

export async function GET() {
  return Response.json({ error: 'Use POST' }, { status: 405 });
}
