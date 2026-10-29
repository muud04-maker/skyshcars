import {createHash,randomUUID,timingSafeEqual} from 'crypto';
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
 await db().execute(`CREATE TABLE IF NOT EXISTS whatsapp_group_checkpoints(
  bridge_id VARCHAR(80) NOT NULL,
  group_id VARCHAR(191) NOT NULL,
  group_name VARCHAR(191) NULL,
  last_message_id VARCHAR(191) NULL,
  last_message_timestamp BIGINT NULL,
  last_successful_sync_at DATETIME NULL,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY(bridge_id,group_id),
  INDEX(last_successful_sync_at)
 ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
 await db().execute(`CREATE TABLE IF NOT EXISTS whatsapp_sync_runs(
  run_id VARCHAR(80) PRIMARY KEY,
  bridge_id VARCHAR(80) NOT NULL,
  group_id VARCHAR(191) NULL,
  group_name VARCHAR(191) NULL,
  state ENUM('running','succeeded','failed','interrupted') NOT NULL DEFAULT 'running',
  messages_received INT UNSIGNED NOT NULL DEFAULT 0,
  media_received INT UNSIGNED NOT NULL DEFAULT 0,
  website_saved BOOLEAN NOT NULL DEFAULT FALSE,
  started_at DATETIME NOT NULL,
  finished_at DATETIME NULL,
  error VARCHAR(1000) NULL,
  details JSON NULL,
  INDEX(bridge_id,started_at), INDEX(state,started_at)
 ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
 await db().execute(`CREATE TABLE IF NOT EXISTS whatsapp_group_sync_requests(
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  request_id VARCHAR(80) NOT NULL UNIQUE,
  bridge_id VARCHAR(80) NOT NULL,
  requested_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  claimed_at DATETIME NULL,
  completed_at DATETIME NULL,
  state ENUM('pending','claimed','completed','failed') NOT NULL DEFAULT 'pending',
  error VARCHAR(1000) NULL,
  INDEX(bridge_id,state,requested_at)
 ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
 // Default authorized inventory group from the existing Sky Cars workflow.
 await db().execute(`INSERT IGNORE INTO whatsapp_group_sources(group_name,enabled,notes) VALUES('Sky cars motorcycles',1,'Primary Sky Cars inventory group')`);
 await db().execute(`UPDATE whatsapp_group_sources SET group_external_id='120363429404519527@g.us'
   WHERE LOWER(group_name)=LOWER('Sky cars motorcycles') AND (group_external_id IS NULL OR group_external_id='')`);
}
export async function listGroupSources(){await ensureGroupReaderSchema();return rows<any>(`SELECT * FROM whatsapp_group_sources ORDER BY enabled DESC,group_name`)}
export async function listBridgeStatus(){await ensureGroupReaderSchema();return rows<any>(`SELECT * FROM whatsapp_group_bridge_status ORDER BY last_heartbeat_at DESC`)}
export async function enabledGroupNames(){await ensureGroupReaderSchema();const r=await rows<any>(`SELECT group_name,group_external_id FROM whatsapp_group_sources WHERE enabled=1 ORDER BY id`);return r}
export async function isGroupAllowed(groupName:string,groupId?:string|null){
  await ensureGroupReaderSchema();
  const n=String(groupName||'').trim(),gid=String(groupId||'').trim();
  if(!n)return false;
  const r:any=await one(`SELECT id,group_external_id FROM whatsapp_group_sources WHERE enabled=1
    AND ((group_external_id<>'' AND group_external_id=?) OR LOWER(group_name)=LOWER(?)) LIMIT 1`,[gid,n]);
  if(!r)return false;
  // Once a group has been discovered and pinned, only that exact WhatsApp ID is accepted.
  // A renamed or lookalike group cannot inherit access merely by using the same display name.
  const pinned=String(r.group_external_id||'').trim();
  return pinned?!!gid&&pinned===gid:true;
}
export async function touchGroup(groupName:string,messageId?:string|null,groupId?:string|null){
  await ensureGroupReaderSchema();
  const n=String(groupName||'').trim(),gid=String(groupId||'').trim();
  await db().execute(`UPDATE whatsapp_group_sources SET last_seen_at=NOW(),last_message_id=COALESCE(?,last_message_id),
    group_external_id=COALESCE(NULLIF(group_external_id,''),NULLIF(?,''))
    WHERE enabled=1 AND ((group_external_id<>'' AND group_external_id=?) OR ((group_external_id IS NULL OR group_external_id='') AND LOWER(group_name)=LOWER(?)))`,
    [messageId||null,gid,gid,n]);
}
/**
 * Pin an authorized group's WhatsApp ID after a linked device reports its chats.
 * Matching is deliberately exact and unique: an ambiguous display name is never pinned.
 */
export async function discoverAndLockGroups(candidates:any[]){
  await ensureGroupReaderSchema();
  const seen=(Array.isArray(candidates)?candidates:[]).map(x=>({
    id:String(x?.id||'').trim(),
    name:String(x?.name||'').trim(),
  })).filter(x=>x.id&&x.name);
  const configured=await rows<any>(`SELECT id,group_name,group_external_id FROM whatsapp_group_sources WHERE enabled=1 ORDER BY id`);
  const results:any[]=[];
  for(const group of configured){
    const name=String(group.group_name||'').trim().toLowerCase();
    const current=String(group.group_external_id||'').trim();
    const matches=seen.filter(x=>x.name.trim().toLowerCase()===name);
    if(current){
      results.push({group_name:group.group_name,group_external_id:current,status:matches.some(x=>x.id===current)?'locked':'configured_id_not_visible'});
      continue;
    }
    if(matches.length===1){
      const [u]:any=await db().execute(`UPDATE whatsapp_group_sources SET group_external_id=? WHERE id=? AND (group_external_id IS NULL OR group_external_id='')`,[matches[0].id,group.id]);
      results.push({group_name:group.group_name,group_external_id:matches[0].id,status:Number(u.affectedRows)?'locked':'already_locked'});
    }else{
      results.push({group_name:group.group_name,group_external_id:null,status:matches.length?'ambiguous_name':'not_found'});
    }
  }
  return results;
}
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

function safeJson(value:any){
  if(value===null||value===undefined)return {};
  if(typeof value==='object')return value;
  try{return JSON.parse(String(value))}catch{return{}}
}

export async function saveSyncCheckpoint(p:any){
  await ensureGroupReaderSchema();
  const bridgeId=String(p.bridgeId||'primary').slice(0,80);
  const groupId=String(p.groupId||'').trim().slice(0,191);
  if(!groupId)throw new Error('groupId is required');
  const timestamp=Number(p.lastMessageTimestamp);
  await db().execute(`INSERT INTO whatsapp_group_checkpoints(
    bridge_id,group_id,group_name,last_message_id,last_message_timestamp,last_successful_sync_at
  ) VALUES(?,?,?,?,?,IF(?=1,NOW(),NULL))
  ON DUPLICATE KEY UPDATE group_name=COALESCE(VALUES(group_name),group_name),
    last_message_id=COALESCE(VALUES(last_message_id),last_message_id),
    last_message_timestamp=GREATEST(COALESCE(last_message_timestamp,0),COALESCE(VALUES(last_message_timestamp),0)),
    last_successful_sync_at=IF(?=1,NOW(),last_successful_sync_at)`,
  [bridgeId,groupId,String(p.groupName||'').slice(0,191)||null,String(p.lastMessageId||'').slice(0,191)||null,
    Number.isFinite(timestamp)?Math.floor(timestamp):null,p.success===true?1:0,p.success===true?1:0]);
  return {ok:true};
}

export async function groupReaderCheckpoints(bridgeId='primary'){
  await ensureGroupReaderSchema();
  return rows<any>('SELECT * FROM whatsapp_group_checkpoints WHERE bridge_id=? ORDER BY group_id',[String(bridgeId).slice(0,80)]);
}

export async function startSyncRun(p:any){
  await ensureGroupReaderSchema();
  const runId=String(p.runId||randomUUID()).slice(0,80);
  const bridgeId=String(p.bridgeId||'primary').slice(0,80);
  await db().execute(`INSERT INTO whatsapp_sync_runs(run_id,bridge_id,group_id,group_name,state,started_at,details)
    VALUES(?,?,?,?, 'running',NOW(),?) ON DUPLICATE KEY UPDATE state='running',finished_at=NULL,error=NULL`,
  [runId,bridgeId,String(p.groupId||'').slice(0,191)||null,String(p.groupName||'').slice(0,191)||null,JSON.stringify(p.details||{})]);
  return {ok:true,runId};
}

/**
 * A run is succeeded only when the bridge explicitly proves that all received data reached the
 * website. `websiteSaved=false` or `mediaComplete=false` is recorded as failed, never silently green.
 */
export async function finishSyncRun(p:any){
  await ensureGroupReaderSchema();
  const runId=String(p.runId||'').slice(0,80),bridgeId=String(p.bridgeId||'primary').slice(0,80);
  if(!runId)throw new Error('runId is required');
  const success=p.success===true&&p.websiteSaved===true&&p.mediaComplete!==false;
  const state=success?'succeeded':(p.interrupted?'interrupted':'failed');
  const error=success?null:String(p.error||'Required messages/media were not confirmed as saved').slice(0,1000);
  await db().execute(`INSERT INTO whatsapp_sync_runs(run_id,bridge_id,group_id,group_name,state,messages_received,media_received,
      website_saved,started_at,finished_at,error,details)
    VALUES(?,?,?,?,?,?,?,?,COALESCE(?,NOW()),NOW(),?,?)
    ON DUPLICATE KEY UPDATE state=VALUES(state),messages_received=GREATEST(messages_received,VALUES(messages_received)),
      media_received=GREATEST(media_received,VALUES(media_received)),website_saved=VALUES(website_saved),
      finished_at=NOW(),error=VALUES(error),details=VALUES(details)`,
  [runId,bridgeId,String(p.groupId||'').slice(0,191)||null,String(p.groupName||'').slice(0,191)||null,state,
    Math.max(0,Number(p.messagesReceived)||0),Math.max(0,Number(p.mediaReceived)||0),p.websiteSaved===true?1:0,
    p.startedAt?new Date(String(p.startedAt)):null,error,JSON.stringify(p.details||{})]);
  if(success){
    const checkpoint=p.checkpoint||{};
    if(checkpoint.groupId){
      await saveSyncCheckpoint({bridgeId,groupId:checkpoint.groupId,groupName:checkpoint.groupName,
        lastMessageId:checkpoint.lastMessageId,lastMessageTimestamp:checkpoint.lastMessageTimestamp,success:true});
    }
    await db().execute(`UPDATE whatsapp_group_sync_requests SET state='completed',completed_at=NOW()
      WHERE bridge_id=? AND state IN ('pending','claimed')`,[bridgeId]);
  }
  return {ok:true,runId,state};
}

export async function requestManualSync(bridgeId='primary'){
  await ensureGroupReaderSchema();
  const requestId=randomUUID();
  await db().execute(`INSERT INTO whatsapp_group_sync_requests(request_id,bridge_id,state) VALUES(?,?,'pending')`,
    [requestId,String(bridgeId||'primary').slice(0,80)]);
  return {ok:true,requestId,status:'pending'};
}

export async function pendingManualSync(bridgeId='primary'){
  await ensureGroupReaderSchema();
  await db().execute(`UPDATE whatsapp_group_sync_requests SET state='pending',claimed_at=NULL
    WHERE bridge_id=? AND state='claimed' AND claimed_at < (NOW() - INTERVAL 10 MINUTE)`,[String(bridgeId||'primary').slice(0,80)]);
  const row:any=await one<any>(`SELECT request_id,requested_at FROM whatsapp_group_sync_requests
    WHERE bridge_id=? AND state='pending' ORDER BY id LIMIT 1`,[String(bridgeId||'primary').slice(0,80)]);
  if(!row)return null;
  await db().execute("UPDATE whatsapp_group_sync_requests SET state='claimed',claimed_at=NOW() WHERE request_id=? AND state='pending'",[row.request_id]);
  return {requestId:row.request_id,requestedAt:row.requested_at};
}

export async function syncRunStatus(bridgeId:string='primary'){
  await ensureGroupReaderSchema();
  return rows<any>('SELECT * FROM whatsapp_sync_runs WHERE bridge_id=? ORDER BY started_at DESC LIMIT 30',[String(bridgeId)]);
}

export async function nextScheduledSync(){
  const now=new Date();
  const next=new Date(now);
  next.setUTCMinutes(0,0,0);
  if(next<=now)next.setUTCHours(next.getUTCHours()+1);
  return next.toISOString();
}

export async function groupReaderDashboard(){
  await ensureGroupReaderSchema();
  const [groups,bridges,runs,latest,counts,changes]=await Promise.all([
    listGroupSources(),listBridgeStatus(),syncRunStatus('primary'),
    one<any>(`SELECT MAX(created_at) at FROM whatsapp_sync_runs WHERE state='succeeded'`).catch(()=>null),
    one<any>(`SELECT
      SUM(match_status='new') new_vehicles,
      SUM(match_status='confirmed') existing_vehicles,
      SUM(match_status='possible') possible_duplicates,
      SUM(review_status='pending') pending_review
      FROM inventory_import_items WHERE source='whatsapp_group'`).catch(()=>null),
    one<any>(`SELECT SUM(change_type='price_change' AND status='pending') price_updates,
      SUM(change_type='additional_photo' AND status='pending') additional_photos,
      SUM(change_type='availability_change' AND status='pending') availability_updates
      FROM inventory_change_proposals`).catch(()=>null),
  ]);
  const publications=await one<any>(`SELECT SUM(status='sent') published,SUM(status='failed') failed FROM social_publish_log`).catch(()=>null);
  const bridge=bridges[0]||null;
  const bridgeDetails=safeJson(bridge?.details);
  const scheduled=Number(bridgeDetails.readerWindowMinutes)>0;
  return {
    groups,bridges,
    health:{bridge:bridgeHealth(bridge),lastSuccessfulSync:latest?.at||null,nextScheduledSync:scheduled?nextScheduledSync():null,
      schedule:scheduled?'10 minutes at the top of each hour via the external VPS timer':'Persistent external reader; no bounded schedule is currently reported'},
    stats:{newVehicles:Number(counts?.new_vehicles||0),existingVehicles:Number(counts?.existing_vehicles||0),
      possibleDuplicates:Number(counts?.possible_duplicates||0),pendingApproval:Number(counts?.pending_review||0),
      priceUpdates:Number(changes?.price_updates||0),additionalPhotos:Number(changes?.additional_photos||0),
      availabilityUpdates:Number(changes?.availability_updates||0),publishedVehicles:Number(publications?.published||0),
      failedPublications:Number(publications?.failed||0)},
    runs,
  };
}
