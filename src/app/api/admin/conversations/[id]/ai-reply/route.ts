import {NextResponse} from 'next/server';
import {one} from '../../../../../../lib/db';
import {adminDenied} from '../../../../../../lib/admin-guard';
import {runReplyEngine} from '../../../../../../lib/sales-engine';

/** "AI reply now": answers the latest customer messages immediately through the one reply engine. */
export async function POST(_:Request,{params}:{params:Promise<{id:string}>}){
  const d=await adminDenied();if(d)return d;
  const {id}=await params;
  const c=await one<any>('SELECT id,channel FROM conversations WHERE id=? LIMIT 1',[id]);
  if(!c)return NextResponse.json({error:'Conversation not found'},{status:404});
  const r=await runReplyEngine(Number(id),{trigger:'manual',force:true});
  if(r.status==='sent')return NextResponse.json({ok:true,sent:true,reply:r.reply});
  if(r.status==='failed')return NextResponse.json({error:r.reason||'Send failed'},{status:502});
  const why:any={nothing_new:'No customer message to answer.',human_mode:'The chat is in HUMAN mode. Return it to AI first.',locked:'The AI is already replying to this chat.',not_configured:'Sending needs setup (see Readiness).'};
  return NextResponse.json({ok:true,sent:false,message:why[r.reason||'']||r.reason});
}
