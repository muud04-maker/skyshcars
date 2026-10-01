import { adminDenied } from '../../../../lib/admin-guard';
import { recentAgentEvents } from '../../../../lib/agent-events';
export const dynamic='force-dynamic';
export async function GET(req:Request){const d=await adminDenied();if(d)return d;const u=new URL(req.url);return Response.json({events:await recentAgentEvents(Number(u.searchParams.get('limit')||100))});}
