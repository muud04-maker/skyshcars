import {NextResponse} from 'next/server';
import {db,one} from '../../../../../../lib/db';
import {adminDenied} from '../../../../../../lib/admin-guard';
import {clearAiReply,pauseAi,resumeAi,clearStaffFlag} from '../../../../../../lib/conversation-state';
import {staffPauseMinutes} from '../../../../../../lib/staff';

/*
  Conversation modes (one clear source of truth):
    ai     = AI answers new customer messages (60s queue); staff may also reply (human wins).
    human  = TAKE OVER: human only, the AI stays completely silent.
    both   = AI available AND staff allowed to reply (human always wins).
    paused = the AI is paused for N minutes (kept for compatibility; not the main mechanism).

  Returning to AI / Both NEVER answers the old customer turn: the AI waits for the next customer
  message. Only the explicit "AI Reply Now" action answers the current unresolved turn.
*/
export async function POST(req:Request,{params}:{params:Promise<{id:string}>}){
  const d=await adminDenied();if(d)return d;
  const {id:raw}=await params;const id=Number(raw);
  const b=await req.json().catch(()=>({}));
  if(!['ai','human','paused','both'].includes(String(b.mode)))return NextResponse.json({error:'Invalid mode'},{status:400});
  const c=await one<any>('SELECT id,channel FROM conversations WHERE id=?',[id]);
  if(!c)return NextResponse.json({error:'Not found'},{status:404});
  const mode=String(b.mode);

  if(mode==='paused'){
    const minutes=Number(b.minutes)||await staffPauseMinutes();
    await db().execute(`UPDATE conversations SET mode='ai',takeover_by=NULL,takeover_at=NULL WHERE id=?`,[id]);
    await pauseAi(id,minutes,'admin');
    await clearAiReply(Number(id)).catch(()=>{});
    await db().execute('INSERT INTO messages(conversation_id,sender,direction,message_type,body) VALUES(?,?,?,?,?)',[id,'system','outbound','text',`AI paused for ${minutes} min.`]);
    return NextResponse.json({ok:true,mode:'paused',minutes});
  }

  // ai / both / human
  await db().execute(`UPDATE conversations SET mode=?,takeover_by=?,takeover_at=${mode==='human'?'NOW()':'NULL'} WHERE id=?`,[mode,mode==='human'?'admin':null,id]);
  if(mode==='ai'||mode==='both'){ await resumeAi(id).catch(()=>{}); await clearStaffFlag(id).catch(()=>{}); }
  // Any mode change cancels a queued AI reply: the AI only answers after the NEXT customer message.
  await clearAiReply(Number(id)).catch(()=>{});
  const note = mode==='human'?'Admin took over conversation.':mode==='both'?'Conversation set to BOTH (AI + staff).':'Conversation returned to AI.';
  await db().execute('INSERT INTO messages(conversation_id,sender,direction,message_type,body) VALUES(?,?,?,?,?)',[id,'system','outbound','text',note]);
  // No catch-up reply: waiting for the customer is the required behaviour after Return to AI / Both.
  return NextResponse.json({ok:true,mode,catchUp:{attempted:false,sent:false,message:mode==='human'?'Human takeover active - the AI is silent.':'Waiting for the next customer message.'}});
}
