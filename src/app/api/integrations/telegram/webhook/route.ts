import { after } from 'next/server';
import {
  processTelegramQueue,
  receiveTelegramUpdate,
} from '../../../../../lib/telegram-automation';
import { telegramSecretMatches } from '../../../../../lib/telegram-rules';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Telegram webhook. The update and its durable processing row are committed before this returns.
 * Actual media download/extraction/publishing runs after the acknowledgement using after().
 */
export async function POST(req: Request) {
  if (!telegramSecretMatches(req.headers.get('x-telegram-bot-api-secret-token'))) {
    const configured = !!String(process.env.TELEGRAM_WEBHOOK_SECRET || '').trim();
    return Response.json({ error: configured ? 'Unauthorized' : 'Telegram webhook is not configured' }, { status: configured ? 401 : 503 });
  }
  const raw = await req.text();
  if (!raw || raw.length > 2 * 1024 * 1024) return Response.json({ error: 'Invalid payload' }, { status: 400 });
  let body: any;
  try { body = JSON.parse(raw); }
  catch { return Response.json({ error: 'Invalid JSON' }, { status: 400 }); }
  try {
    const stored = await receiveTelegramUpdate(body);
    if (stored.stored) {
      after(async () => {
        await new Promise((resolve) => setTimeout(resolve, 4500));
        await processTelegramQueue(12).catch((error) => console.error('TELEGRAM_QUEUE', error?.message || error));
      });
    } else if (stored.duplicate) {
      // A retry must not duplicate the source, but it can safely drain an earlier failed job.
      after(async () => {
        await new Promise((resolve) => setTimeout(resolve, 4500));
        await processTelegramQueue(4).catch((error) => console.error('TELEGRAM_QUEUE_RECOVERY', error?.message || error));
      });
    }
    return Response.json({ ok: true, ...stored });
  } catch (error: any) {
    const status = Number(error?.statusCode) || 503;
    if (status !== 403) console.error('TELEGRAM_WEBHOOK', error?.message || error);
    return Response.json({ error: status === 403 ? 'Source chat is not authorized' : 'Temporary storage failure' }, { status });
  }
}
