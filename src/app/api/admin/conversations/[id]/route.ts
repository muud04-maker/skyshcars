import {NextResponse} from 'next/server';import {rows,one,db} from '../../../../../lib/db';import {adminDenied} from '../../../../../lib/admin-guard';import {agentEvent} from '../../../../../lib/agent-events';
export async function GET(_:Request,{params}:{params:Promise<{id:string}>}){const d=await adminDenied();if(d)return d;const {id}=await params;const conversation=await one<any>(`SELECT co.*,c.full_name,c.phone FROM conversations co LEFT JOIN customers c ON c.id=co.customer_id WHERE co.id=?`,[id]);if(!conversation)return NextResponse.json({error:'Not found'},{status:404});const messages=await rows<any>('SELECT id,sender,direction,message_type,body,media_url,delivery_status,delivery_error,created_at FROM messages WHERE conversation_id=? ORDER BY created_at ASC,id ASC LIMIT 1000',[id]);const conversations=await rows<any>(`SELECT co.id,co.channel,co.external_user_id,co.mode,co.last_message_at,c.full_name,c.phone,
(SELECT body FROM messages m WHERE m.conversation_id=co.id ORDER BY m.id DESC LIMIT 1) preview,
CASE WHEN (SELECT COALESCE(MAX(m1.id),0) FROM messages m1 WHERE m1.conversation_id=co.id AND m1.sender='customer' AND m1.direction='inbound') > (SELECT COALESCE(MAX(m2.id),0) FROM messages m2 WHERE m2.conversation_id=co.id AND m2.sender IN ('ai','human') AND m2.direction='outbound') THEN 1 ELSE 0 END needs_reply
FROM conversations co LEFT JOIN customers c ON c.id=co.customer_id ORDER BY needs_reply DESC,co.last_message_at DESC LIMIT 300`);return NextResponse.json({conversation,messages,conversations})}

/**
 * Delete ONE conversation (admin only). Its messages are removed by the foreign key
 * (messages.conversation_id -> conversations.id ON DELETE CASCADE); the linked customer record is
 * never touched. Side tables that have no foreign key are cleared first.
 */
export async function DELETE(_:Request,{params}:{params:Promise<{id:string}>}){
  const {getAdminSession}=await import('../../../../../lib/admin');
  const session=await getAdminSession();
  if(session?.role!=='owner')return NextResponse.json({error:'Only the owner can permanently delete a conversation. Use Archive instead.'},{status:403});
  const {id:raw}=await params;const id=Number(raw);
  if(!id)return NextResponse.json({error:'Invalid conversation id'},{status:400});
  try{
    await db().execute('DELETE FROM conversation_state WHERE conversation_id=?',[id]).catch(()=>{});
    await db().execute('DELETE FROM chat_referrals WHERE conversation_id=?',[id]).catch(()=>{});
    const [r]:any=await db().execute('DELETE FROM conversations WHERE id=?',[id]);
    await agentEvent(null,null,'conversation_deleted','ok',{conversation_id:id,deleted:Number(r?.affectedRows||0)}).catch(()=>{});
    return NextResponse.json({ok:true,deleted:Number(r?.affectedRows||0)});
  }catch(e:any){return NextResponse.json({error:e?.message||'Could not delete the conversation'},{status:500})}
}
