import {adminDenied} from '../../../../lib/admin-guard';
import {deleteGroupSource,groupReaderDashboard,requestManualSync,saveGroupSource} from '../../../../lib/group-reader';
import {needsSetupJson} from '../../../../lib/setup';
export const dynamic='force-dynamic';
export async function GET(){
  const d=await adminDenied();if(d)return d;
  try{return Response.json(await groupReaderDashboard())}catch{return needsSetupJson()}
}
export async function POST(req:Request){
  const d=await adminDenied();if(d)return d;
  const body=await req.json().catch(()=>({}));
  try{
    if(body.action==='request_sync')return Response.json(await requestManualSync(String(body.bridge_id||'primary')));
    return Response.json(await saveGroupSource(body));
  }catch(e:any){return Response.json({error:e?.message||'Could not save group'},{status:400})}
}
export async function DELETE(req:Request){
  const d=await adminDenied();if(d)return d;
  const b=await req.json().catch(()=>({}));
  try{return Response.json(await deleteGroupSource(Number(b.id)))}catch{return needsSetupJson()}
}
