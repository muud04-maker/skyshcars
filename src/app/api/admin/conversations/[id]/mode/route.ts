import {NextResponse} from 'next/server';
import {db,one} from '../../../../../../lib/db';
import {adminDenied} from '../../../../../../lib/admin-guard';
import {salesReply,AI_MODEL} from '../../../../../../lib/ai';
import {outbound} from '../../../../../../lib/conversations';
import {sendWhatsApp,whatsappConfigured} from '../../../../../../lib/meta';
import {agentEvent} from '../../../../../../lib/agent-events';

export async function POST(req:Request,{params}:{params:Promise<{id:string}>}){
  const d=await adminDenied();if(d)return d;
  const {id}=await params;
  const b=await req.json();
  if(!['ai','human','paused'].includes(b.mode))return NextResponse.json({error:'Invalid mode'},{status:400});
  const c=await one<any>('SELECT id,channel,external_user_id FROM conversations WHERE id=?',[id]);
  if(!c)return NextResponse.json({error:'Not found'},{status:404});

  await db().execute(`UPDATE conversations SET mode=?,takeover_by=?,takeover_at=${b.mode==='human'?'NOW()':'NULL'} WHERE id=?`,[b.mode,b.mode==='human'?'admin':null,id]);
  await db().execute('INSERT INTO messages(conversation_id,sender,direction,message_type,body) VALUES(?,?,?,?,?)',[id,'system','outbound','text',b.mode==='human'?'Admin took over conversation.':b.mode==='ai'?'Conversation returned to AI.':'Conversation paused.']);

  // Critical catch-up: if a customer messaged while Human/Paused mode was active,
  // returning to AI must answer the newest still-unanswered customer message.
  let catchUp:{attempted:boolean;sent:boolean;message?:string}={attempted:false,sent:false};
  if(b.mode==='ai' && c.channel==='whatsapp'){
    const pending=await one<any>(`SELECT m.id,m.body,m.external_message_id
      FROM messages m
      WHERE m.conversation_id=? AND m.sender='customer' AND m.direction='inbound'
        AND m.id > COALESCE((SELECT MAX(x.id) FROM messages x WHERE x.conversation_id=? AND x.sender IN ('ai','human') AND x.direction='outbound'),0)
      ORDER BY m.id DESC LIMIT 1`,[id,id]);
    if(pending?.body){
      catchUp.attempted=true;
      try{
        if(!whatsappConfigured()) throw new Error('WhatsApp send credentials not configured');
        const reply=await salesReply(String(pending.body),Number(id));
        if(!reply) throw new Error('AI returned no reply');
        const waId=await sendWhatsApp(String(c.external_user_id),reply);
        await outbound(Number(id),'ai',reply,AI_MODEL);
        await agentEvent(Number(id),pending.external_message_id||null,'catch_up_reply','ok',{whatsapp_message_id:waId,chars:reply.length,trigger:'return_to_ai'});
        catchUp={attempted:true,sent:true};
      }catch(e:any){
        const msg=e?.response?.data||e?.message||String(e);
        await agentEvent(Number(id),pending.external_message_id||null,'catch_up_reply','failed',msg);
        catchUp={attempted:true,sent:false,message:typeof msg==='string'?msg:JSON.stringify(msg)};
      }
    }
  }

  return NextResponse.json({ok:true,mode:b.mode,catchUp});
}
