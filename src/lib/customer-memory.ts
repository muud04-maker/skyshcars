import axios from 'axios';
import { db, one, rows } from './db';
import { history } from './conversations';

const MODEL = process.env.DEEPSEEK_MODEL || 'deepseek-chat';

export async function ensureCustomerMemorySchema(){
  await db().execute(`CREATE TABLE IF NOT EXISTS customer_memory (
    customer_id BIGINT UNSIGNED PRIMARY KEY,
    summary TEXT NULL,
    preferences_json JSON NULL,
    last_vehicle_id BIGINT UNSIGNED NULL,
    last_stock_no VARCHAR(60) NULL,
    message_count INT NOT NULL DEFAULT 0,
    summarized_through_message_id BIGINT UNSIGNED NULL,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY(customer_id) REFERENCES customers(id) ON DELETE CASCADE,
    INDEX(last_vehicle_id), INDEX(updated_at)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
}

export async function memoryForConversation(conversationId:number){
  await ensureCustomerMemorySchema();
  return one<any>(`SELECT cm.* FROM conversations c LEFT JOIN customer_memory cm ON cm.customer_id=c.customer_id WHERE c.id=? LIMIT 1`,[conversationId]);
}

export async function refreshCustomerMemory(conversationId:number){
  if(!process.env.DEEPSEEK_API_KEY) return null;
  await ensureCustomerMemorySchema();
  const conv:any = await one(`SELECT customer_id FROM conversations WHERE id=? LIMIT 1`,[conversationId]);
  if(!conv?.customer_id) return null;
  const msgs = await rows<any>(`SELECT m.id,m.sender,m.body FROM messages m JOIN conversations cx ON cx.id=m.conversation_id WHERE cx.customer_id=? AND m.sender IN ('customer','human','ai') ORDER BY m.id DESC LIMIT 300`,[conv.customer_id]);
  if(!msgs.length) return null;
  const newestId = Number(msgs[0].id||0);
  const current:any = await one(`SELECT * FROM customer_memory WHERE customer_id=?`,[conv.customer_id]);
  if(current && Number(current.summarized_through_message_id||0) >= newestId) return current;
  const transcript = msgs.reverse().map(m=>`${m.sender.toUpperCase()}: ${String(m.body||'')}`).join('\n');
  const prompt = `Read this Sky Cars sales conversation and return ONLY compact JSON with keys: summary, preferred_brands (array), preferred_models (array), budget_usd (number|null), destination_country (string|null), destination_port (string|null), preferred_language (string|null), last_vehicle_stock_no (string|null), purchase_intent (string|null). Do not invent facts. Preserve human staff decisions. Conversation:\n${transcript}`;
  try{
    const r = await axios.post('https://api.deepseek.com/chat/completions',{model:MODEL,temperature:0,max_tokens:500,messages:[{role:'user',content:prompt}]},{headers:{Authorization:`Bearer ${process.env.DEEPSEEK_API_KEY}`,'Content-Type':'application/json'},timeout:20000});
    let text=String(r.data.choices?.[0]?.message?.content||'').trim().replace(/^```json\s*/i,'').replace(/```$/,'').trim();
    const parsed=JSON.parse(text);
    const stock=String(parsed.last_vehicle_stock_no||'').trim()||null;
    let lastVehicleId:any=null;
    if(stock){ const v:any=await one('SELECT id FROM vehicles WHERE stock_no=? LIMIT 1',[stock]); lastVehicleId=v?.id||null; }
    await db().execute(`INSERT INTO customer_memory(customer_id,summary,preferences_json,last_vehicle_id,last_stock_no,message_count,summarized_through_message_id)
      VALUES(?,?,?,?,?,?,?) ON DUPLICATE KEY UPDATE summary=VALUES(summary),preferences_json=VALUES(preferences_json),last_vehicle_id=VALUES(last_vehicle_id),last_stock_no=VALUES(last_stock_no),message_count=VALUES(message_count),summarized_through_message_id=VALUES(summarized_through_message_id)`,
      [conv.customer_id,String(parsed.summary||'').slice(0,4000)||null,JSON.stringify(parsed),lastVehicleId,stock,msgs.length,newestId]);
    return {summary:parsed.summary,preferences_json:parsed,last_vehicle_id:lastVehicleId,last_stock_no:stock};
  }catch(e){console.error('CUSTOMER_MEMORY_REFRESH',e);return current||null;}
}
