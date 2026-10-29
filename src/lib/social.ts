import axios from 'axios';
import { db, one, rows } from './db';
import { sendWhatsApp, sendWhatsAppImage, whatsappConfigured } from './meta';
import { outbound } from './conversations';
import { exactPhotoSql, sellableVehicleSql } from './exact-photos';
import { GRAPH as FB_GRAPH, fbPageId, facebookConfigured, graphError, resolvePageToken } from './facebook';

const SITE = (process.env.NEXT_PUBLIC_SITE_URL || 'https://skyshcars.com').replace(/\/$/, '');
const GRAPH_VERSION = process.env.META_GRAPH_VERSION || process.env.WHATSAPP_GRAPH_VERSION || 'v26.0';
const GRAPH = `https://graph.facebook.com/${GRAPH_VERSION}`;
const MODEL = process.env.DEEPSEEK_MODEL || 'deepseek-chat';

export type SocialSettings = {
  facebook_auto: boolean;
  whatsapp_active_chats_auto: boolean;
  allow_labeled_demo_images: boolean;
};

const DEFAULTS: SocialSettings = {
  facebook_auto: false,
  whatsapp_active_chats_auto: false,
  allow_labeled_demo_images: false,
};

export async function ensureSocialSchema() {
  await db().execute(`CREATE TABLE IF NOT EXISTS social_publish_log (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    vehicle_id BIGINT UNSIGNED NOT NULL,
    channel VARCHAR(40) NOT NULL,
    external_id VARCHAR(191) NULL,
    status ENUM('sent','skipped','failed') NOT NULL,
    details TEXT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    INDEX(vehicle_id), INDEX(channel), INDEX(created_at)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
  await db().execute(`CREATE TABLE IF NOT EXISTS social_publications(
    vehicle_id BIGINT UNSIGNED NOT NULL,
    channel VARCHAR(40) NOT NULL,
    state ENUM('processing','sent','failed','uncertain') NOT NULL DEFAULT 'processing',
    external_id VARCHAR(191) NULL,
    approved_price_usd DECIMAL(12,2) NULL,
    exact_photo_url TEXT NULL,
    attempt_count INT UNSIGNED NOT NULL DEFAULT 1,
    last_attempt_at DATETIME NULL,
    last_error TEXT NULL,
    publication_history JSON NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY(vehicle_id,channel), INDEX(state), INDEX(external_id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
}

export async function getSocialSettings(): Promise<SocialSettings> {
  try {
    const r: any = await one('SELECT setting_value FROM business_settings WHERE setting_key=?', ['social_auto_publish']);
    if (!r) return DEFAULTS;
    const v = typeof r.setting_value === 'string' ? JSON.parse(r.setting_value) : r.setting_value;
    return { ...DEFAULTS, ...(v || {}) };
  } catch {
    return DEFAULTS;
  }
}

export async function saveSocialSettings(settings: Partial<SocialSettings>) {
  const current = await getSocialSettings();
  const next = { ...current, ...settings };
  await db().execute(
    `INSERT INTO business_settings(setting_key,setting_value) VALUES('social_auto_publish',?)
     ON DUPLICATE KEY UPDATE setting_value=VALUES(setting_value),updated_at=CURRENT_TIMESTAMP`,
    [JSON.stringify(next)]
  );
  return next;
}

function abs(url?: string | null) {
  if (!url) return null;
  if (/^https?:\/\//i.test(url)) return url;
  return SITE + (url.startsWith('/') ? url : '/' + url);
}

export async function getVehicleForSocial(vehicleId: number) {
  return one<any>(`SELECT v.*, (${sellableVehicleSql('v')}) sellable,
    (SELECT url FROM vehicle_media m WHERE m.vehicle_id=v.id AND ${exactPhotoSql('m')}
      ORDER BY m.is_cover DESC,m.sort_order,id LIMIT 1) cover_url
    FROM vehicles v WHERE v.id=? LIMIT 1`, [vehicleId]);
}

/*
  Per-vehicle, per-channel publish lock: one row, claimed atomically, so a double click, two admins,
  or manual + automatic posting at the same moment can never create two Facebook posts.
*/
async function ensureLockTable() {
  await db().execute(`CREATE TABLE IF NOT EXISTS social_publish_lock(
    vehicle_id BIGINT UNSIGNED NOT NULL, channel VARCHAR(40) NOT NULL,
    status ENUM('processing','sent','failed','uncertain') NOT NULL, external_id VARCHAR(191) NULL,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY(vehicle_id,channel)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
  try{await db().execute(`ALTER TABLE social_publish_lock MODIFY status ENUM('processing','sent','failed','uncertain') NOT NULL`)}catch{}
}
type Claim = { claimed: true } | { claimed: false; reason: 'already_posted' | 'in_progress' | 'just_posted' | 'uncertain'; externalId?: string | null };
async function claimPublish(vehicleId: number, channel: string, repost: boolean): Promise<Claim> {
  await ensureSocialSchema();
  await ensureLockTable();
  // Posts made before this lock existed still count as posted.
  const legacy = await one<any>("SELECT external_id FROM social_publish_log WHERE vehicle_id=? AND channel=? AND status='sent' ORDER BY id DESC LIMIT 1", [vehicleId, channel]);
  const publication = await one<any>('SELECT state,external_id FROM social_publications WHERE vehicle_id=? AND channel=? LIMIT 1',[vehicleId,channel]);
  if(publication?.state==='sent'&&!repost)return {claimed:false,reason:'already_posted',externalId:publication.external_id};
  if(publication?.state==='uncertain')return {claimed:false,reason:'uncertain',externalId:publication.external_id};
  const [ins]: any = await db().execute(`INSERT IGNORE INTO social_publish_lock(vehicle_id,channel,status,external_id) VALUES(?,?,?,?)`, [vehicleId, channel, legacy && !repost ? 'sent' : 'processing', legacy?.external_id || null]);
  if (Number(ins.affectedRows)) return legacy && !repost ? { claimed: false, reason: 'already_posted', externalId: legacy.external_id } : { claimed: true };
  const row = await one<any>(`SELECT status,external_id,TIMESTAMPDIFF(SECOND,updated_at,NOW()) age FROM social_publish_lock WHERE vehicle_id=? AND channel=?`, [vehicleId, channel]);
  if (row?.status === 'processing') return { claimed: false, reason: 'in_progress' };
  if (row?.status === 'uncertain') return { claimed: false, reason: 'uncertain', externalId: row.external_id || null };
  if (row?.status === 'sent' && !repost) return { claimed: false, reason: 'already_posted', externalId: row.external_id };
  if (row?.status === 'sent' && Number(row.age) < 120) return { claimed: false, reason: 'just_posted', externalId: row.external_id };
  const [u]: any = await db().execute(`UPDATE social_publish_lock SET status='processing' WHERE vehicle_id=? AND channel=? AND status=?`, [vehicleId, channel, row?.status]);
  return Number(u.affectedRows) ? { claimed: true } : { claimed: false, reason: 'in_progress' };
}
async function releasePublish(vehicleId: number, channel: string, status: 'sent' | 'failed', externalId?: string | null) {
  await db().execute(`UPDATE social_publish_lock SET status=?,external_id=COALESCE(?,external_id) WHERE vehicle_id=? AND channel=?`, [status, externalId || null, vehicleId, channel]);
}

async function publicationAttempt(vehicleId:number,channel:string,state:'processing'|'sent'|'failed'|'uncertain',
  details:any={},externalId?:string|null){
  await ensureSocialSchema();
  await db().execute(`INSERT INTO social_publications(
    vehicle_id,channel,state,external_id,approved_price_usd,exact_photo_url,attempt_count,last_attempt_at,last_error,publication_history
  ) VALUES(?,?,?,?,?,?,1,NOW(),?,JSON_ARRAY(JSON_OBJECT('at',NOW(),'state',?,'external_id',?)))
  ON DUPLICATE KEY UPDATE state=VALUES(state),external_id=COALESCE(VALUES(external_id),external_id),
    approved_price_usd=COALESCE(VALUES(approved_price_usd),approved_price_usd),exact_photo_url=COALESCE(VALUES(exact_photo_url),exact_photo_url),
    attempt_count=IF(VALUES(state)='processing',attempt_count+1,attempt_count),last_attempt_at=NOW(),
    last_error=VALUES(last_error),
    publication_history=JSON_ARRAY_APPEND(COALESCE(publication_history,JSON_ARRAY()),'$',JSON_OBJECT('at',NOW(),'state',?,'external_id',?))`,
  [vehicleId,channel,state,externalId||null,details.price_usd??null,details.image_url??null,String(details.error||'').slice(0,2000)||null,
    state,externalId||null,state,externalId||null]);
  await db().execute(`UPDATE vehicle_identity_memory SET publication_history=JSON_ARRAY_APPEND(
    COALESCE(publication_history,JSON_ARRAY()),'$',JSON_OBJECT('at',NOW(),'channel',?,'state',?,'external_id',?)
  ) WHERE vehicle_id=?`,[channel,state,externalId||null,vehicleId]).catch(()=>{});
}

async function facebookRecentPagePosts(limit=50){
  const token=await resolvePageToken();
  const r=await axios.get(`${FB_GRAPH}/${fbPageId()}/posts`,{
    params:{fields:'id,created_time,message,permalink_url',limit:Math.max(1,Math.min(100,limit)),access_token:token},
    timeout:20000,
  });
  return Array.isArray(r.data?.data)?r.data.data:[];
}

async function findVehiclePost(vehicleId:number,stockNo?:string|null){
  const posts=await facebookRecentPagePosts(75);
  const needle=`/vehicles/${vehicleId}`;
  return posts.find((post:any)=>{
    const message=String(post.message||'');
    return message.includes(needle)||(!!stockNo&&message.includes(`Stock: ${stockNo}`));
  })||null;
}

/** Resolve an uncertain Facebook request against the Page before any retry is allowed. */
export async function reconcileFacebookPublication(vehicleId:number){
  await ensureSocialSchema();await ensureLockTable();
  const publication=await one<any>('SELECT * FROM social_publications WHERE vehicle_id=? AND channel=? LIMIT 1',[vehicleId,'facebook']);
  if(!publication||!['processing','uncertain'].includes(String(publication.state)))return {ok:true,state:publication?.state||'none'};
  const vehicle=await one<any>('SELECT stock_no FROM vehicles WHERE id=? LIMIT 1',[vehicleId]);
  try{
    const post=await findVehiclePost(vehicleId,vehicle?.stock_no);
    if(post){
      const externalId=String(post.post_id||post.id||'');
      await db().execute("UPDATE social_publish_lock SET status='sent',external_id=? WHERE vehicle_id=? AND channel='facebook'",[externalId,vehicleId]);
      await publicationAttempt(vehicleId,'facebook','sent',{reconciled:true,permalink:post.permalink_url||null},externalId);
      await log(vehicleId,'facebook','sent',{reconciled:true,facebook_post:externalId,permalink:post.permalink_url||null},externalId);
      return {ok:true,state:'sent',externalId,permalink:post.permalink_url||null};
    }
    if(publication.state==='processing'){
      await db().execute("UPDATE social_publish_lock SET status='uncertain' WHERE vehicle_id=? AND channel='facebook'",[vehicleId]);
      await publicationAttempt(vehicleId,'facebook','uncertain',{error:'Previous request did not return; post not found on Page'});
    }
    return {ok:true,state:'uncertain',found:false};
  }catch(e:any){
    return {ok:false,state:'uncertain',error:graphError(e)};
  }
}

export async function reconcilePendingFacebookPublications(){
  await ensureSocialSchema();
  const pending=await rows<any>("SELECT vehicle_id FROM social_publications WHERE channel='facebook' AND state IN ('processing','uncertain') ORDER BY last_attempt_at LIMIT 20");
  const results=[];
  for(const row of pending)results.push({vehicle_id:Number(row.vehicle_id),...(await reconcileFacebookPublication(Number(row.vehicle_id)))});
  return results;
}

function safeCaption(v: any) {
  const title = `${v.model_year || ''} ${v.brand || ''} ${v.model || ''}`.trim() || 'Vehicle';
  const parts = [
    `New arrival: ${title}`,
    v.stock_no ? `Stock: ${v.stock_no}` : '',
    v.price_usd ? `Price: $${Number(v.price_usd).toLocaleString()}` : 'Price: ask for quote',
    v.mileage_km ? `Mileage: ${Number(v.mileage_km).toLocaleString()} km` : '',
    v.transmission ? `Transmission: ${v.transmission}` : '',
    `${SITE}/vehicles/${v.id}`,
    '#SkyCars #CarsFromChina'
  ].filter(Boolean);
  return parts.join('\n');
}

async function aiCaption(v: any) {
  if (!process.env.DEEPSEEK_API_KEY) return safeCaption(v);
  const facts = {
    stock_no: v.stock_no, category: v.category, brand: v.brand, model: v.model, trim_name: v.trim_name,
    model_year: v.model_year, mileage_km: v.mileage_km, transmission: v.transmission,
    fuel_type: v.fuel_type, color: v.color, price_usd: v.price_usd, location: v.location,
    link: `${SITE}/vehicles/${v.id}`,
  };
  try {
    const r = await axios.post('https://api.deepseek.com/chat/completions', {
      model: MODEL,
      temperature: 0.15,
      max_tokens: 220,
      messages: [
        { role: 'system', content: 'Write a short Facebook/WhatsApp vehicle post using ONLY the supplied facts. Never invent features, condition, shipping price, availability details, discounts, or claims. Keep it concise. Include stock number, price if present, and link. No markdown table.' },
        { role: 'user', content: JSON.stringify(facts) },
      ],
    }, { headers: { Authorization: `Bearer ${process.env.DEEPSEEK_API_KEY}`, 'Content-Type': 'application/json' }, timeout: 20000 });
    return r.data.choices?.[0]?.message?.content?.trim() || safeCaption(v);
  } catch (e) {
    console.error('SOCIAL_CAPTION_AI', e);
    return safeCaption(v);
  }
}

function imageFor(v: any, _settings?: SocialSettings) {
  // Social and WhatsApp publishing use only approved real vehicle photos.
  // Reference/test imagery remains website-only and is never presented as the actual stock vehicle.
  if (v.cover_url) return { url: abs(v.cover_url)!, demo: false };
  return null;
}

async function loggedAlready(vehicleId: number, channel: string) {
  await ensureSocialSchema();
  const r = await one<any>("SELECT id FROM social_publish_log WHERE vehicle_id=? AND channel=? AND status='sent' LIMIT 1", [vehicleId, channel]);
  return !!r;
}

async function log(vehicleId: number, channel: string, status: 'sent'|'skipped'|'failed', details: any, externalId?: string | null) {
  await ensureSocialSchema();
  await db().execute('INSERT INTO social_publish_log(vehicle_id,channel,external_id,status,details) VALUES(?,?,?,?,?)',
    [vehicleId, channel, externalId || null, status, typeof details === 'string' ? details : JSON.stringify(details || {})]);
}

export type FacebookPublishMode = { manual?: boolean; repost?: boolean };
const NO_EXACT_PHOTO_LINE = 'Exact photos of this unit are available on request — message us and we will send them.';

/**
 * Posts an Available vehicle to the Facebook Page at most once (unless an admin explicitly reposts).
 * Uses ONLY an exact approved photo of the unit. Without one: automatic posting is skipped;
 * a manual post goes out as a text + link post that says exact photos are available on request.
 */
export async function publishVehicleToFacebook(vehicleId: number, mode: FacebookPublishMode = {}) {
  const v: any = await getVehicleForSocial(vehicleId);
  if (!v || !Number(v.sellable)) return { ok: false, skipped: 'Vehicle is not available for sale' };
  if (!(Number(v.price_usd) > 0)) {
    await log(vehicleId, 'facebook', 'skipped', 'Approved USD selling price is missing');
    return { ok: false, skipped: 'Set and approve a USD selling price before publishing to Facebook' };
  }
  if (!facebookConfigured()) {
    await log(vehicleId, 'facebook', 'skipped', 'Facebook Page not connected');
    return { ok: false, skipped: 'Facebook Page is not connected' };
  }
  const image = imageFor(v);
  if (!image) {
    await log(vehicleId, 'facebook', 'skipped', 'No approved original photo of this unit');
    return { ok: false, skipped: 'An approved original photo of this exact unit is required before Facebook publication.' };
  }
  if (!image && !mode.manual) {
    await log(vehicleId, 'facebook', 'skipped', 'No exact photo of this unit — automatic post skipped');
    return { ok: false, skipped: 'No exact photo of this unit, so it was not posted automatically. Add a real photo or post it manually as a link post.' };
  }
  const claim: any = await claimPublish(vehicleId, 'facebook', !!mode.repost);
  if (!claim.claimed) {
    if(claim.reason==='uncertain'){
      const reconciled:any=await reconcileFacebookPublication(vehicleId);
      if(reconciled.state==='sent')return {ok:true,id:reconciled.externalId,reconciled:true};
      return {ok:false,uncertain:true,skipped:'Publication state is uncertain and must be reconciled before retry'};
    }
    const msg = claim.reason === 'in_progress' ? 'A post for this vehicle is already being published' : claim.reason === 'just_posted' ? 'This vehicle was posted less than 2 minutes ago' : 'Already posted';
    return { ok: claim.reason !== 'in_progress', skipped: msg, alreadyPosted: claim.reason !== 'in_progress', id: claim.externalId || null };
  }
  await publicationAttempt(vehicleId,'facebook','processing',{price_usd:Number(v.price_usd),image_url:image.url,manual:!!mode.manual,repost:!!mode.repost});
  try {
    const token = await resolvePageToken();
    const caption = await aiCaption(v);
    let r: any;
    if (image) {
      r = await axios.post(`${FB_GRAPH}/${fbPageId()}/photos`, { url: image.url, caption, published: true, access_token: token }, { timeout: 25000 });
    } else {
      r = await axios.post(`${FB_GRAPH}/${fbPageId()}/feed`, { message: `${caption}\n\n${NO_EXACT_PHOTO_LINE}`, link: `${SITE}/vehicles/${v.id}`, access_token: token }, { timeout: 25000 });
    }
    const id = r.data?.post_id || r.data?.id || null;
    await releasePublish(vehicleId, 'facebook', 'sent', id);
    await publicationAttempt(vehicleId,'facebook','sent',{price_usd:Number(v.price_usd),image_url:image.url,manual:!!mode.manual,repost:!!mode.repost},id);
    await log(vehicleId, 'facebook', 'sent', { image: image?.url || null, exact_photo: !!image, manual: !!mode.manual, repost: !!mode.repost }, id);
    return { ok: true, id, exactPhoto: !!image };
  } catch (e: any) {
    const err = graphError(e);
    const uncertain=!e?.response||['ECONNABORTED','ETIMEDOUT','ECONNRESET','EPIPE'].includes(String(e?.code||''))||Number(e?.response?.status)>=500;
    const reconciled:any=uncertain?await reconcileFacebookPublication(vehicleId):{state:'failed'};
    if(reconciled.state==='sent'){
      await log(vehicleId,'facebook','sent',{reconciled_after_uncertain_response:true,error:err},reconciled.externalId);
      return {ok:true,id:reconciled.externalId,reconciled:true};
    }
    if(uncertain){
      await db().execute("UPDATE social_publish_lock SET status='uncertain',external_id=NULL WHERE vehicle_id=? AND channel='facebook'",[vehicleId]);
      await publicationAttempt(vehicleId,'facebook','uncertain',{price_usd:Number(v.price_usd),image_url:image.url,error:err});
      await log(vehicleId,'facebook','failed',{error:err,uncertain:true,retry_blocked:true});
      return {ok:false,uncertain:true,error:err,reconciliation:reconciled};
    }
    await releasePublish(vehicleId, 'facebook', 'failed').catch(() => {});
    await publicationAttempt(vehicleId,'facebook','failed',{price_usd:Number(v.price_usd),image_url:image.url,error:err});
    await log(vehicleId, 'facebook', 'failed', err);
    return { ok: false, error: err };
  }
}

async function ensureMarketingColumns(){try{await db().execute(`ALTER TABLE customers ADD COLUMN marketing_opt_in BOOLEAN NOT NULL DEFAULT FALSE`)}catch{};try{await db().execute(`ALTER TABLE customers ADD COLUMN marketing_opt_out_at DATETIME NULL`)}catch{}}

/*
  Reply rule: Sky Cars never sends an unprompted WhatsApp message. New-vehicle broadcasts to chats
  are switched off here (auto-publish, campaigns and the admin button all go through this function).
  The original code is kept below for reference if the rule is ever changed on purpose.
*/
const WHATSAPP_BROADCASTS_ALLOWED = false;

export async function publishVehicleToActiveWhatsAppChats(vehicleId: number, force = false) {
  if (!WHATSAPP_BROADCASTS_ALLOWED) return { ok: true, sent: 0, skipped: 'WhatsApp broadcasts are off: Sky Cars only replies when a customer asks' };
  const settings = await getSocialSettings();
  await ensureMarketingColumns();
  const v: any = await getVehicleForSocial(vehicleId);
  if (!v || !Number(v.sellable)) return { ok: false, skipped: 'Vehicle is not available for sale' };
  if (!force && await loggedAlready(vehicleId, 'whatsapp')) return { ok: true, skipped: 'Already shared' };
  if (!whatsappConfigured()) return { ok: false, skipped: 'WhatsApp sending needs setup (see Readiness)' };
  const chats = await rows<any>(`SELECT c.id,c.external_user_id FROM conversations c LEFT JOIN customers cu ON cu.id=c.customer_id\n    WHERE c.channel='whatsapp' AND c.mode='ai' AND c.last_message_at >= (NOW() - INTERVAL 24 HOUR)\n      AND COALESCE(cu.marketing_opt_in,0)=1 AND cu.marketing_opt_out_at IS NULL\n    ORDER BY c.last_message_at DESC LIMIT 100`);
  if (!chats.length) {
    await log(vehicleId, 'whatsapp', 'skipped', 'No opted-in active WhatsApp customers in the last 24 hours');
    return { ok: true, sent: 0 };
  }
  const caption = await aiCaption(v);
  const image = imageFor(v, settings);
  const body = caption;
  let sent = 0, failed = 0;
  for (const c of chats) {
    try {
      if (image) await sendWhatsAppImage(c.external_user_id, image.url, body.slice(0, 1000));
      else await sendWhatsApp(c.external_user_id, body);
      await outbound(Number(c.id), 'ai', body, MODEL);
      sent++;
    } catch (e) {
      failed++;
      console.error('WHATSAPP_AUTO_SHARE', e);
    }
  }
  await log(vehicleId, 'whatsapp', sent ? 'sent' : 'failed', { sent, failed, image: image?.url || null });
  return { ok: sent > 0, sent, failed };
}

export async function autoPublishVehicle(vehicleId: number) {
  const settings = await getSocialSettings();
  const result: any = {};
  if (settings.facebook_auto) result.facebook = await publishVehicleToFacebook(vehicleId);
  if (settings.whatsapp_active_chats_auto) result.whatsapp = await publishVehicleToActiveWhatsAppChats(vehicleId);
  return result;
}

export async function recentSocialLogs() {
  await ensureSocialSchema();
  return rows<any>(`SELECT l.*,v.stock_no,v.brand,v.model FROM social_publish_log l
    LEFT JOIN vehicles v ON v.id=l.vehicle_id ORDER BY l.id DESC LIMIT 50`);
}

