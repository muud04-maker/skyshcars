import {adminDenied} from '../../../../lib/admin-guard';
import {one,rows} from '../../../../lib/db';
import {whatsappConfigSummary} from '../../../../lib/meta';
import {ensureAgentEvents} from '../../../../lib/agent-events';
export const dynamic='force-dynamic';
export async function GET(){
  const d=await adminDenied();if(d)return d;
  await ensureAgentEvents();
  const config=whatsappConfigSummary();
  const lastInbound=await one<any>(`SELECT m.id,m.created_at,m.body,c.external_user_id,cu.full_name FROM messages m JOIN conversations c ON c.id=m.conversation_id LEFT JOIN customers cu ON cu.id=c.customer_id WHERE c.channel='whatsapp' AND m.sender='customer' AND m.direction='inbound' ORDER BY m.id DESC LIMIT 1`);
  const lastOutbound=await one<any>(`SELECT m.id,m.created_at,m.body,m.sender,m.delivery_status,c.external_user_id FROM messages m JOIN conversations c ON c.id=m.conversation_id WHERE c.channel='whatsapp' AND m.direction='outbound' AND m.sender IN ('ai','human') ORDER BY m.id DESC LIMIT 1`);
  const lastWebhook=await one<any>(`SELECT id,event_type,status,details,created_at FROM ai_agent_events WHERE event_type IN ('webhook_received','webhook_rejected','webhook_parse_error','webhook_message_error') ORDER BY id DESC LIMIT 1`);
  const lastReplyEvent=await one<any>(`SELECT id,event_type,status,details,created_at FROM ai_agent_events WHERE event_type IN ('reply','retry_reply','catch_up_reply','manual_ai_retry','human_reply') ORDER BY id DESC LIMIT 1`);
  const pending=await rows<any>(`SELECT co.id,co.external_user_id,co.mode,c.full_name,(SELECT body FROM messages z WHERE z.conversation_id=co.id AND z.sender='customer' ORDER BY z.id DESC LIMIT 1) body FROM conversations co LEFT JOIN customers c ON c.id=co.customer_id WHERE co.channel='whatsapp' AND (SELECT COALESCE(MAX(m1.id),0) FROM messages m1 WHERE m1.conversation_id=co.id AND m1.sender='customer' AND m1.direction='inbound') > (SELECT COALESCE(MAX(m2.id),0) FROM messages m2 WHERE m2.conversation_id=co.id AND m2.sender IN ('ai','human') AND m2.direction='outbound') ORDER BY co.last_message_at DESC LIMIT 25`);
  return Response.json({config,lastInbound,lastOutbound,lastWebhook,lastReplyEvent,pending,callbackUrl:`${process.env.NEXT_PUBLIC_SITE_URL||'https://skyshcars.com'}/api/whatsapp/webhook`});
}
