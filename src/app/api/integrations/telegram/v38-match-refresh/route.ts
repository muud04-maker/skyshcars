import { repairTelegramSourceAssociations } from '../../../../../lib/telegram-repair';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

/** Temporary fixed-input match refresh. It accepts no IDs, content or publication options. */
export async function POST() {
  try {
    return Response.json(await repairTelegramSourceAssociations(), {
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch (error: any) {
    return Response.json({
      ok: false,
      error: String(error?.message || 'Telegram match refresh failed').slice(0, 500),
      private_content_included: false,
    }, { status: 409, headers: { 'Cache-Control': 'no-store' } });
  }
}
