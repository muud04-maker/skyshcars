import { db, rows } from './db';

let ready: Promise<void> | null = null;
export function ensureAgentEvents(){
  if(!ready) ready=db().execute(`CREATE TABLE IF NOT EXISTS ai_agent_events(
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    conversation_id BIGINT UNSIGNED NULL,
    external_message_id VARCHAR(191) NULL,
    event_type VARCHAR(80) NOT NULL,
    status VARCHAR(40) NOT NULL,
    details TEXT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    INDEX(conversation_id,created_at), INDEX(external_message_id), INDEX(status,created_at)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`).then(()=>undefined).catch(e=>{ready=null;throw e});
  return ready;
}
export async function agentEvent(conversationId:number|null, externalMessageId:string|null, eventType:string, status:string, details?:unknown){
  try{
    await ensureAgentEvents();
    const text=details==null?null:(typeof details==='string'?details:JSON.stringify(details));
    await db().execute('INSERT INTO ai_agent_events(conversation_id,external_message_id,event_type,status,details) VALUES(?,?,?,?,?)',[conversationId,externalMessageId,eventType,status,text?.slice(0,12000)||null]);
  }catch(e){console.error('AGENT_EVENT_LOG',e)}
}
export async function recentAgentEvents(limit=100){
  await ensureAgentEvents();
  const n=Math.max(1,Math.min(500,limit));
  return rows<any>(`SELECT e.*,c.channel,c.external_user_id,cu.full_name FROM ai_agent_events e LEFT JOIN conversations c ON c.id=e.conversation_id LEFT JOIN customers cu ON cu.id=c.customer_id ORDER BY e.id DESC LIMIT ${n}`);
}
