import {NextResponse} from 'next/server';
import {one} from '../../../../../../lib/db';
import {adminDenied} from '../../../../../../lib/admin-guard';
import {salesReply,AI_MODEL} from '../../../../../../lib/ai';
import {outbound} from '../../../../../../lib/conversations';
import {sendWhatsApp,whatsappConfigured} from '../../../../../../lib/meta';
import {agentEvent} from '../../../../../../lib/agent-events';
import {claimReply,markReplySent,markReplyFailed} from '../../../../../../lib/reply-guard';
import {planPhotos,sendPlannedPhotos} from '../../../../../../lib/whatsapp-photos';

export async function POST(_:Request,{params}:{params:Promise<{id:string}>}){
  const d=await adminDenied();if(d)return d;
  const {id}=await params;
  const c=await one<any>('SELECT id,channel,external_user_id,mode FROM conversations WHERE id=? LIMIT 1',[id]);
  if(!c)return NextResponse.json({error:'Conversation not found'},{status:404});
  if(c.channel!=='whatsapp')return NextResponse.json({error:'AI retry is currently available for WhatsApp conversations.'},{status:400});
  const pending=await one<any>(`SELECT m.id,m.body,m.external_message_id FROM messages m
    WHERE m.conversation_id=? AND m.sender='customer' AND m.direction='inbound'
      AND m.id > COALESCE((SELECT MAX(x.id) FROM messages x WHERE x.conversation_id=? AND x.sender IN ('ai','human') AND x.direction='outbound'),0)
    ORDER BY m.id DESC LIMIT 1`,[id,id]);
  if(!pending?.body)return NextResponse.json({ok:true,sent:false,message:'No unanswered customer message found.'});
  if(!whatsappConfigured())return NextResponse.json({error:'WhatsApp sending needs setup (see Readiness).'},{status:503});
  const inboundKey=String(pending.external_message_id||`db:${pending.id}`);
  const claimed=await claimReply(inboundKey,Number(id),'manual_ai_retry',true);
  if(!claimed)return NextResponse.json({ok:true,sent:false,message:'A reply for this customer message is already in progress or was already sent.'});
  try{
    const photoPlan=await planPhotos(String(pending.body),Number(id)).catch(()=>null);
    const reply=await salesReply(String(pending.body),Number(id),photoPlan);
    if(!reply)throw new Error('AI returned no reply');
    const waId=await sendWhatsApp(String(c.external_user_id),reply);
    await markReplySent(inboundKey,waId);
    await outbound(Number(id),'ai',reply,AI_MODEL);
    await sendPlannedPhotos(String(c.external_user_id),Number(id),photoPlan);
    await agentEvent(Number(id),pending.external_message_id||null,'manual_ai_retry','ok',{whatsapp_message_id:waId,chars:reply.length});
    return NextResponse.json({ok:true,sent:true,reply});
  }catch(e:any){
    const detail=e?.response?.data||e?.message||String(e);
    await markReplyFailed(inboundKey,detail).catch(()=>{});
    await agentEvent(Number(id),pending.external_message_id||null,'manual_ai_retry','failed',detail);
    return NextResponse.json({error:typeof detail==='string'?detail:JSON.stringify(detail)},{status:502});
  }
}
