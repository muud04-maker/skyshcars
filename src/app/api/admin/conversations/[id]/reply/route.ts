import {sendWhatsApp,whatsappConfigured} from '../../../../../../lib/meta';
import {sendMessenger,graphError} from '../../../../../../lib/facebook';
import {NextResponse} from 'next/server';
import {db,one} from '../../../../../../lib/db';
import {outbound} from '../../../../../../lib/conversations';
import {adminDenied} from '../../../../../../lib/admin-guard';
import {agentEvent} from '../../../../../../lib/agent-events';
import {clearAiReply,pauseAi} from '../../../../../../lib/conversation-state';
import {staffPauseMinutes} from '../../../../../../lib/staff';
import {recordHumanShadowLearning} from '../../../../../../lib/shadow-learning';

export async function POST(req:Request,{params}:{params:Promise<{id:string}>}){
  const d=await adminDenied();if(d)return d;
  const {id}=await params;
  const b=await req.json();
  const text=String(b.text||'').trim();
  if(!text)return NextResponse.json({error:'Message is empty'},{status:400});
  const c=await one<any>('SELECT * FROM conversations WHERE id=?',[id]);
  if(!c)return NextResponse.json({error:'Conversation not found'},{status:404});
  if(!['whatsapp','facebook'].includes(String(c.channel)))return NextResponse.json({error:'This conversation channel cannot be answered from the inbox yet.'},{status:400});
  if(c.channel==='whatsapp'&&!whatsappConfigured())return NextResponse.json({error:'WhatsApp send credentials are not configured. Add either WHATSAPP_ACCESS_TOKEN + WHATSAPP_PHONE_NUMBER_ID or the supported legacy aliases.'},{status:503});
  try{
    // WhatsApp and Facebook/Messenger staff replies share one code path (both store a human outbound row).
    const metaId=c.channel==='whatsapp'?await sendWhatsApp(c.external_user_id,text):await sendMessenger(c.external_user_id,text);
    await outbound(Number(id),'human',text);
    /*
      A staff reply cancels the AI for THIS turn, but it deliberately does NOT force the chat into
      TAKE OVER: the mode is preserved so the next new customer message re-arms the AI according to
      the current mode (AI / BOTH). "Take Over" stays an explicit owner action.
    */
    await db().execute("UPDATE conversations SET takeover_by='admin',takeover_at=COALESCE(takeover_at,NOW()),last_message_at=NOW() WHERE id=?",[id]);
    // Part 6: keep the AI quiet for the turn the human just answered.
    await pauseAi(Number(id), await staffPauseMinutes(), 'admin').catch(()=>{});
    await clearAiReply(Number(id)).catch(()=>{});
    await agentEvent(Number(id),null,'human_reply','ok',{whatsapp_message_id:metaId,chars:text.length});
    /*
      GOAL 4: compare this person's answer with what the AI last said. If they materially differ, a
      PENDING learning candidate is queued (approval still required); the answer also becomes
      same-customer context immediately. Never blocks the reply.
    */
    const shadow=await recordHumanShadowLearning({conversationId:Number(id),humanReply:text}).catch(()=>({recorded:false}));
    return NextResponse.json({ok:true,metaMessageId:metaId});
  }catch(e:any){
    const detail=c.channel==='facebook'?graphError(e):(e?.response?.data||e?.message||String(e));
    await agentEvent(Number(id),null,'human_reply','failed',detail);
    console.error('ADMIN_WHATSAPP_SEND',detail);
    return NextResponse.json({error:typeof detail==='string'?detail:JSON.stringify(detail)},{status:502});
  }
}
