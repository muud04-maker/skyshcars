import {sendWhatsApp,whatsappConfigured} from '../../../../../../lib/meta';
import {NextResponse} from 'next/server';
import {db,one} from '../../../../../../lib/db';
import {outbound} from '../../../../../../lib/conversations';
import {adminDenied} from '../../../../../../lib/admin-guard';
import {agentEvent} from '../../../../../../lib/agent-events';

export async function POST(req:Request,{params}:{params:Promise<{id:string}>}){
  const d=await adminDenied();if(d)return d;
  const {id}=await params;
  const b=await req.json();
  const text=String(b.text||'').trim();
  if(!text)return NextResponse.json({error:'Message is empty'},{status:400});
  const c=await one<any>('SELECT * FROM conversations WHERE id=?',[id]);
  if(!c)return NextResponse.json({error:'Conversation not found'},{status:404});
  if(c.channel!=='whatsapp')return NextResponse.json({error:'Human sending is currently enabled for WhatsApp only.'},{status:400});
  if(!whatsappConfigured())return NextResponse.json({error:'WhatsApp send credentials are not configured. Add either WHATSAPP_ACCESS_TOKEN + WHATSAPP_PHONE_NUMBER_ID or the supported legacy aliases.'},{status:503});
  try{
    const metaId=await sendWhatsApp(c.external_user_id,text);
    await outbound(Number(id),'human',text);
    await db().execute("UPDATE conversations SET mode='human',takeover_by='admin',takeover_at=COALESCE(takeover_at,NOW()),last_message_at=NOW() WHERE id=?",[id]);
    await agentEvent(Number(id),null,'human_reply','ok',{whatsapp_message_id:metaId,chars:text.length});
    return NextResponse.json({ok:true,metaMessageId:metaId});
  }catch(e:any){
    const detail=e?.response?.data||e?.message||String(e);
    await agentEvent(Number(id),null,'human_reply','failed',detail);
    console.error('ADMIN_WHATSAPP_SEND',detail);
    return NextResponse.json({error:typeof detail==='string'?detail:JSON.stringify(detail)},{status:502});
  }
}
