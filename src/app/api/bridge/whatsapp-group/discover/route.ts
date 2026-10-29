import { bridgeAuthorized, discoverAndLockGroups } from '../../../../../lib/group-reader';
import { getAutomationSettings } from '../../../../../lib/automation';

export const dynamic = 'force-dynamic';

/** Called by the linked WhatsApp reader after login. It pins one exact group ID per authorized display name. */
export async function POST(req: Request) {
  if (!bridgeAuthorized(req)) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  const settings = await getAutomationSettings().catch(() => null);
  if (!settings?.group_reader_enabled) return Response.json({ error: 'Group Reader is disabled in Automation Center' }, { status: 423 });
  const body = await req.json().catch(() => ({}));
  try {
    const groups = await discoverAndLockGroups(body.groups);
    return Response.json({ ok: true, groups });
  } catch (e: any) {
    console.error('GROUP_DISCOVERY', e);
    return Response.json({ error: 'Could not lock the discovered group ID' }, { status: 503 });
  }
}
