/*
  Daily human-sales pattern learner (GOAL 3/6). Hostinger: run once a day, e.g.
    0 1 * * * curl -s "https://skyshcars.com/api/cron/daily-patterns?secret=$AUTOMATION_CRON_SECRET" > /dev/null
  Protected by AUTOMATION_CRON_SECRET. It only counts what really happened; it never creates rules.
*/
import { generateDailyPatterns } from '../../../../lib/sales-patterns';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const secret = process.env.AUTOMATION_CRON_SECRET || '';
  const given = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '') || new URL(req.url).searchParams.get('secret') || '';
  if (!secret || given !== secret) return Response.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
  const day = new URL(req.url).searchParams.get('day') || '';
  const out = await generateDailyPatterns(day || undefined).catch((e) => ({ error: String(e?.message || e) }));
  return Response.json({ ok: !('error' in out), ...out });
}
