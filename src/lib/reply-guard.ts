import { db } from './db';

async function ensureTable(){
  await db().execute(`CREATE TABLE IF NOT EXISTS whatsapp_reply_guard(
    inbound_key VARCHAR(191) PRIMARY KEY,
    conversation_id BIGINT UNSIGNED NOT NULL,
    trigger_name VARCHAR(64) NULL,
    status ENUM('processing','sent','failed') NOT NULL DEFAULT 'processing',
    whatsapp_message_id VARCHAR(191) NULL,
    error_text TEXT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX(conversation_id,status,updated_at)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
  // 'skipped' = intentionally not sent (newer customer message or admin takeover); not a failure.
  if(!skippedReady)skippedReady=db().execute(`ALTER TABLE whatsapp_reply_guard MODIFY status ENUM('processing','sent','failed','skipped') NOT NULL DEFAULT 'processing'`).then(()=>undefined).catch((e:any)=>{skippedReady=null;throw e});
  await skippedReady;
}
let skippedReady:Promise<void>|null=null;

export async function markReplySkipped(inboundKey:string, reason:string){
  if(!inboundKey) return;
  await ensureTable();
  await db().execute(`UPDATE whatsapp_reply_guard SET status='skipped',error_text=? WHERE inbound_key=?`,[reason.slice(0,500),inboundKey]);
}

export async function claimReply(inboundKey:string, conversationId:number, trigger:string, allowFailedRetry=false){
  if(!inboundKey) return false;
  await ensureTable();
  const [r]:any=await db().execute(`INSERT IGNORE INTO whatsapp_reply_guard(inbound_key,conversation_id,trigger_name,status) VALUES(?,?,?,'processing')`,[inboundKey,conversationId,trigger]);
  if(Number(r?.affectedRows||0)===1) return true;
  if(!allowFailedRetry) return false;
  const [u]:any=await db().execute(`UPDATE whatsapp_reply_guard SET status='processing',trigger_name=?,error_text=NULL WHERE inbound_key=? AND status IN ('failed','skipped')`,[trigger,inboundKey]);
  return Number(u?.affectedRows||0)===1;
}

export async function markReplySent(inboundKey:string, whatsappMessageId?:string|null){
  if(!inboundKey) return;
  await ensureTable();
  await db().execute(`UPDATE whatsapp_reply_guard SET status='sent',whatsapp_message_id=?,error_text=NULL WHERE inbound_key=?`,[whatsappMessageId||null,inboundKey]);
}

export async function markReplyFailed(inboundKey:string, error:any){
  if(!inboundKey) return;
  await ensureTable();
  const text=typeof error==='string'?error:JSON.stringify(error);
  await db().execute(`UPDATE whatsapp_reply_guard SET status='failed',error_text=? WHERE inbound_key=?`,[String(text||'Unknown failure').slice(0,8000),inboundKey]);
}
