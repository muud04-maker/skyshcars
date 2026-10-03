import {bridgeAuthorized,upsertBridgeHeartbeat} from '../../../../../lib/group-reader';
import {needsSetupJson} from '../../../../../lib/setup';
export const dynamic='force-dynamic';
export async function POST(req:Request){if(!bridgeAuthorized(req))return Response.json({error:'Unauthorized'},{status:401});try{return Response.json(await upsertBridgeHeartbeat(await req.json().catch(()=>({}))))}catch(e){console.error('BRIDGE_HEARTBEAT',e);return needsSetupJson()}}
