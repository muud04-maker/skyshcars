import { adminDenied } from '../../../../../lib/admin-guard';
import { listGroupImports, reviewGroupImport } from '../../../../../lib/group-import';
export const dynamic='force-dynamic';
export async function GET(){const d=await adminDenied();if(d)return d;return Response.json({items:await listGroupImports()});}
export async function POST(req:Request){const d=await adminDenied();if(d)return d;const b=await req.json();const id=Number(b.id);if(!id||!['approve','reject'].includes(b.action))return Response.json({error:'Bad request'},{status:400});try{return Response.json(await reviewGroupImport(id,b.action));}catch(e:any){return Response.json({error:e?.message||'Review failed'},{status:400});}}
