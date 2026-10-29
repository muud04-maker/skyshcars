import { adminDenied } from '../../../../../lib/admin-guard';
import { getAdminSession } from '../../../../../lib/admin';
import { backfillInventoryIdentity } from '../../../../../lib/inventory-memory';
import { listGroupImports, reviewGroupImport } from '../../../../../lib/group-import';
import { needsSetupJson } from '../../../../../lib/setup';
export const dynamic='force-dynamic';
export async function GET(){const d=await adminDenied();if(d)return d;try{return Response.json({items:await listGroupImports()});}catch{return needsSetupJson()}}
export async function POST(req:Request){
  const d=await adminDenied();if(d)return d;
  const b=await req.json().catch(()=>({}));
  if(b.action==='backfill'){
    try{return Response.json(await backfillInventoryIdentity(Number(b.limit)||80))}
    catch{return needsSetupJson()}
  }
  const id=Number(b.id);
  if(!id||!['approve','reject','merge','apply_changes'].includes(String(b.action)))return Response.json({error:'Bad request'},{status:400});
  try{
    const session=await getAdminSession();
    const options=typeof b.options==='object'&&b.options?{
      publishFacebook:b.options.publishFacebook===true,
      sellNow:b.options.sellNow===true,
      duplicateOverride:b.options.duplicateOverride===true,
    }:{};
    return Response.json(await reviewGroupImport(
      id,b.action,
      {...(typeof b.vehicle==='object'&&b.vehicle?b.vehicle:{}),reviewer:String(session?.email||'admin')},
      options,
    ));
  }catch(e:any){
    return Response.json({error:e?.message||'Review failed'},{status:400});
  }
}
