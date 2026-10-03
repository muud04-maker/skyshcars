import {bridgeAuthorized,upsertBridgeHeartbeat} from '../../../../../lib/group-reader';
export const dynamic='force-dynamic';
export async function POST(req:Request){if(!bridgeAuthorized(req))return Response.json({error:'Unauthorized'},{status:401});return Response.json(await upsertBridgeHeartbeat(await req.json().catch(()=>({}))))}
