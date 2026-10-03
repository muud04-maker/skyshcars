import {createGroupImport} from '../../../../lib/group-import';
import {bridgeAuthorized,isGroupAllowed,touchGroup} from '../../../../lib/group-reader';
import {getAutomationSettings} from '../../../../lib/automation';
export const dynamic='force-dynamic';
export async function POST(req:Request){
  if(!bridgeAuthorized(req))return Response.json({error:'Unauthorized'},{status:401});
  try{
    const settings=await getAutomationSettings();
    if(!settings.group_reader_enabled)return Response.json({error:'Group Reader imports are disabled in Automation Center'},{status:423});
    const b=await req.json();const name=String(b.groupName||'');const gid=String(b.groupId||'');
    if(!(await isGroupAllowed(name,gid)))return Response.json({error:'Group is not authorized in Sky Cars Admin'},{status:403});
    const out=await createGroupImport(b);await touchGroup(name,String(b.messageId||''),gid);return Response.json({ok:true,...out});
  }catch(e:any){console.error('GROUP_BRIDGE',e);return Response.json({error:e?.message||'Import failed'},{status:400})}
}
