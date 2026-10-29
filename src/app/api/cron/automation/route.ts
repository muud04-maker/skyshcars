import {runDueCampaigns} from '../../../../lib/automation';
import {processDueAiReplies} from '../../../../lib/ai-queue-worker';
import {reconcilePendingFacebookPublications} from '../../../../lib/social';
export const dynamic='force-dynamic';
// Campaigns + Part 6: return the AI to chats whose staff pause has just expired.
export async function GET(req:Request){
  const secret=process.env.AUTOMATION_CRON_SECRET||'';
  const given=req.headers.get('authorization')?.replace(/^Bearer\s+/i,'')||new URL(req.url).searchParams.get('secret')||'';
  if(!secret||given!==secret)return Response.json({error:'Unauthorized'},{status:401});
  // No timer-based AI auto-resume any more: the AI only answers after a NEW customer message.
  const [results,queued,publicationReconciliation]=await Promise.all([
    runDueCampaigns(),processDueAiReplies().catch(()=>[]),reconcilePendingFacebookPublications().catch(()=>[]),
  ]);
  return Response.json({ok:true,results,queued,publicationReconciliation});
}
