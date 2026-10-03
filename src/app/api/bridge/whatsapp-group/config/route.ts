import {bridgeAuthorized,enabledGroupNames} from '../../../../../lib/group-reader';
import {getAutomationSettings} from '../../../../../lib/automation';
export const dynamic='force-dynamic';
const ok=bridgeAuthorized;
export async function GET(req:Request){if(!ok(req))return Response.json({error:'Unauthorized'},{status:401});const s=await getAutomationSettings().catch(()=>({group_reader_enabled:false}) as any);try{return Response.json({groups:s.group_reader_enabled?await enabledGroupNames():[],enabled:!!s.group_reader_enabled,poll_seconds:60,version:'32'})}catch(e){console.error('BRIDGE_CONFIG',e);return Response.json({groups:[],enabled:false,poll_seconds:60,version:'32',needsSetup:true},{status:503})}}
