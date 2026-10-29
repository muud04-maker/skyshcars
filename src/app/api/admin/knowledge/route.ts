import { getAdminSession, isAdmin } from '../../../../lib/admin';
import { approveInstruction, createInstruction, deactivateInstruction, deleteInstruction, instructionById, listInstructions, updateInstruction } from '../../../../lib/knowledge';
export const dynamic='force-dynamic';

async function guard(){return await isAdmin()}
export async function GET(){
  if(!(await guard())) return Response.json({error:'Unauthorized'},{status:401});
  return Response.json({items:await listInstructions(200)});
}
export async function POST(req:Request){
  if(!(await guard())) return Response.json({error:'Unauthorized'},{status:401});
  const session=await getAdminSession().catch(()=>null);
  const b=await req.json().catch(()=>({}));
  try {
    const row=await createInstruction(b,String(session?.email||'admin'),true);
    return Response.json({ok:true,id:row.id,instruction:row});
  } catch(e:any) { return Response.json({error:e?.message||'Could not save the instruction'},{status:400}); }
}
export async function PATCH(req:Request){
  if(!(await guard())) return Response.json({error:'Unauthorized'},{status:401});
  const session=await getAdminSession().catch(()=>null);
  const by=String(session?.email||'admin');
  const b=await req.json().catch(()=>({})); const id=Number(b.id);
  if(!id) return Response.json({error:'Invalid id'},{status:400});
  try {
    if(b.title!==undefined||b.content!==undefined||b.scope!==undefined||b.priority!==undefined){
      const current=await instructionById(id);
      if(!current) return Response.json({error:'Instruction not found'},{status:404});
      await updateInstruction(id,b,by,Boolean(current.active));
    }
    if(typeof b.active==='boolean') {
      if(b.active) await approveInstruction(id,by); else await deactivateInstruction(id,by);
    }
    return Response.json({ok:true});
  } catch(e:any) { return Response.json({error:e?.message||'Could not update the instruction'},{status:400}); }
}
export async function DELETE(req:Request){
  if(!(await guard())) return Response.json({error:'Unauthorized'},{status:401});
  const session=await getAdminSession().catch(()=>null);
  const u=new URL(req.url); const id=Number(u.searchParams.get('id'));
  if(!id) return Response.json({error:'Invalid id'},{status:400});
  try { return Response.json(await deleteInstruction(id,String(session?.email||'admin'))); }
  catch(e:any) { return Response.json({error:e?.message||'Could not delete the instruction'},{status:400}); }
}
