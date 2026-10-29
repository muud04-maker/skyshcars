import { bridgeAuthorized, finishSyncRun, saveSyncCheckpoint, startSyncRun } from '../../../../../lib/group-reader';

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  if (!bridgeAuthorized(req)) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  try {
    if (body.action === 'start') return Response.json(await startSyncRun(body));
    if (body.action === 'checkpoint') return Response.json(await saveSyncCheckpoint(body));
    if (body.action === 'finish') return Response.json(await finishSyncRun(body));
    return Response.json({ error: 'Unknown sync action' }, { status: 400 });
  } catch (error: any) {
    console.error('GROUP_SYNC_STATE', error);
    return Response.json({ error: String(error?.message || 'Sync state update failed') }, { status: 503 });
  }
}
