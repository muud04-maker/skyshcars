import {runDueCampaigns} from '../../../../lib/automation';
import {sweepDuePauses} from '../../../../lib/sales-engine';
import {processDueAiReplies} from '../../../../lib/ai-queue-worker';
export const dynamic='force-dynamic';
// Campaigns + Part 6: return the AI to chats whose staff pause has just expired.
export async function GET(req:Request){
  const secret=process.env.AUTOMATION_CRON_SECRET||'';
  const given=req.headers.get('authorization')?.replace(/^Bearer\s+/i,'')||new URL(req.url).searchParams.get('secret')||'';
  if(!secret||given!==secret)return Response.json({error:'Unauthorized'},{status:401});
  const [results,pauses,queued]=await Promise.all([runDueCampaigns(),sweepDuePauses().catch(()=>[]),processDueAiReplies().catch(()=>[])]);
  return Response.json({ok:true,results,pauses,queued});
}
