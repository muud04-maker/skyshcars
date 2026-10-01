import crypto from 'crypto';import {db} from '../../../../../lib/db';import {supplierBySlug} from '../../../../../lib/suppliers';
export const dynamic='force-dynamic';
function okSecret(got:string|null){const expected=process.env.SUPPLIER_FEED_SECRET||'';if(!got||!expected||got.length!==expected.length)return false;return crypto.timingSafeEqual(Buffer.from(got),Buffer.from(expected))}
export async function POST(req:Request,{params}:{params:Promise<{slug:string}>}){
  if(!okSecret(req.headers.get('x-sky-cars-secret')))return Response.json({error:'Unauthorized'},{status:401});
  const {slug}=await params;const supplier:any=await supplierBySlug(slug);if(!supplier)return Response.json({error:'Unknown supplier'},{status:404});
  const body:any=await req.json().catch(()=>null);if(!body)return Response.json({error:'JSON required'},{status:400});
  const list=Array.isArray(body)?body:Array.isArray(body.vehicles)?body.vehicles:[body];if(list.length>1000)return Response.json({error:'Maximum 1000 vehicles per request'},{status:413});
  let accepted=0;
  for(const item of list){
    const ext=String(item.stock_no||item.stock||item.id||'').slice(0,150);
    const sourceId=`partner:${supplier.id}:${ext||Date.now()+'-'+accepted}`;
    await db().execute(`INSERT INTO inventory_import_items(source,source_message_id,raw_payload,proposed_vehicle,review_status)
      VALUES('manual',?,?,?,'pending')`,[sourceId,JSON.stringify({private_supplier_id:supplier.id,payload:item}),JSON.stringify(item)]);
    accepted++;
  }
  return Response.json({ok:true,accepted,status:'pending_admin_review'});
}
