import {db, one, rows} from './db';
import {publishVehicleToFacebook, publishVehicleToActiveWhatsAppChats} from './social';
import {deliverNewVehicleToWhatsApp} from './whatsapp-delivery';

export type AutomationSettings={
  enabled:boolean;
  require_approval:boolean;
  facebook_auto:boolean;
  whatsapp_auto:boolean;
  group_reader_enabled:boolean;
  auto_on_manual_publish:boolean;
  auto_on_group_approval:boolean;
  auto_on_supplier_publish:boolean;
  whatsapp_active_window_only:boolean;
  max_whatsapp_recipients_per_vehicle:number;
};
const DEFAULTS:AutomationSettings={
  enabled:true, require_approval:true, facebook_auto:true, whatsapp_auto:false,
  group_reader_enabled:true, auto_on_manual_publish:true, auto_on_group_approval:true,
  auto_on_supplier_publish:false, whatsapp_active_window_only:true, max_whatsapp_recipients_per_vehicle:50
};

export async function ensureAutomationSchema(){
  await db().execute(`CREATE TABLE IF NOT EXISTS automation_campaigns(
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    vehicle_id BIGINT UNSIGNED NULL,
    reason VARCHAR(80) NOT NULL DEFAULT 'new_vehicle',
    title VARCHAR(191) NOT NULL,
    message TEXT NULL,
    channels JSON NOT NULL,
    audience JSON NULL,
    status ENUM('draft','approved','sending','sent','failed','cancelled') NOT NULL DEFAULT 'draft',
    scheduled_at DATETIME NULL, sent_at DATETIME NULL, last_error TEXT NULL,
    created_by VARCHAR(191) NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX(status,scheduled_at), INDEX(vehicle_id),
    FOREIGN KEY(vehicle_id) REFERENCES vehicles(id) ON DELETE SET NULL
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
  await db().execute(`CREATE TABLE IF NOT EXISTS automation_campaign_deliveries(
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    campaign_id BIGINT UNSIGNED NOT NULL,
    channel VARCHAR(40) NOT NULL,
    recipient VARCHAR(191) NULL,
    status ENUM('sent','skipped','failed') NOT NULL,
    details TEXT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    INDEX(campaign_id), INDEX(channel,status),
    FOREIGN KEY(campaign_id) REFERENCES automation_campaigns(id) ON DELETE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
  await db().execute(`CREATE TABLE IF NOT EXISTS automation_events(
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    event_type VARCHAR(80) NOT NULL,
    entity_type VARCHAR(80) NULL,
    entity_id VARCHAR(191) NULL,
    status VARCHAR(40) NOT NULL,
    details TEXT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    INDEX(created_at), INDEX(event_type,status)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
  // Safe additive migration for existing installations.
  try{await db().execute(`ALTER TABLE customers ADD COLUMN marketing_opt_in BOOLEAN NOT NULL DEFAULT FALSE`)}catch{}
  try{await db().execute(`ALTER TABLE customers ADD COLUMN marketing_opt_in_at DATETIME NULL`)}catch{}
  try{await db().execute(`ALTER TABLE customers ADD COLUMN marketing_opt_out_at DATETIME NULL`)}catch{}
}

export async function getAutomationSettings():Promise<AutomationSettings>{
  await ensureAutomationSchema();
  try{const r:any=await one(`SELECT setting_value FROM business_settings WHERE setting_key='automation_v27'`);const v=typeof r?.setting_value==='string'?JSON.parse(r.setting_value):r?.setting_value;return {...DEFAULTS,...(v||{})}}catch{return DEFAULTS}
}
export async function saveAutomationSettings(p:Partial<AutomationSettings>){
  const next={...(await getAutomationSettings()),...p};
  next.max_whatsapp_recipients_per_vehicle=Math.max(1,Math.min(200,Number(next.max_whatsapp_recipients_per_vehicle||50)));
  await db().execute(`INSERT INTO business_settings(setting_key,setting_value) VALUES('automation_v27',?) ON DUPLICATE KEY UPDATE setting_value=VALUES(setting_value),updated_at=CURRENT_TIMESTAMP`,[JSON.stringify(next)]);
  return next;
}
export async function automationEvent(event_type:string,status:string,details:any={},entity_type?:string,entity_id?:any){
  await ensureAutomationSchema();
  await db().execute(`INSERT INTO automation_events(event_type,entity_type,entity_id,status,details) VALUES(?,?,?,?,?)`,[event_type,entity_type||null,entity_id==null?null:String(entity_id),status,typeof details==='string'?details:JSON.stringify(details||{})]);
}

function vehicleTitle(v:any){return `${v.model_year||''} ${v.brand||''} ${v.model||''}`.replace(/\s+/g,' ').trim()||`Vehicle ${v.stock_no||''}`}
export async function queueVehicleCampaign(vehicleId:number,reason='new_vehicle',createdBy='system'){
  await ensureAutomationSchema();
  const v:any=await one(`SELECT id,stock_no,brand,model,model_year,price_usd,status FROM vehicles WHERE id=? LIMIT 1`,[vehicleId]);
  if(!v||v.status!=='available')return {ok:false,skipped:'Vehicle is not available'};
  const existing:any=await one(`SELECT id,status FROM automation_campaigns WHERE vehicle_id=? AND reason=? AND status IN ('draft','approved','sending','sent') ORDER BY id DESC LIMIT 1`,[vehicleId,reason]);
  if(existing)return {ok:true,campaignId:existing.id,skipped:'Campaign already exists'};
  const settings=await getAutomationSettings();
  const channels={facebook:!!settings.facebook_auto,whatsapp:!!settings.whatsapp_auto};
  const [r]:any=await db().execute(`INSERT INTO automation_campaigns(vehicle_id,reason,title,channels,audience,status,created_by) VALUES(?,?,?,?,?,'draft',?)`,[vehicleId,reason,`New arrival: ${vehicleTitle(v)}`,JSON.stringify(channels),JSON.stringify({whatsapp:'opted_in_active_24h'}),createdBy]);
  await automationEvent('campaign_queued','ok',{reason,channels},'vehicle',vehicleId);
  return {ok:true,campaignId:Number(r.insertId)};
}

export async function listCampaigns(limit=100){await ensureAutomationSchema();return rows<any>(`SELECT c.*,v.stock_no,v.brand,v.model,v.model_year,v.price_usd FROM automation_campaigns c LEFT JOIN vehicles v ON v.id=c.vehicle_id ORDER BY c.id DESC LIMIT ${Math.max(1,Math.min(300,Number(limit)||100))}`)}
export async function listAutomationEvents(){await ensureAutomationSchema();return rows<any>(`SELECT * FROM automation_events ORDER BY id DESC LIMIT 100`)}

export async function dispatchCampaign(id:number){
  await ensureAutomationSchema();
  const c:any=await one(`SELECT * FROM automation_campaigns WHERE id=? LIMIT 1`,[id]);
  if(!c)throw new Error('Campaign not found');
  if(c.status==='sent')return {ok:true,skipped:'Already sent'};
  const channels=typeof c.channels==='string'?JSON.parse(c.channels||'{}'):(c.channels||{});
  await db().execute(`UPDATE automation_campaigns SET status='sending',last_error=NULL WHERE id=?`,[id]);
  const result:any={};let anyOk=false;let errors:string[]=[];const notes:string[]=[];
  try{
    if(channels.facebook&&c.vehicle_id){const r:any=await publishVehicleToFacebook(Number(c.vehicle_id));result.facebook=r;anyOk=anyOk||!!r?.ok;if(!r?.ok&&!r?.skipped)errors.push('Facebook failed: '+String(r?.error||'unknown'));if(!r?.ok&&r?.skipped)notes.push('Facebook skipped: '+r.skipped)}
    if(channels.whatsapp&&c.vehicle_id){const r:any=await publishVehicleToActiveWhatsAppChats(Number(c.vehicle_id));result.whatsapp=r;anyOk=anyOk||!!r?.ok;if(!r?.ok&&!r?.skipped)errors.push('WhatsApp failed')}
    const finalStatus=(anyOk||(!channels.facebook&&!channels.whatsapp))?'sent':(errors.length?'failed':'sent');
    await db().execute(`UPDATE automation_campaigns SET status=?,sent_at=IF(?='sent',NOW(),sent_at),last_error=? WHERE id=?`,[finalStatus,finalStatus,[...errors,...notes].join('; ')||null,id]);
    await automationEvent('campaign_dispatch',finalStatus,result,'campaign',id);
    return {ok:finalStatus==='sent',result};
  }catch(e:any){await db().execute(`UPDATE automation_campaigns SET status='failed',last_error=? WHERE id=?`,[String(e?.message||e).slice(0,2000),id]);await automationEvent('campaign_dispatch','failed',String(e?.message||e),'campaign',id);throw e}
}

export async function handleVehiclePublished(vehicleId:number,source:'manual'|'group'|'supplier'='manual'){
  const whatsappDelivery=await deliverNewVehicleToWhatsApp(vehicleId).catch((error:any)=>({
    ok:false,state:'failed',error:String(error?.message||error).slice(0,500)
  }));
  const s=await getAutomationSettings();if(!s.enabled)return {ok:true,skipped:'Automation disabled',whatsapp_delivery:whatsappDelivery};
  const allow=source==='group'?s.auto_on_group_approval:source==='supplier'?s.auto_on_supplier_publish:s.auto_on_manual_publish;
  if(!allow)return {ok:true,skipped:`Automation disabled for ${source}`,whatsapp_delivery:whatsappDelivery};
  const q:any=await queueVehicleCampaign(vehicleId,source==='group'?'group_approved':source==='supplier'?'supplier_published':'new_vehicle');
  if(!q?.campaignId)return {...q,whatsapp_delivery:whatsappDelivery};
  if(s.require_approval)return {...q,queued:true,whatsapp_delivery:whatsappDelivery};
  return {...await dispatchCampaign(Number(q.campaignId)),whatsapp_delivery:whatsappDelivery};
}

export async function updateCampaign(id:number,p:any){
  await ensureAutomationSchema();const sets:string[]=[],vals:any[]=[];
  if(p.status&&['draft','approved','cancelled'].includes(String(p.status))){sets.push('status=?');vals.push(String(p.status))}
  if(p.title!==undefined){sets.push('title=?');vals.push(String(p.title).slice(0,191))}
  if(p.message!==undefined){sets.push('message=?');vals.push(String(p.message).slice(0,5000))}
  if(p.channels){sets.push('channels=?');vals.push(JSON.stringify({facebook:!!p.channels.facebook,whatsapp:!!p.channels.whatsapp}))}
  if(p.scheduled_at!==undefined){sets.push('scheduled_at=?');vals.push(p.scheduled_at||null)}
  if(sets.length)await db().execute(`UPDATE automation_campaigns SET ${sets.join(',')} WHERE id=?`,[...vals,id]);return {ok:true};
}
export async function runDueCampaigns(){await ensureAutomationSchema();const due=await rows<any>(`SELECT id FROM automation_campaigns WHERE status='approved' AND scheduled_at IS NOT NULL AND scheduled_at<=NOW() ORDER BY scheduled_at LIMIT 25`);const out=[];for(const x of due){try{out.push({id:x.id,...await dispatchCampaign(Number(x.id))})}catch(e:any){out.push({id:x.id,ok:false,error:String(e?.message||e)})}}return out}
