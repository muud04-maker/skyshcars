/* Admin-only analytics aggregates. No raw conversations or customer identifiers are returned. */
import {adminDenied} from '../../../../lib/admin-guard';
import {getAnalytics} from '../../../../lib/analytics';
export const dynamic='force-dynamic';

export async function GET(req:Request){
  const denied=await adminDenied();if(denied)return denied;
  const u=new URL(req.url);
  const report=await getAnalytics({range:u.searchParams.get('range')||'30d',from:u.searchParams.get('from')||'',to:u.searchParams.get('to')||''});
  return Response.json(report,{headers:{'cache-control':'no-store'}});
}
