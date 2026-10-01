import { createGroupImport } from '../../../../lib/group-import';
export const dynamic='force-dynamic';
export async function POST(req:Request){
  const secret=process.env.WHATSAPP_SERVICE_SECRET||'';
  const given=req.headers.get('x-sky-secret')||'';
  if(!secret || given!==secret) return Response.json({error:'Unauthorized'},{status:401});
  try{return Response.json({ok:true,...await createGroupImport(await req.json())});}
  catch(e:any){console.error('GROUP_BRIDGE',e);return Response.json({error:e?.message||'Import failed'},{status:400});}
}
