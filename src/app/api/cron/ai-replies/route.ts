/*
  Dedicated cron endpoint for the 60-second AI reply queue (Hostinger: run every 1 minute).
  Protected by AUTOMATION_CRON_SECRET: Authorization: Bearer <secret> or ?secret=<secret>.
*/
import { processDueAiReplies } from '../../../../lib/ai-queue-worker';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const secret = process.env.AUTOMATION_CRON_SECRET || '';
  const given = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '') || new URL(req.url).searchParams.get('secret') || '';
  if (!secret || given !== secret) return Response.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
  const results = await processDueAiReplies().catch((e) => { console.error('AI_QUEUE_CRON', e); return []; });
  return Response.json({ ok: true, processed: results.length, results });
}
