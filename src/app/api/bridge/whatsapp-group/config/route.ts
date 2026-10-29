import {bridgeAuthorized,enabledGroupNames,pendingManualSync} from '../../../../../lib/group-reader';
import {getAutomationSettings} from '../../../../../lib/automation';
export const dynamic='force-dynamic';
const ok=bridgeAuthorized;
export async function GET(req:Request){
  if(!ok(req))return Response.json({error:'Unauthorized'},{status:401});
  const s=await getAutomationSettings().catch(()=>({group_reader_enabled:false}) as any);
  try{
    const bridgeId=new URL(req.url).searchParams.get('bridgeId')||'primary';
    const groups=s.group_reader_enabled?await enabledGroupNames():[];
    return Response.json({groups,enabled:!!s.group_reader_enabled,poll_seconds:60,version:'35',manualSync:await pendingManualSync(bridgeId)});
  }catch(e){
    console.error('BRIDGE_CONFIG',e);
    return Response.json({groups:[],enabled:false,poll_seconds:60,version:'35',needsSetup:true},{status:503});
  }
}
