import { isAdmin } from '../../../../lib/admin';
import { db, rows } from '../../../../lib/db';
import { ensureAiKnowledgeSchema } from '../../../../lib/knowledge';
export const dynamic='force-dynamic';

async function guard(){return await isAdmin()}
export async function GET(){
  if(!(await guard())) return Response.json({error:'Unauthorized'},{status:401});
  await ensureAiKnowledgeSchema();
  return Response.json({items:await rows<any>('SELECT * FROM ai_knowledge ORDER BY updated_at DESC LIMIT 200')});
}
export async function POST(req:Request){
  if(!(await guard())) return Response.json({error:'Unauthorized'},{status:401});
  await ensureAiKnowledgeSchema();
  const b=await req.json().catch(()=>({}));
  const title=String(b.title||'').trim(), content=String(b.content||'').trim();
  if(!title||!content) return Response.json({error:'Title and content are required'},{status:400});
  const [r]:any=await db().execute('INSERT INTO ai_knowledge(title,content,active,source) VALUES(?,?,1,?)',[title,content,'admin']);
  return Response.json({ok:true,id:r.insertId});
}
export async function PATCH(req:Request){
  if(!(await guard())) return Response.json({error:'Unauthorized'},{status:401});
  await ensureAiKnowledgeSchema();
  const b=await req.json().catch(()=>({})); const id=Number(b.id);
  if(!id) return Response.json({error:'Invalid id'},{status:400});
  if(typeof b.active==='boolean') await db().execute('UPDATE ai_knowledge SET active=? WHERE id=?',[b.active?1:0,id]);
  if(b.title!==undefined||b.content!==undefined){
    const cur:any=(await rows<any>('SELECT title,content FROM ai_knowledge WHERE id=? LIMIT 1',[id]))[0];
    if(cur) await db().execute('UPDATE ai_knowledge SET title=?,content=? WHERE id=?',[String(b.title??cur.title).trim(),String(b.content??cur.content).trim(),id]);
  }
  return Response.json({ok:true});
}
export async function DELETE(req:Request){
  if(!(await guard())) return Response.json({error:'Unauthorized'},{status:401});
  const u=new URL(req.url); const id=Number(u.searchParams.get('id'));
  if(!id) return Response.json({error:'Invalid id'},{status:400});
  await db().execute('DELETE FROM ai_knowledge WHERE id=?',[id]);
  return Response.json({ok:true});
}
