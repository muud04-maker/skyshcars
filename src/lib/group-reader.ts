import {createHash,timingSafeEqual} from 'crypto';
import {db, one, rows} from './db';
export async function ensureGroupReaderSchema(){
 await db().execute(`CREATE TABLE IF NOT EXISTS whatsapp_group_sources(
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  group_name VARCHAR(191) NOT NULL,
  group_external_id VARCHAR(191) NULL,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  notes TEXT NULL,
  last_seen_at DATETIME NULL,
  last_message_id VARCHAR(191) NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_group_name(group_name), INDEX(enabled), INDEX(last_seen_at)
 ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
 await db().execute(`CREATE TABLE IF NOT EXISTS whatsapp_group_bridge_status(
  bridge_id VARCHAR(80) PRIMARY KEY,
  status VARCHAR(40) NOT NULL,
  whatsapp_account VARCHAR(191) NULL,
  visible_groups INT NULL,
  app_version VARCHAR(40) NULL,
  details TEXT NULL,
  last_heartbeat_at DATETIME NOT NULL,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
 ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
 // Default authorized inventory group from the existing Sky Cars workflow.
 await db().execute(`INSERT IGNORE INTO whatsapp_group_sources(group_name,enabled,notes) VALUES('SKy Cars motorcycles',1,'Primary Sky Cars inventory group')`);
}
export async function listGroupSources(){await ensureGroupReaderSchema();return rows<any>(`SELECT * FROM whatsapp_group_sources ORDER BY enabled DESC,group_name`)}
export async function listBridgeStatus(){await ensureGroupReaderSchema();return rows<any>(`SELECT * FROM whatsapp_group_bridge_status ORDER BY last_heartbeat_at DESC`)}
export async function enabledGroupNames(){await ensureGroupReaderSchema();const r=await rows<any>(`SELECT group_name,group_external_id FROM whatsapp_group_sources WHERE enabled=1 ORDER BY id`);return r}
export async function isGroupAllowed(groupName:string,groupId?:string|null){await ensureGroupReaderSchema();const n=String(groupName||'').trim();if(!n)return false;const r:any=await one(`SELECT id FROM whatsapp_group_sources WHERE enabled=1 AND (LOWER(group_name)=LOWER(?) OR (?<>'' AND group_external_id=?)) LIMIT 1`,[n,String(groupId||''),String(groupId||'')]);return !!r}
export async function touchGroup(groupName:string,messageId?:string|null,groupId?:string|null){await ensureGroupReaderSchema();await db().execute(`UPDATE whatsapp_group_sources SET last_seen_at=NOW(),last_message_id=COALESCE(?,last_message_id),group_external_id=COALESCE(NULLIF(?,''),group_external_id) WHERE LOWER(group_name)=LOWER(?)`,[messageId||null,groupId||'',groupName])}
export async function upsertBridgeHeartbeat(p:any){await ensureGroupReaderSchema();const id=String(p.bridgeId||'primary').slice(0,80);await db().execute(`INSERT INTO whatsapp_group_bridge_status(bridge_id,status,whatsapp_account,visible_groups,app_version,details,last_heartbeat_at) VALUES(?,?,?,?,?,?,NOW()) ON DUPLICATE KEY UPDATE status=VALUES(status),whatsapp_account=VALUES(whatsapp_account),visible_groups=VALUES(visible_groups),app_version=VALUES(app_version),details=VALUES(details),last_heartbeat_at=NOW()`,[id,String(p.status||'online').slice(0,40),p.whatsappAccount?String(p.whatsappAccount).slice(0,191):null,Number.isFinite(Number(p.visibleGroups))?Number(p.visibleGroups):null,String(p.version||'27').slice(0,40),JSON.stringify(p.details||{})]);return {ok:true}}
export async function saveGroupSource(p:any){await ensureGroupReaderSchema();const name=String(p.group_name||'').trim().slice(0,191);if(!name)throw new Error('Group name required');if(p.id){await db().execute(`UPDATE whatsapp_group_sources SET group_name=?,group_external_id=?,enabled=?,notes=? WHERE id=?`,[name,String(p.group_external_id||'').trim()||null,p.enabled?1:0,String(p.notes||'').trim()||null,Number(p.id)]);return {ok:true,id:Number(p.id)}}const [r]:any=await db().execute(`INSERT INTO whatsapp_group_sources(group_name,group_external_id,enabled,notes) VALUES(?,?,?,?)`,[name,String(p.group_external_id||'').trim()||null,p.enabled===false?0:1,String(p.notes||'').trim()||null]);return {ok:true,id:Number(r.insertId)}}
export async function deleteGroupSource(id:number){await ensureGroupReaderSchema();await db().execute(`DELETE FROM whatsapp_group_sources WHERE id=?`,[id]);return {ok:true}}

/** Constant-time check of the bridge's x-sky-secret header against WHATSAPP_SERVICE_SECRET. */
export function bridgeAuthorized(req:Request){
 const secret=String(process.env.WHATSAPP_SERVICE_SECRET||'');const given=String(req.headers.get('x-sky-secret')||'');
 if(!secret||!given)return false;
 const a=createHash('sha256').update(secret).digest(),b=createHash('sha256').update(given).digest();
 return timingSafeEqual(a,b);
}
/** Bridge health from the last heartbeat: online only if it reported "online" within 3 minutes. */
export function bridgeHealth(b:any){
 if(!b?.last_heartbeat_at)return {state:'never',online:false,minutes:null as number|null};
 const minutes=Math.floor((Date.now()-new Date(b.last_heartbeat_at).getTime())/60000);
 const online=minutes<3&&b.status==='online';
 return {state:minutes>=3?'stale':String(b.status||'unknown'),online,minutes};
}
