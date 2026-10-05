import {NextResponse} from 'next/server';
import {db,one} from '../../../../../../lib/db';
import {adminDenied} from '../../../../../../lib/admin-guard';
import {pauseAi,resumeAi,clearStaffFlag} from '../../../../../../lib/conversation-state';
import {runReplyEngine} from '../../../../../../lib/sales-engine';
import {staffPauseMinutes} from '../../../../../../lib/staff';

/*
  Take over (human) / Return to AI (ai) / Pause (AI paused for N minutes, then returns by itself).
  Returning to AI answers the customer's still-unanswered messages through the one reply engine
  (same reply rule, lock and welcome-once guarantee as the webhook).
*/
export async function POST(req:Request,{params}:{params:Promise<{id:string}>}){
  const d=await adminDenied();if(d)return d;
  const {id:raw}=await params;const id=Number(raw);
  const b=await req.json().catch(()=>({}));
  if(!['ai','human','paused'].includes(b.mode))return NextResponse.json({error:'Invalid mode'},{status:400});
  const c=await one<any>('SELECT id,channel FROM conversations WHERE id=?',[id]);
  if(!c)return NextResponse.json({error:'Not found'},{status:404});
  if(b.mode==='paused'){
    const minutes=Number(b.minutes)||await staffPauseMinutes();
    await db().execute(`UPDATE conversations SET mode='ai',takeover_by=NULL,takeover_at=NULL WHERE id=?`,[id]);
    await pauseAi(id,minutes,'admin');
    await db().execute('INSERT INTO messages(conversation_id,sender,direction,message_type,body) VALUES(?,?,?,?,?)',[id,'system','outbound','text',`AI paused for ${minutes} min.`]);
    return NextResponse.json({ok:true,mode:'paused',minutes});
  }
  await db().execute(`UPDATE conversations SET mode=?,takeover_by=?,takeover_at=${b.mode==='human'?'NOW()':'NULL'} WHERE id=?`,[b.mode,b.mode==='human'?'admin':null,id]);
  await db().execute('INSERT INTO messages(conversation_id,sender,direction,message_type,body) VALUES(?,?,?,?,?)',[id,'system','outbound','text',b.mode==='human'?'Admin took over conversation.':'Conversation returned to AI.']);
  let catchUp:any={attempted:false,sent:false};
  if(b.mode==='ai'){
    await resumeAi(id);await clearStaffFlag(id).catch(()=>{});
    const r=await runReplyEngine(id,{trigger:'catch_up'});
    catchUp={attempted:r.status!=='skipped'||r.reason!=='nothing_new',sent:r.status==='sent',message:r.status==='sent'?undefined:r.reason==='nothing_new'?'No unanswered customer message.':r.reason==='ack_only'?'The last customer message did not need a reply.':r.reason};
  }
  return NextResponse.json({ok:true,mode:b.mode,catchUp});
}
