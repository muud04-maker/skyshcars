import { bridgeAuthorized, isGroupAllowed, touchGroup } from '../../../../../lib/group-reader';
import { getAutomationSettings } from '../../../../../lib/automation';
import { logGroupMessage } from '../../../../../lib/group-log';
export const dynamic = 'force-dynamic';

/** Bridge sends EVERY message from an authorized group here (text, photos, sender, time). Logging only; never creates vehicles. */
export async function POST(req: Request) {
  if (!bridgeAuthorized(req)) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  try {
    const settings = await getAutomationSettings();
    if (!settings.group_reader_enabled) return Response.json({ error: 'Group Reader is disabled in Automation Center' }, { status: 423 });
    const b = await req.json();
    const name = String(b.groupName || ''), gid = String(b.groupId || '');
    if (!(await isGroupAllowed(name, gid))) return Response.json({ error: 'Group is not authorized in Sky Cars Admin' }, { status: 403 });
    const out = await logGroupMessage(b);
    await touchGroup(name, String(b.messageId || ''), gid).catch(() => {});
    return Response.json({ ok: true, ...out });
  } catch (e: any) {
    console.error('GROUP_LOG', e);
    return Response.json({ error: 'Log failed temporarily; the bridge will retry.' }, { status: 503 });
  }
}
