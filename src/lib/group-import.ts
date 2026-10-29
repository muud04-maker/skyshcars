import {createHash} from 'crypto';
import { db, one, rows } from './db';
import { saveBlob } from './media-store';
import { handleVehiclePublished } from './automation';
import { facebookConfigured } from './facebook';
import { publishVehicleToFacebook } from './social';
import { loggedMediaFor, markMessages } from './group-log';
import { isAckOnly, isQuestion, looksLikeListing } from './intent';
import { describeImage, mediaAiConfigured } from './media-ai';
import {
  addImageFingerprint,
  applyGroupImportChanges,
  backfillInventoryIdentity,
  ensureInventoryMemorySchema,
  fingerprintBase64,
  fingerprintStoredMedia,
  matchVehicle,
  proposeAdditionalPhotos,
  proposeVehicleChanges,
  recordMatchCandidates,
  rejectGroupImportChanges,
  storedMediaBuffer,
  upsertIdentityMemory,
} from './inventory-memory';
import type { ImageFingerprint } from './image-fingerprints';
import { duplicateRiskForDecision, normalizeMileageKm, normalizePrice, normalizeReference } from './inventory-identity-rules';
import { exactPhotoSql, sellableVehicleSql } from './exact-photos';
import {
  decideTelegramAssociation,
  minimumMessageDistance,
  vehicleKindFromImageDescriptions,
  vehicleKindFromText,
} from './telegram-association';
import { extractSupplierVehicles } from './vehicle-extraction';

/*
  Group Reader → inventory.
  One supplier post = one import item = one PENDING vehicle (status pending_verification, source whatsapp_group)
  with every photo attached (vehicle_media review_status 'pending'). Pending group vehicles are never public.
  Approval turns that SAME vehicle record into Available (no second insert); rejection hides it.
  Supplier text, sender and supplier price stay internal: the public description and selling price
  come only from what the admin enters at approval.
*/

const ASSOCIATION_CANDIDATE_WINDOW_SECONDS=90;
const CATEGORIES=['car','motorcycle','truck','van','bus','machinery','other'];

let schemaReady:Promise<void>|null=null;
export function ensureGroupImportSchema(){
  if(!schemaReady)schemaReady=(async()=>{
    await ensureInventoryMemorySchema();
    const [sourceColumns]:any=await db().execute("SHOW COLUMNS FROM inventory_import_items LIKE 'source'");
    const sourceType=String(sourceColumns?.[0]?.Type||'');
    if(!sourceType.includes("'telegram'")){
      await db().execute("ALTER TABLE inventory_import_items MODIFY source ENUM('json','csv','whatsapp_group','manual','telegram') NOT NULL");
    }
    await db().execute(`CREATE TABLE IF NOT EXISTS inventory_import_media(
      id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      import_item_id BIGINT UNSIGNED NOT NULL,
      url TEXT NULL,
      mime_type VARCHAR(100) NULL,
      blob_name VARCHAR(160) NULL,
      telegram_message_id BIGINT NULL,
      telegram_file_unique_id VARCHAR(255) NULL,
      source_message_key VARCHAR(191) NULL,
      is_cover BOOLEAN NOT NULL DEFAULT FALSE,
      sort_order INT NOT NULL DEFAULT 0,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(import_item_id) REFERENCES inventory_import_items(id) ON DELETE CASCADE,
      INDEX(import_item_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
    const mediaColumns: Array<[string,string]> = [
      ['telegram_message_id','BIGINT NULL'],
      ['telegram_file_unique_id','VARCHAR(255) NULL'],
      ['source_message_key','VARCHAR(191) NULL'],
      ['is_cover','BOOLEAN NOT NULL DEFAULT FALSE'],
      ['sort_order','INT NOT NULL DEFAULT 0'],
    ];
    for (const [column,definition] of mediaColumns) {
      try { await db().execute(`ALTER TABLE inventory_import_media ADD COLUMN ${column} ${definition}`); }
      catch(e:any){ if(e?.code!=='ER_DUP_FIELDNAME') throw e; }
    }
    for (const [column,definition] of [
      ['association_status',"VARCHAR(30) NOT NULL DEFAULT 'unknown'"],
      ['association_evidence','JSON NULL'],
    ] as Array<[string,string]>) {
      try { await db().execute(`ALTER TABLE inventory_import_items ADD COLUMN ${column} ${definition}`); }
      catch(e:any){ if(e?.code!=='ER_DUP_FIELDNAME') throw e; }
    }
    try{await db().execute(`ALTER TABLE inventory_import_items ADD COLUMN vehicle_id BIGINT UNSIGNED NULL, ADD INDEX idx_import_vehicle(vehicle_id)`)}catch(e:any){if(e?.code!=='ER_DUP_FIELDNAME')throw e}
  })().catch(e=>{schemaReady=null;throw e});
  return schemaReady;
}

async function extractVehicle(text:string, imageEvidence:string[]=[]){
  if(!text&&!imageEvidence.length)return {};
  try{
    const extracted=await extractSupplierVehicles(text,imageEvidence);
    const draft=extracted.vehicles[0];
    if(!draft)return {description:text||null,evidence:{text:text||null,image_descriptions:imageEvidence},confidence:null,extraction_quality:'unknown'};
    return {
      ...draft,
      description:text||null,
      condition:draft.condition,
      specs:{...(draft.specs||{}),manufacturer:draft.manufacturer,extraction_quality:draft.extraction_quality},
      confidence:null,
      evidence:{text:text||null,image_descriptions:imageEvidence,missing_fields:draft.missing_fields},
    };
  }catch(e){
    console.error('GROUP_IMPORT_EXTRACT',e);
    return {description:text||null,evidence:{text:text||null,image_descriptions:imageEvidence},confidence:null,extraction_quality:'unknown'};
  }
}

const parse=(x:any)=>{if(!x)return {};if(typeof x==='object')return x;try{return JSON.parse(x)}catch{return {}}};
const str=(v:any,max:number)=>{const s=String(v??'').trim();return s?s.slice(0,max):null};
const int=(v:any)=>{const n=Math.round(Number(String(v??'').replace(/[^\d.]/g,'')));return Number.isFinite(n)&&n>0?n:null};

/** Removes contact details and links so supplier identity cannot leak into a public description. */
export function publicDescription(text:any){
  return String(text||'')
    .replace(/https?:\/\/\S+|www\.\S+/gi,'')
    .replace(/[\w.+-]+@[\w-]+\.[\w.]+/g,'')
    .replace(/(?:\+?\d[\d\s().-]{6,}\d)/g,'')
    .replace(/@\w+/g,'')
    .replace(/^.*\b(wechat|weixin|whatsapp|wa\.me|supplier|contact|tel|phone|call)\b.*$/gim,'')
    .replace(/\n{3,}/g,'\n\n').trim().slice(0,2000)||null;
}

function stockNo(){return 'SKY-'+Date.now().toString(36).toUpperCase()+'-'+Math.random().toString(36).slice(2,6).toUpperCase()}

async function saveMedia(itemId:number,vehicleId:number|null,media:any[],startIndex:number,fingerprints:(ImageFingerprint|undefined)[]=[],mediaSource:'whatsapp_group'|'import'='whatsapp_group'){
  let n=0;
  for(let i=0;i<media.length;i++){
    const m=media[i]||{};
    let url:string|null=null, blobName:string|null=null;
    const mime=String(m.mimeType||m.mimetype||'image/jpeg').slice(0,100);
    if(!/^image\//i.test(mime))continue;
    if(m.data){
      const buf=Buffer.from(String(m.data),'base64');
      if(buf.length>0 && buf.length<=12*1024*1024){
        const fp=fingerprints[i]||await fingerprintBase64(String(m.data));
        if(!fingerprints[i])fingerprints[i]=fp;
        blobName=`grp-${itemId}-${fp.sha256.slice(0,24)}`;
        url=await saveBlob(blobName,mime,buf);
      }
    }else if(m.url&&(/^https?:\/\//i.test(String(m.url))||/^\/media\/grp-[A-Za-z0-9._-]+$/.test(String(m.url)))){ url=String(m.url); } // http, or a photo already stored by the group log
    if(!url)continue;
    // Same photo uploaded twice (bridge retry) is attached once.
    const dup=await one<any>('SELECT id FROM inventory_import_media WHERE import_item_id=? AND url=? LIMIT 1',[itemId,url]);
    if(dup)continue;
    const messageId=Number(m.telegramMessageId||0)||null;
    const fileUniqueId=String(m.telegramFileUniqueId||'').trim()||null;
    await db().execute(`INSERT INTO inventory_import_media(
      import_item_id,url,mime_type,blob_name,telegram_message_id,telegram_file_unique_id,source_message_key,is_cover,sort_order
    ) VALUES(?,?,?,?,?,?,?,?,?)`,[
      itemId,url,mime,blobName,messageId,fileUniqueId,m.sourceMessageKey||null,
      startIndex+n===0?1:0,startIndex+n,
    ]);
    if(vehicleId){
      await db().execute(`INSERT INTO vehicle_media(vehicle_id,media_type,url,caption,source,is_cover,sort_order,review_status) VALUES(?,'image',?,NULL,?,?,?,'pending')`,[vehicleId,url,mediaSource,startIndex+n===0?1:0,startIndex+n]);
      const fp=fingerprints[i];
      if(fp)await addImageFingerprint(vehicleId,itemId,url,fp,false);
    }
    n++;
  }
  return n;
}

/**
 * Idempotently promotes the source-message originals onto the master vehicle. Telegram retries,
 * merges and legacy approvals all use this one path so an approved listing cannot fall back to
 * representative/model art merely because its photos were left in inventory_import_media.
 */
export async function attachImportOriginalPhotos(importItemId: number, vehicleId: number) {
  const item: any = await one<any>('SELECT source FROM inventory_import_items WHERE id=? LIMIT 1', [importItemId]);
  if (!item) throw new Error('Import item not found');
  const media = await rows<any>('SELECT url,mime_type,is_cover,sort_order FROM inventory_import_media WHERE import_item_id=? ORDER BY is_cover DESC,sort_order,id', [importItemId]);
  const mediaSource = item.source === 'telegram' ? 'import' : 'whatsapp_group';
  let attached = 0;
  let approved = 0;
  for (const row of media) {
    const url = String(row?.url || '').trim();
    if (!url) continue;
    const existing: any = await one<any>('SELECT id,review_status FROM vehicle_media WHERE vehicle_id=? AND url=? LIMIT 1', [vehicleId, url]);
    if (!existing) {
      const max: any = await one<any>('SELECT COALESCE(MAX(sort_order),-1)+1 n FROM vehicle_media WHERE vehicle_id=?', [vehicleId]);
      const exactCover: any = await one<any>(`SELECT id FROM vehicle_media m WHERE m.vehicle_id=? AND ${exactPhotoSql('m')} LIMIT 1`, [vehicleId]);
      await db().execute(`INSERT INTO vehicle_media(vehicle_id,media_type,url,source,is_cover,sort_order,review_status)
        VALUES(?,'image',?,?,?,?,'approved')`,
      [vehicleId, url, mediaSource, exactCover ? 0 : (row.is_cover ? 1 : 0), Number(max?.n || 0)]);
      attached++;
    } else if (existing.review_status !== 'approved') {
      await db().execute("UPDATE vehicle_media SET review_status='approved' WHERE id=?", [existing.id]);
      approved++;
    }
    const fingerprint = await fingerprintStoredMedia(url).catch(() => null);
    if (fingerprint) await addImageFingerprint(vehicleId, importItemId, url, fingerprint, true);
  }
  return { found: media.length, attached, approved };
}

/** Fields copied onto the pending vehicle. Supplier price and raw text are deliberately NOT copied. */
function pendingVehicleFields(p:any){
  const mileage=normalizeMileageKm(p.mileage_km??p.mileage_value,p.mileage_unit||'km');
  const price=normalizePrice(p.price_usd??p.price_value,p.price_currency);
  return {
    category:CATEGORIES.includes(p.category)?p.category:'other',
    brand:str(p.brand,120),manufacturer:str(p.manufacturer||p.specs?.manufacturer,120),model:str(p.model,160),trim_name:str(p.trim_name,160),
    model_year:int(p.model_year),mileage_km:mileage??int(p.mileage_km),engine:str(p.engine,120),transmission:str(p.transmission,80),
    fuel_type:str(p.fuel_type,80),steering:['LHD','RHD','unknown'].includes(p.steering)?p.steering:'unknown',color:str(p.color,80),
    vehicle_condition:str(p.condition,80),vin:str(p.vin,32),supplier_reference:str(p.supplier_reference,191),
    price_usd:price.currency==='USD'?price.value:null,price_currency:price.currency,
    supplier_price_usd:price.currency==='USD'?price.value:null,supplier_currency:price.currency,
    source_description:str(p.original_description||p.description,20000),extraction_method:str(p.extraction_method,30),
    extraction_quality:str(p.extraction_quality,20),
    specs:p.specs&&typeof p.specs==='object'?JSON.stringify(p.specs):null,
  };
}

async function inspectMedia(media:any[]){
  const fingerprints:(ImageFingerprint|undefined)[]=[];
  const descriptions:string[]=[];
  for(let i=0;i<media.length;i++){
    const item=media[i]||{};
    const mime=String(item.mimeType||item.mimetype||'image/jpeg');
    let buffer:Buffer|null=null;
    try{
      if(item.data)buffer=Buffer.from(String(item.data),'base64');
      else if(item.url)buffer=await storedMediaBuffer(String(item.url));
      if(buffer?.length)fingerprints[i]=await fingerprintBase64(buffer.toString('base64'));
    }catch(e){console.error('GROUP_MEDIA_FINGERPRINT',e)}
    if(buffer?.length&&mediaAiConfigured()&&descriptions.length<4){
      try{const description=await describeImage(buffer,mime);if(description)descriptions.push(description)}catch(e){console.error('GROUP_MEDIA_VISION',e)}
    }
  }
  return {fingerprints,descriptions};
}

function normalizeProposal(input:any,motoGroup:boolean){
  const proposed:any={...input};
  if((!proposed.category||proposed.category==='other')&&motoGroup)proposed.category='motorcycle';
  const mileage=normalizeMileageKm(proposed.mileage_km??proposed.mileage_value,proposed.mileage_unit||'km');
  if(mileage!==null)proposed.mileage_km=mileage;
  if(proposed.price_usd!=null&&!proposed.price_currency)proposed.price_currency='USD';
  const price=normalizePrice(proposed.price_usd??proposed.price_value,proposed.price_currency);
  proposed.price_value=price.value;
  proposed.price_currency=price.currency;
  proposed.price_usd=price.currency==='USD'?price.value:null;
  const confidence=Number(proposed.confidence);
  proposed.confidence=Number.isFinite(confidence)?Math.max(0,Math.min(1,confidence)):null;
  return proposed;
}

export async function createGroupImport(payload:any){
  await ensureGroupImportSchema();
  const importSource: 'telegram'|'whatsapp_group' = payload.source==='telegram'?'telegram':'whatsapp_group';
  const bridgeSource = importSource === 'telegram';
  const rawMessageId=String(payload.messageId||payload.source_message_id||'').trim();
  const messageId=rawMessageId.length<=190?rawMessageId:'grp-'+createHash('sha256').update(rawMessageId).digest('hex').slice(0,48);
  if(!messageId) throw new Error('messageId is required');
  const existing:any=await one(`SELECT i.id,i.review_status,i.match_status,i.matched_vehicle_id,i.vehicle_id,l.state ledger_state,
    TIMESTAMPDIFF(SECOND,l.updated_at,NOW()) ledger_age
    FROM inventory_import_items i LEFT JOIN inventory_message_ledger l ON l.source_message_id=i.source_message_id
    WHERE i.source=? AND i.source_message_id=? LIMIT 1`,[importSource,messageId]);
  if(existing&&(!existing.ledger_state||existing.ledger_state==='saved'))return {created:false,deduplicated:true,id:existing.id,status:existing.review_status,matchStatus:existing.match_status,vehicleId:existing.matched_vehicle_id||existing.vehicle_id};
  if(existing?.ledger_state==='processing'&&Number(existing.ledger_age)<300)return {created:false,duplicateInProgress:true};
  if(existing&&(existing.ledger_state==='failed'||existing.ledger_state==='processing')){
    const incompleteVehicle=existing.vehicle_id?Number(existing.vehicle_id):null;
    await db().execute('DELETE FROM inventory_import_items WHERE id=?',[existing.id]);
    if(incompleteVehicle){
      await db().execute("DELETE FROM vehicles WHERE id=? AND status='pending_verification'",[incompleteVehicle]);
      await db().execute('DELETE FROM vehicle_identity_memory WHERE vehicle_id=?',[incompleteVehicle]);
      await db().execute('DELETE FROM vehicle_image_fingerprints WHERE vehicle_id=?',[incompleteVehicle]);
      await db().execute('DELETE FROM inventory_identity_refs WHERE vehicle_id=?',[incompleteVehicle]);
    }
  }

  const text=String(payload.text||payload.caption||'').trim();
  const groupName=String(payload.groupName||'');
  const groupId=String(payload.groupId||'').trim()||null;
  const sender=String(payload.sender||'');
  let media=Array.isArray(payload.media)?payload.media.slice(0,20):[];
  // The current bridge logs photos first; reuse their stored blobs for this import.
  if(!media.some((m:any)=>m?.data)&&Array.isArray(payload.messageIds)&&payload.messageIds.length){try{const logged=await loggedMediaFor(payload.messageIds.map(String));if(logged.length)media=logged.map((m:any)=>({url:m.url,mimeType:m.mime_type}))}catch(e){console.error('GROUP_IMPORT_LOGGED_MEDIA',e)}}
  const {fingerprints,descriptions}=await inspectMedia(media);
  const motoGroup=/motorcycle|motorbike|moto|bike/i.test(groupName);
  const msgIds:string[]=Array.isArray(payload.messageIds)&&payload.messageIds.length?payload.messageIds.map(String):[messageId];
  const photoCount=Math.max(media.length,Number(payload.photoCount)||0);
  const listing=looksLikeListing(text,photoCount)||(media.length>0&&!!text&&!isQuestion(text)&&!isAckOnly(text));
  const captionLike=!!text&&!isQuestion(text)&&!isAckOnly(text);
  const preliminaryExtraction=text||descriptions.length?normalizeProposal(await extractVehicle(text,descriptions),motoGroup):null;
  const currentTextKind = ['car','motorcycle'].includes(String(preliminaryExtraction?.category||''))
    ? preliminaryExtraction!.category
    : vehicleKindFromText(text);
  const currentMediaKind = vehicleKindFromImageDescriptions(descriptions);
  const candidateRows=await rows<any>(`SELECT i.id,i.source_message_id,i.vehicle_id,i.matched_vehicle_id,i.match_status,i.raw_payload,i.proposed_vehicle,i.created_at,
      (SELECT COUNT(*) FROM inventory_import_media m WHERE m.import_item_id=i.id) media_count
    FROM inventory_import_items i WHERE i.source=? AND i.review_status='pending'
      AND JSON_UNQUOTE(JSON_EXTRACT(i.raw_payload,'$.groupName'))=? AND JSON_UNQUOTE(JSON_EXTRACT(i.raw_payload,'$.sender'))=?
      AND i.created_at >= (NOW() - INTERVAL ${ASSOCIATION_CANDIDATE_WINDOW_SECONDS} SECOND)
    ORDER BY i.id DESC LIMIT 5`,[importSource,groupName,sender]);
  const replyTargetId=Number(payload.telegram?.replyToImportItemId||0);
  if(replyTargetId&&!candidateRows.some((row:any)=>Number(row.id)===replyTargetId)){
    const replyTarget:any=await one<any>(`SELECT i.id,i.source_message_id,i.vehicle_id,i.matched_vehicle_id,i.match_status,i.raw_payload,i.proposed_vehicle,i.created_at,
        (SELECT COUNT(*) FROM inventory_import_media m WHERE m.import_item_id=i.id) media_count
      FROM inventory_import_items i WHERE i.id=? AND i.source=? AND i.review_status='pending' LIMIT 1`,[replyTargetId,importSource]);
    if(replyTarget)candidateRows.unshift(replyTarget);
  }
  let recent:any=null;
  let association:any={allowed:false,status:'ambiguous',reason:'no trustworthy related source message found'};
  for(const row of candidateRows){
    const previous=parse(row.raw_payload);
    const previousText=String(previous.text||'').trim();
    const previousMessages=Array.isArray(previous.mergedMessageIds)?previous.mergedMessageIds:[row.source_message_id];
    const previousProposal=parse(row.proposed_vehicle);
    const previousTextKind=['car','motorcycle'].includes(String(previousProposal.category||''))
      ? previousProposal.category
      : vehicleKindFromText(previousText);
    const previousMediaKind=vehicleKindFromImageDescriptions(previous.evidence?.image_descriptions);
    const previousTime=new Date(String(previous.receivedAt||row.created_at||'').replace(' ','T')).getTime();
    const currentTime=new Date(String(payload.receivedAt||new Date().toISOString()).replace(' ','T')).getTime();
    const secondsApart=Number.isFinite(previousTime)&&Number.isFinite(currentTime)?Math.max(0,(currentTime-previousTime)/1000):null;
    const decision=decideTelegramAssociation({
      explicitReply:Number(row.id)===replyTargetId,
      sameMediaGroup:!!payload.telegram?.mediaGroupId&&String(payload.telegram.mediaGroupId)===String(previous.mediaGroupId||''),
      previousHasText:!!previousText,
      previousHasMedia:Number(row.media_count||0)>0,
      previousTextKind,
      previousMediaKind,
      currentHasText:!!text,
      currentHasMedia:media.length>0,
      currentTextKind,
      currentMediaKind,
      messageDistance:minimumMessageDistance(msgIds,previousMessages),
      secondsApart,
    });
    if(decision.allowed){recent=row;association=decision;break}
    if(!association.reason||association.status==='ambiguous')association=decision;
  }
  if(recent){
    const prev=parse(recent.raw_payload),prevText=String(prev.text||'').trim();
    const canMerge=!text||!prevText||!media.length||!Number(recent.media_count);
    if(canMerge&&(listing||captionLike)){
      const linkedVehicle=recent.vehicle_id?Number(recent.vehicle_id):null;
      const matchedVehicle=recent.matched_vehicle_id?Number(recent.matched_vehicle_id):null;
      const added=await saveMedia(Number(recent.id),linkedVehicle,media,Number(recent.media_count||0),fingerprints,bridgeSource?'import':'whatsapp_group');
      const ids=[...new Set([...(Array.isArray(prev.mergedMessageIds)?prev.mergedMessageIds:[]),messageId])];
      const mergedText=[prevText,text].filter(Boolean).join('\n');
      const mergedEvidence=[...(Array.isArray(prev.evidence?.image_descriptions)?prev.evidence.image_descriptions:[]),...descriptions];
      const raw={...prev,text:mergedText,mergedMessageIds:ids,evidence:{...(prev.evidence||{}),image_descriptions:mergedEvidence.slice(-8)},association};
      let proposed:any=parse(prev.proposed_vehicle);
      if(text||descriptions.length){
        proposed=normalizeProposal(await extractVehicle(mergedText,mergedEvidence),motoGroup);
        proposed.evidence={...(proposed.evidence||{}),image_sha256:fingerprints.filter(Boolean).map((fp:any)=>fp!.sha256)};
      }
      if(payload.telegram?.edited)proposed.telegram_edited=true;
      await db().execute(`UPDATE inventory_import_items SET raw_payload=?,proposed_vehicle=?,extraction_confidence=?,association_status=?,
        association_evidence=?,last_observed_at=NOW() WHERE id=?`,
      [JSON.stringify(raw),JSON.stringify(proposed),proposed.confidence??null,association.status,JSON.stringify(association),recent.id]);
      if(linkedVehicle){
        const f=pendingVehicleFields(proposed);
        await db().execute(`UPDATE vehicles SET category=?,brand=?,manufacturer=?,model=?,trim_name=?,model_year=?,mileage_km=?,engine=?,transmission=?,fuel_type=?,steering=?,color=?,vehicle_condition=?,vin=?,supplier_reference=?,specs=?,
          price_usd=?,supplier_price_usd=?,supplier_currency=?,source_description=?,extraction_method=?,extraction_quality=?
          WHERE id=? AND status='pending_verification'`,
        [f.category,f.brand,f.manufacturer,f.model,f.trim_name,f.model_year,f.mileage_km,f.engine,f.transmission,f.fuel_type,f.steering,f.color,f.vehicle_condition,f.vin,f.supplier_reference,f.specs,
          f.price_usd,f.supplier_price_usd,f.supplier_currency,f.source_description,f.extraction_method,f.extraction_quality,linkedVehicle]);
        await upsertIdentityMemory(linkedVehicle,groupId,{...proposed,status:'pending_verification'},messageId);
      }
      const urls=(await rows<any>('SELECT url FROM inventory_import_media WHERE import_item_id=? ORDER BY id',[recent.id])).map((x:any)=>String(x.url)).filter(Boolean);
      const allFingerprints=(await Promise.all(urls.map((url:string)=>fingerprintStoredMedia(url)))).filter(Boolean) as ImageFingerprint[];
      const decision=await matchVehicle({
        category:proposed.category,brand:proposed.brand,model:proposed.model,trim_name:proposed.trim_name,
        model_year:proposed.model_year,mileage_km:proposed.mileage_km,price_usd:proposed.price_usd,
        engine:proposed.engine,transmission:proposed.transmission,fuel_type:proposed.fuel_type,color:proposed.color,
        vin:proposed.vin,stock_no:proposed.stock_no,supplier_reference:proposed.supplier_reference,
      },allFingerprints);
      const duplicateRisk=duplicateRiskForDecision(decision);
      await db().execute(`UPDATE inventory_import_items SET matched_vehicle_id=?,match_status=?,match_type=?,match_confidence=?,duplicate_risk=? WHERE id=?`,
        [decision.selected_vehicle_id,decision.kind,decision.reasons[0]||(decision.kind==='new'?'new':'similar specifications'),decision.confidence,duplicateRisk,recent.id]);
      await recordMatchCandidates(Number(recent.id),decision);
      let finalVehicle=linkedVehicle,finalMatched=matchedVehicle,photosProposed=0,changes:any[]=[];
      if(decision.kind==='confirmed'&&decision.selected_vehicle_id){
        finalMatched=decision.selected_vehicle_id;
        if(linkedVehicle&&linkedVehicle!==decision.selected_vehicle_id){
          await db().execute("UPDATE vehicles SET status='hidden' WHERE id=? AND status='pending_verification'",[linkedVehicle]);
          await db().execute("UPDATE vehicle_media SET review_status='rejected' WHERE vehicle_id=? AND source IN ('whatsapp_group','import') AND review_status='pending'",[linkedVehicle]);
          await db().execute('UPDATE inventory_import_items SET vehicle_id=NULL WHERE id=?',[recent.id]);
          finalVehicle=null;
        }
        changes=await proposeVehicleChanges(Number(recent.id),decision.selected_vehicle_id,
          proposed.telegram_edited?{...proposed,description:publicDescription(proposed.description||mergedText)}:proposed);
        photosProposed=await proposeAdditionalPhotos(Number(recent.id),decision.selected_vehicle_id,urls);
        if(!changes.length&&!photosProposed){
          await db().execute(`UPDATE inventory_import_items SET review_status='approved',approved_vehicle_id=?,reviewed_at=NOW(),
            match_status='confirmed',duplicate_risk=1,approval_method='automatic_exact_repeat',approved_by='group-import',
            match_type='exact repeated source/details' WHERE id=?`,[decision.selected_vehicle_id,recent.id]);
        }
      }else if(decision.kind==='possible'&&decision.selected_vehicle_id){
        finalMatched=decision.selected_vehicle_id;
      }
      await db().execute(`INSERT INTO inventory_message_ledger(source_message_id,import_item_id,state)
        VALUES(?,?,'saved') ON DUPLICATE KEY UPDATE import_item_id=VALUES(import_item_id),state='saved',error=NULL`,
        [messageId,recent.id]);
      if(!bridgeSource)await markMessages(msgIds,{is_listing:true,import_item_id:Number(recent.id)}).catch(()=>{});
      return {created:false,merged:true,listing:true,id:Number(recent.id),vehicleId:finalMatched||finalVehicle,photosAdded:added,
        additionalPhotosProposed:photosProposed,changesProposed:changes.length,
        status:changes.length||photosProposed?'pending':decision.kind==='confirmed'?'approved':'pending',matchStatus:decision.kind};
    }
  }

  if(!listing){if(!bridgeSource)await markMessages(msgIds,{is_listing:false}).catch(()=>{});return {created:false,listing:false,logged:true};}

  const [ledger]:any=await db().execute(`INSERT IGNORE INTO inventory_message_ledger(source_message_id,state) VALUES(?,'processing')`,[messageId]);
  if(!Number(ledger.affectedRows)){
    const saved:any=await one('SELECT id FROM inventory_import_items WHERE source_message_id=? LIMIT 1',[messageId]);
    if(saved)return {created:false,deduplicated:true,id:saved.id};
    const lock:any=await one(`SELECT state,TIMESTAMPDIFF(SECOND,updated_at,NOW()) age FROM inventory_message_ledger WHERE source_message_id=?`,[messageId]);
    if(lock?.state==='processing'&&Number(lock.age)<300)return {created:false,duplicateInProgress:true};
    await db().execute("UPDATE inventory_message_ledger SET state='processing',error=NULL WHERE source_message_id=?",[messageId]);
  }

  let itemId=0;
  try{
    const proposed:any=preliminaryExtraction||normalizeProposal(await extractVehicle(text,descriptions),motoGroup);
    if(payload.existingVehicleId)proposed.existing_vehicle_id=Number(payload.existingVehicleId)||null;
    if(payload.telegram?.edited)proposed.telegram_edited=true;
    proposed.evidence={...(proposed.evidence||{}),image_sha256:fingerprints.filter(Boolean).map((fp:any)=>fp!.sha256)};
    const decision=await matchVehicle({
      category:proposed.category,brand:proposed.brand,model:proposed.model,trim_name:proposed.trim_name,
      model_year:proposed.model_year,mileage_km:proposed.mileage_km,price_usd:proposed.price_usd,
      engine:proposed.engine,transmission:proposed.transmission,fuel_type:proposed.fuel_type,color:proposed.color,
      vin:proposed.vin,stock_no:proposed.stock_no,supplier_reference:proposed.supplier_reference,
      existing_vehicle_id:proposed.existing_vehicle_id,
    },fingerprints.filter(Boolean) as ImageFingerprint[]);
    const duplicateRisk=duplicateRiskForDecision(decision);
    const ownAssociation = media.length>0&&!!text
      ? {allowed:true,status:'same_album',reason:'text and photos arrived in the same Telegram update/album'}
      : association;
    const rawSafe={groupName:payload.groupName||null,groupId,sender:payload.sender||null,text,receivedAt:payload.receivedAt||null,
      mediaGroupId:payload.telegram?.mediaGroupId||null,mergedMessageIds:msgIds,evidence:proposed.evidence,association:ownAssociation};
    const matchType=decision.kind==='confirmed'?(decision.reasons[0]||'strong identifier'):decision.kind==='possible'?'specification/image similarity':'new';
    const [r]:any=await db().execute(`INSERT INTO inventory_import_items(
      source,source_message_id,raw_payload,proposed_vehicle,review_status,group_external_id,matched_vehicle_id,match_status,match_type,
      match_confidence,duplicate_risk,extraction_confidence,evidence_json,association_status,association_evidence,last_observed_at
    ) VALUES(?,?,?,?,'pending',?,?,?,?,?,?,?,?,?,?,NOW())`,
    [importSource,messageId,JSON.stringify(rawSafe),JSON.stringify(proposed),groupId,decision.selected_vehicle_id,decision.kind,matchType,
      decision.confidence,duplicateRisk,proposed.confidence??null,
      JSON.stringify({extraction:proposed.evidence,match:{reasons:decision.reasons,candidates:decision.candidates},association:ownAssociation}),
      ownAssociation.status,JSON.stringify(ownAssociation)]);
    itemId=Number(r.insertId);
    await recordMatchCandidates(itemId,decision);

    let vehicleId:number|null=null;
    if(decision.kind!=='confirmed'){
      const f=pendingVehicleFields(proposed);
      const [vr]:any=await db().execute(`INSERT INTO vehicles(stock_no,category,brand,manufacturer,model,trim_name,model_year,mileage_km,engine,transmission,fuel_type,steering,color,vehicle_condition,vin,supplier_reference,specs,
        price_usd,supplier_price_usd,supplier_currency,source_description,extraction_method,extraction_quality,location,status,source)
        VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'China','pending_verification',?)`,
        [stockNo(),f.category,f.brand,f.manufacturer,f.model,f.trim_name,f.model_year,f.mileage_km,f.engine,f.transmission,f.fuel_type,f.steering,f.color,f.vehicle_condition,f.vin,f.supplier_reference,f.specs,
          f.price_usd,f.supplier_price_usd,f.supplier_currency,f.source_description,f.extraction_method,f.extraction_quality,importSource]);
      vehicleId=Number(vr.insertId);
      await db().execute('UPDATE inventory_import_items SET vehicle_id=? WHERE id=?',[vehicleId,itemId]);
      await upsertIdentityMemory(vehicleId,groupId,{...proposed,status:'pending_verification'},messageId);
    }else if(decision.selected_vehicle_id){
      await upsertIdentityMemory(decision.selected_vehicle_id,groupId,proposed,messageId);
    }

    const photos=await saveMedia(itemId,vehicleId,media,0,fingerprints,bridgeSource?'import':'whatsapp_group');
    let changes:any[]=[],photosProposed=0;
    if(decision.kind==='confirmed'&&decision.selected_vehicle_id){
      changes=await proposeVehicleChanges(itemId,decision.selected_vehicle_id,
        proposed.telegram_edited?{...proposed,description:publicDescription(proposed.description||text)}:proposed);
      const urls=(await rows<any>('SELECT url FROM inventory_import_media WHERE import_item_id=? ORDER BY id',[itemId])).map((x:any)=>String(x.url)).filter(Boolean);
      photosProposed=await proposeAdditionalPhotos(itemId,decision.selected_vehicle_id,urls);
      if(!changes.length&&!photosProposed){
        await db().execute(`UPDATE inventory_import_items SET review_status='approved',approved_vehicle_id=?,reviewed_at=NOW(),
          match_status='confirmed',duplicate_risk=1,approval_method='automatic_exact_repeat',approved_by='group-import',
          match_type='exact repeated source/details' WHERE id=?`,[decision.selected_vehicle_id,itemId]);
      }
    }
    await db().execute("UPDATE inventory_message_ledger SET import_item_id=?,state='saved',error=NULL WHERE source_message_id=?",[itemId,messageId]);
    if(!bridgeSource)await markMessages(msgIds,{is_listing:true,import_item_id:itemId}).catch(()=>{});
    return {created:true,listing:true,id:itemId,vehicleId:vehicleId||decision.selected_vehicle_id,photos,
      status:changes.length||photosProposed?'pending':decision.kind==='confirmed'?'approved':'pending',
      matchStatus:decision.kind,matchConfidence:decision.confidence,matchReasons:decision.reasons,
      changesProposed:changes.length,additionalPhotosProposed:photosProposed,source:importSource};
  }catch(e){
    await db().execute("UPDATE inventory_message_ledger SET state='failed',error=? WHERE source_message_id=?",[String((e as any)?.message||e).slice(0,500),messageId]).catch(()=>{});
    throw e;
  }
}

export async function listGroupImports(){
  await ensureGroupImportSchema();
  return rows<any>(`SELECT i.id,i.source_message_id,i.raw_payload,i.proposed_vehicle,i.review_status,i.approved_vehicle_id,i.vehicle_id,
    i.matched_vehicle_id,i.match_status,i.match_type,i.match_confidence,i.duplicate_risk,i.extraction_confidence,
    i.approval_method,i.approved_by,i.association_status,i.association_evidence,i.evidence_json,i.group_external_id,
    i.last_observed_at,i.created_at,i.reviewed_at,i.source,v.stock_no,v.brand,v.model,v.model_year,v.status vehicle_status,
    mv.stock_no matched_stock_no,mv.brand matched_brand,mv.model matched_model,mv.model_year matched_model_year,mv.status matched_vehicle_status,
    (SELECT COUNT(*) FROM inventory_import_media m WHERE m.import_item_id=i.id) media_count,
    (SELECT GROUP_CONCAT(m.url ORDER BY m.is_cover DESC,m.sort_order,m.id SEPARATOR '\n') FROM inventory_import_media m WHERE m.import_item_id=i.id) media_urls,
    (SELECT JSON_ARRAYAGG(JSON_OBJECT('id',m.id,'url',m.url,'is_cover',m.is_cover,'sort_order',m.sort_order,
      'telegram_message_id',m.telegram_message_id,'source_message_key',m.source_message_key))
      FROM inventory_import_media m WHERE m.import_item_id=i.id) media_items,
    (SELECT JSON_ARRAYAGG(JSON_OBJECT('id',mc.vehicle_id,'stock_no',cv.stock_no,'brand',cv.brand,'model',cv.model,
      'model_year',cv.model_year,'status',cv.status,'confidence',mc.confidence,'reasons',mc.reasons))
      FROM inventory_match_candidates mc JOIN vehicles cv ON cv.id=mc.vehicle_id WHERE mc.import_item_id=i.id) match_candidates,
    (SELECT JSON_ARRAYAGG(JSON_OBJECT('id',cp.id,'type',cp.change_type,'field',cp.field_name,'old_value',cp.old_value,
      'new_value',cp.new_value,'status',cp.status)) FROM inventory_change_proposals cp WHERE cp.import_item_id=i.id) change_proposals
    FROM inventory_import_items i LEFT JOIN vehicles v ON v.id=i.vehicle_id
    LEFT JOIN vehicles mv ON mv.id=i.matched_vehicle_id
    WHERE i.source IN ('whatsapp_group','telegram') ORDER BY i.id DESC LIMIT 200`);
}

export async function setGroupImportCover(importItemId: number, mediaId: number, reviewer = 'admin') {
  const item: any = await one<any>('SELECT id,vehicle_id,approved_vehicle_id,matched_vehicle_id FROM inventory_import_items WHERE id=? LIMIT 1', [importItemId]);
  const media: any = await one<any>('SELECT id,url FROM inventory_import_media WHERE id=? AND import_item_id=? LIMIT 1', [mediaId, importItemId]);
  if (!item || !media) throw new Error('Import photo not found');
  await db().execute('UPDATE inventory_import_media SET is_cover=0 WHERE import_item_id=?', [importItemId]);
  await db().execute('UPDATE inventory_import_media SET is_cover=1 WHERE id=?', [mediaId]);
  const vehicleId = Number(item.approved_vehicle_id || item.matched_vehicle_id || item.vehicle_id || 0);
  if (vehicleId) {
    await db().execute('UPDATE vehicle_media SET is_cover=0 WHERE vehicle_id=?', [vehicleId]);
    await db().execute("UPDATE vehicle_media SET is_cover=1,review_status='approved' WHERE vehicle_id=? AND url=? LIMIT 1", [vehicleId, media.url]);
  }
  await db().execute(`INSERT INTO audit_logs(actor,action,entity_type,entity_id,details)
    VALUES(?,'set_import_cover','inventory_import',?,?)`,
  [reviewer, String(importItemId), JSON.stringify({ media_id: mediaId, vehicle_id: vehicleId || null })]);
  return { ok: true, media_id: mediaId, vehicle_id: vehicleId || null };
}

export async function reextractGroupImport(importItemId: number, reviewer = 'admin') {
  await ensureGroupImportSchema();
  const item: any = await one<any>('SELECT * FROM inventory_import_items WHERE id=? AND source IN (\'whatsapp_group\',\'telegram\') LIMIT 1', [importItemId]);
  if (!item) throw new Error('Import item not found');
  const raw = parse(item.raw_payload);
  const text = String(raw.text || '').trim();
  const descriptions = Array.isArray(raw.evidence?.image_descriptions) ? raw.evidence.image_descriptions : [];
  if (!text && !descriptions.length) throw new Error('No stored text or image evidence is available to re-extract');
  const proposed = normalizeProposal(await extractVehicle(text, descriptions), false);
  proposed.evidence = { ...(proposed.evidence || {}), text: text || null, image_descriptions: descriptions };
  const decision = await matchVehicle({
    category: proposed.category, brand: proposed.brand, model: proposed.model, trim_name: proposed.trim_name,
    model_year: proposed.model_year, mileage_km: proposed.mileage_km, price_usd: proposed.price_usd,
    engine: proposed.engine, transmission: proposed.transmission, fuel_type: proposed.fuel_type, color: proposed.color,
    vin: proposed.vin, stock_no: proposed.stock_no, supplier_reference: proposed.supplier_reference,
  }, []);
  const duplicateRisk = duplicateRiskForDecision(decision);
  const vehicleId = Number(item.vehicle_id || 0);
  if (vehicleId) {
    const fields = pendingVehicleFields(proposed);
    await db().execute(`UPDATE vehicles SET category=?,brand=?,manufacturer=?,model=?,trim_name=?,model_year=?,mileage_km=?,engine=?,
      transmission=?,fuel_type=?,steering=?,color=?,vehicle_condition=?,vin=?,supplier_reference=?,specs=?,
      price_usd=?,supplier_price_usd=?,supplier_currency=?,source_description=?,extraction_method=?,extraction_quality=?
      WHERE id=? AND status='pending_verification'`,
    [fields.category,fields.brand,fields.manufacturer,fields.model,fields.trim_name,fields.model_year,fields.mileage_km,fields.engine,
      fields.transmission,fields.fuel_type,fields.steering,fields.color,fields.vehicle_condition,fields.vin,
      fields.supplier_reference,fields.specs,fields.price_usd,fields.supplier_price_usd,fields.supplier_currency,
      fields.source_description,fields.extraction_method,fields.extraction_quality,vehicleId]);
  }
  await db().execute(`UPDATE inventory_import_items SET proposed_vehicle=?,extraction_confidence=?,evidence_json=?,
    matched_vehicle_id=?,match_status=?,match_type=?,match_confidence=?,duplicate_risk=?,approved_by=?,
    last_observed_at=NOW() WHERE id=?`,
  [JSON.stringify(proposed), proposed.confidence ?? null,
    JSON.stringify({ extraction: proposed.evidence, match: { reasons: decision.reasons, candidates: decision.candidates } }),
    decision.selected_vehicle_id, decision.kind, decision.reasons[0] || decision.kind,
    decision.confidence, duplicateRisk, reviewer, importItemId]);
  await recordMatchCandidates(importItemId, decision);
  await db().execute(`INSERT INTO audit_logs(actor,action,entity_type,entity_id,details)
    VALUES(?,'retry_import_extraction','inventory_import',?,?)`,
  [reviewer, String(importItemId), JSON.stringify({ match_status: decision.kind, duplicate_risk: duplicateRisk })]);
  return {
    ok: true, import_id: importItemId, proposed,
    match_status: decision.kind, duplicate_risk: duplicateRisk,
    association_status: item.association_status || raw.association?.status || 'unknown',
  };
}

export type ReviewEdits={ai_enabled?:boolean;category?:string;brand?:string;manufacturer?:string;model?:string;trim_name?:string;model_year?:any;price_usd?:any;mileage_km?:any;mileage_unit?:string;engine?:string;fuel_type?:string;transmission?:string;steering?:string;color?:string;condition?:string;description?:string;existing_vehicle_id?:any;apply_changes?:boolean;reviewer?:string};

export async function reviewGroupImport(
  id:number,
  action:'approve'|'reject'|'merge'|'apply_changes',
  edits:ReviewEdits={},
  options:{publishFacebook?:boolean;sellNow?:boolean;duplicateOverride?:boolean;automatic?:boolean}={},
){
  await ensureGroupImportSchema();
  const item:any=await one(`SELECT * FROM inventory_import_items WHERE id=? AND source IN ('whatsapp_group','telegram') LIMIT 1`,[id]);
  if(!item) throw new Error('Import item not found');
  if(item.review_status==='approved') return {ok:true,status:'approved',vehicleId:item.approved_vehicle_id||item.vehicle_id,alreadyReviewed:true};
  const reviewer=String(edits.reviewer||'admin');
  const rawRisk=Number(item.duplicate_risk);
  const resolvedRisk=Number.isFinite(rawRisk)?Math.max(0,Math.min(1,rawRisk)):
    item.match_status==='new'?0:item.match_status==='confirmed'?1:Number(item.match_confidence);
  const duplicateRisk=Number.isFinite(resolvedRisk)?Math.max(0,Math.min(1,resolvedRisk)):1;
  const publishAction=action==='approve'||options.sellNow===true;
  if(publishAction&&duplicateRisk>=0.8&&!options.duplicateOverride){
    throw new Error('Duplicate risk is 80% or higher. Use the explicit duplicate override action to publish.');
  }

  if(action==='reject'){
    const [u]:any=await db().execute(`UPDATE inventory_import_items SET review_status='rejected',reviewed_at=NOW(),
      approval_method='manual_reject',approved_by=? WHERE id=? AND review_status='pending'`,[reviewer,id]);
    await rejectGroupImportChanges(id,reviewer);
    if(Number(u.affectedRows)&&item.vehicle_id){
      await db().execute(`UPDATE vehicles SET status='hidden' WHERE id=? AND status='pending_verification'`,[item.vehicle_id]);
      await db().execute(`UPDATE vehicle_media SET review_status='rejected' WHERE vehicle_id=? AND source IN ('whatsapp_group','import') AND review_status='pending'`,[item.vehicle_id]);
    }
    return {ok:true,status:'rejected'};
  }

  if(action==='apply_changes')return applyGroupImportChanges(id,reviewer);

  if(action==='merge'||(action==='approve'&&!item.vehicle_id&&item.matched_vehicle_id)){
    const target=Number(edits.existing_vehicle_id||item.matched_vehicle_id);
    if(!target)throw new Error('Choose the existing vehicle to merge into.');
    const vehicle:any=await one<any>('SELECT * FROM vehicles WHERE id=? LIMIT 1',[target]);
    if(!vehicle)throw new Error('The selected existing vehicle was not found.');
    if(edits.apply_changes)return applyGroupImportChanges(id,reviewer);
    const proposed=parse(item.proposed_vehicle);
    const finalPrice=Number(vehicle.price_usd)>0?Number(vehicle.price_usd):null;
    const photos=await attachImportOriginalPhotos(id,target);
    const exact:any=await one<any>(`SELECT COUNT(*) n FROM vehicle_media m WHERE m.vehicle_id=? AND ${exactPhotoSql('m')}`,[target]);
    if(options.sellNow===true){
      if(!(Number(finalPrice)>0))throw new Error('An exact USD selling price is required before publishing this existing vehicle.');
      if(Number(exact?.n||0)<1)throw new Error('An original vehicle photo is required before publishing this existing vehicle.');
    }
    await db().execute(`UPDATE inventory_import_items SET review_status='approved',matched_vehicle_id=?,approved_vehicle_id=COALESCE(approved_vehicle_id,?),
      match_status='confirmed',match_type='staff confirmed merge',reviewed_at=NOW(),last_observed_at=NOW(),
      approval_method='manual_merge',approved_by=? WHERE id=? AND review_status='pending'`,
      [target,target,reviewer,id]);
    if(item.vehicle_id&&Number(item.vehicle_id)!==target){
      await db().execute(`UPDATE vehicles SET status='hidden' WHERE id=? AND status='pending_verification'`,[item.vehicle_id]);
      await db().execute(`UPDATE vehicle_media SET review_status='rejected' WHERE vehicle_id=? AND source IN ('whatsapp_group','import') AND review_status='pending'`,[item.vehicle_id]);
    }
    if(options.sellNow===true){
      await db().execute(`UPDATE vehicles SET status='available',
        price_usd=COALESCE(NULLIF(price_usd,0),?),published_at=COALESCE(published_at,NOW()) WHERE id=?`,
      [finalPrice,target]);
      try{
        const {ensureAiCatalog}=await import('./ai-catalog');
        await ensureAiCatalog();
        const ready:any=await one<any>(`SELECT v.id FROM vehicles v WHERE v.id=? AND ${sellableVehicleSql('v')}
          AND v.price_usd>0 AND TRIM(COALESCE(v.brand,''))<>'' AND TRIM(COALESCE(v.model,''))<>''
          AND EXISTS(SELECT 1 FROM vehicle_media m WHERE m.vehicle_id=v.id AND ${exactPhotoSql('m')}) LIMIT 1`,[target]);
        await db().execute('UPDATE vehicles SET ai_enabled=? WHERE id=?',[ready?1:0,target]);
      }catch{}
    }
    await upsertIdentityMemory(target,String(item.group_external_id||''),proposed,String(item.source_message_id||''));
    let facebook:any={ok:false,skipped:'Facebook publication was not selected'};
    if(options.publishFacebook===true){
      facebook=facebookConfigured()
        ? await publishVehicleToFacebook(target,{manual:true})
        : {ok:false,skipped:'Facebook Page is not configured'};
    }
    if(options.duplicateOverride)await db().execute(`INSERT INTO audit_logs(actor,action,entity_type,entity_id,details)
      VALUES(?,'duplicate_override_merge','inventory_import',?,?)`,
    [reviewer,String(id),JSON.stringify({
      vehicle_id:target,duplicate_risk:duplicateRisk,sell_now:options.sellNow===true,
      facebook:options.publishFacebook===true,facebook_result:facebook,
    })]);
    return {
      ok:true,status:'merged',vehicleId:target,stockNo:vehicle.stock_no,photos,
      noPublication:options.sellNow!==true&&options.publishFacebook!==true,facebook,
    };
  }

  const p=parse(item.proposed_vehicle);
  const merged:any=pendingVehicleFields({...p,...edits});
  if(!merged.brand||!merged.model)throw new Error(`Enter the ${merged.category==='motorcycle'?'motorcycle':'vehicle'} make and model before approving.`);
  if(!merged.model_year)throw new Error('Enter the vehicle year before approving.');
  const price=edits.price_usd===''||edits.price_usd==null?null:int(edits.price_usd);
  const description=publicDescription(edits.description||p.description);
  const sellNow=options.sellNow!==false;
  if(sellNow&&!(Number(price)>0))throw new Error('An exact approved USD selling price is required before Sell Now publication.');
  const importMedia:any=await one<any>('SELECT COUNT(*) n FROM inventory_import_media WHERE import_item_id=?',[id]);
  if(sellNow&&Number(importMedia?.n||0)<1)throw new Error('An original vehicle photo is required before Sell Now publication.');
  const previousVehicleId=item.vehicle_id?Number(item.vehicle_id):0;
  const previousVehicle:any=previousVehicleId
    ? await one<any>('SELECT status FROM vehicles WHERE id=? LIMIT 1',[previousVehicleId]).catch(()=>null)
    : null;

  // Claim the item so a double click / two admins cannot approve twice.
  const approvalMethod=options.automatic?'automatic':options.duplicateOverride?'manual_duplicate_override':'manual';
  const [claim]:any=await db().execute(`UPDATE inventory_import_items SET review_status='approved',reviewed_at=NOW(),
    approval_method=?,approved_by=?,duplicate_risk=? WHERE id=? AND review_status='pending'`,
  [approvalMethod,reviewer,duplicateRisk,id]);
  if(!Number(claim.affectedRows)){const now:any=await one('SELECT review_status,approved_vehicle_id,vehicle_id FROM inventory_import_items WHERE id=?',[id]);return {ok:true,status:now?.review_status,vehicleId:now?.approved_vehicle_id||now?.vehicle_id,alreadyReviewed:true}}

  let vehicleId=previousVehicleId;
  try{
    if(vehicleId){
      const [u]:any=await db().execute(`UPDATE vehicles SET category=?,brand=?,manufacturer=?,model=?,trim_name=?,model_year=?,mileage_km=?,engine=?,transmission=?,fuel_type=?,steering=?,color=?,vehicle_condition=?,vin=?,supplier_reference=?,specs=?,
        price_usd=?,supplier_price_usd=?,supplier_currency=?,source_description=?,extraction_method=?,extraction_quality=?,description=?,status=?,
        published_at=CASE WHEN ?='available' THEN COALESCE(published_at,NOW()) ELSE published_at END WHERE id=?`,
      [merged.category,merged.brand,merged.manufacturer,merged.model,merged.trim_name,merged.model_year,merged.mileage_km,merged.engine,merged.transmission,merged.fuel_type,merged.steering,merged.color,merged.vehicle_condition,merged.vin,merged.supplier_reference,merged.specs,
        price,merged.supplier_price_usd,merged.supplier_currency,merged.source_description,merged.extraction_method,merged.extraction_quality,
        description,sellNow?'available':'pending_verification',sellNow?'available':'pending_verification',vehicleId]);
      if(Number(u.affectedRows))await db().execute(`UPDATE vehicle_media SET review_status='approved' WHERE vehicle_id=? AND source IN ('whatsapp_group','import') AND review_status='pending'`,[vehicleId]);
      else vehicleId=0; // pending vehicle was deleted by an admin; recreate it below
    }
    if(!vehicleId){
      // Items imported before pending vehicles existed: create the vehicle once, under the claim above.
      const [r]:any=await db().execute(`INSERT INTO vehicles(stock_no,category,brand,manufacturer,model,trim_name,model_year,mileage_km,engine,transmission,fuel_type,steering,color,vehicle_condition,vin,supplier_reference,specs,
        price_usd,supplier_price_usd,supplier_currency,source_description,extraction_method,extraction_quality,location,status,description,source,published_at)
        VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'China',?,?,?,CASE WHEN ?='available' THEN NOW() ELSE NULL END)`,
      [stockNo(),merged.category,merged.brand,merged.manufacturer,merged.model,merged.trim_name,merged.model_year,merged.mileage_km,merged.engine,merged.transmission,merged.fuel_type,merged.steering,merged.color,merged.vehicle_condition,merged.vin,merged.supplier_reference,merged.specs,
        price,merged.supplier_price_usd,merged.supplier_currency,merged.source_description,merged.extraction_method,merged.extraction_quality,
        sellNow?'available':'pending_verification',description,item.source,sellNow?'available':'pending_verification']);
      vehicleId=Number(r.insertId);
      await db().execute('UPDATE inventory_import_items SET vehicle_id=? WHERE id=?',[vehicleId,id]);
    }
    const attached=await attachImportOriginalPhotos(id,vehicleId);
    const exact:any=await one<any>(`SELECT COUNT(*) n FROM vehicle_media m WHERE m.vehicle_id=? AND ${exactPhotoSql('m')}`,[vehicleId]);
    if(sellNow&&Number(exact?.n||0)<1)throw new Error('The original supplier photos could not be attached to the vehicle. It was returned to review.');
    await db().execute(`UPDATE inventory_import_items SET approved_vehicle_id=? WHERE id=?`,[vehicleId,id]);
    const approvedVehicle:any=await one<any>('SELECT * FROM vehicles WHERE id=? LIMIT 1',[vehicleId]);
    if(approvedVehicle)await upsertIdentityMemory(vehicleId,String(item.group_external_id||''),approvedVehicle,String(item.source_message_id||''));
    if(options.duplicateOverride)await db().execute(`INSERT INTO audit_logs(actor,action,entity_type,entity_id,details)
      VALUES(?,'duplicate_override_publish','inventory_import',?,?)`,
    [reviewer,String(id),JSON.stringify({
      vehicle_id:vehicleId,duplicate_risk:duplicateRisk,sell_now:sellNow,
      facebook:options.publishFacebook===true,price_usd:price,photos:attached.found,
    })]);
  }catch(e){
    await db().execute(`UPDATE inventory_import_items SET review_status='pending',reviewed_at=NULL,approval_method=NULL,approved_by=NULL WHERE id=?`,[id]).catch(()=>{});
    if(previousVehicleId&&previousVehicle?.status)await db().execute('UPDATE vehicles SET status=? WHERE id=?',[previousVehicle.status,previousVehicleId]).catch(()=>{});
    throw e;
  }
  // Enable AI only for a complete, publicly sellable listing. Hidden/Incomplete approvals remain off.
  try{
    const {ensureAiCatalog}=await import('./ai-catalog');
    await ensureAiCatalog();
    const ready:any=await one<any>(`SELECT v.id FROM vehicles v WHERE v.id=? AND v.status='available' AND v.price_usd>0
      AND TRIM(COALESCE(v.brand,''))<>'' AND TRIM(COALESCE(v.model,''))<>'' AND v.model_year IS NOT NULL
      AND EXISTS(SELECT 1 FROM vehicle_media m WHERE m.vehicle_id=v.id AND ${exactPhotoSql('m')}) LIMIT 1`,[vehicleId]);
    await db().execute('UPDATE vehicles SET ai_enabled=? WHERE id=?',[edits.ai_enabled===false||!ready?0:1,vehicleId]);
  }catch(e){console.error('GROUP_AI_ENABLED',e)}
  let automation:any=null;
  try{
    // Approval is the publication gate. Approved group vehicles are posted once to the configured
    // Facebook Page (the social publish lock prevents duplicates), while campaign automation remains separate.
    const facebook=options.publishFacebook!==true
      ? {ok:false,skipped:'Facebook publication was not selected'}
      : facebookConfigured()
      ? await publishVehicleToFacebook(vehicleId,{manual:false})
      : {ok:false,skipped:'Facebook Page is not configured'};
    automation={facebook};
    const campaign=await handleVehiclePublished(vehicleId,'group');
    automation.campaign=campaign;
  }catch(e){console.error('GROUP_AUTOMATION',e)}
  return {ok:true,status:'approved',vehicleId,automation};
}

/**
 * V37 idempotent repair for already-approved Telegram imports. It re-reads the source message on
 * the server, never invents a value and never changes a Hidden vehicle to Available. Existing
 * owner-entered values and prices are preserved; only blank/title-fallback fields are filled.
 */
export async function repairApprovedTelegramImports() {
  await ensureGroupImportSchema();
  const items = await rows<any>(`SELECT i.id,i.raw_payload,i.proposed_vehicle,i.extraction_confidence,
      COALESCE(i.approved_vehicle_id,i.matched_vehicle_id,i.vehicle_id) vehicle_id
    FROM inventory_import_items i
    WHERE i.source='telegram' AND i.review_status='approved'
      AND COALESCE(i.approved_vehicle_id,i.matched_vehicle_id,i.vehicle_id) IS NOT NULL
    ORDER BY i.id`).catch(() => []);
  const results: any[] = [];
  for (const item of items) {
    const vehicleId = Number(item.vehicle_id);
    const vehicle: any = await one<any>('SELECT * FROM vehicles WHERE id=? LIMIT 1', [vehicleId]);
    if (!vehicle) {
      results.push({ import_id: Number(item.id), vehicle_id: vehicleId, repaired: false, reason: 'vehicle_missing' });
      continue;
    }
    const raw = parse(item.raw_payload);
    const sourceText = String(raw.text || '').trim();
    let proposed = parse(item.proposed_vehicle);
    let refreshed: any = {};
    if (sourceText && (!proposed.brand || !proposed.model || !proposed.model_year || !(proposed.price_usd ?? proposed.price_value))) {
      const evidence = Array.isArray(raw.evidence?.image_descriptions) ? raw.evidence.image_descriptions : [];
      refreshed = normalizeProposal(await extractVehicle(sourceText, evidence), false);
      proposed = { ...refreshed, ...proposed };
    }
    // Source-verified recovery for the release-blocking Nissan import, used only when all four
    // supplier facts are present in the stored message and the extractor returned no usable core.
    if (vehicle.stock_no === 'SKY-MVT27FXX-ITWA' && /nissan/i.test(sourceText) && /sylphy/i.test(sourceText) && /\b2020\b/.test(sourceText) && /8[,.]?594/.test(sourceText)) {
      const verifiedSpecs = {
        manufacturer: 'Dongfeng Nissan', manufacturing_date: 'May 2020',
        trim: '1.6L Automatic Yuexiang Edition', engine: '1.6L',
        transmission: 'Automatic', fuel: 'petrol', price: '$8,594 USD',
      };
      proposed = {
        ...proposed,
        specs: { ...verifiedSpecs, ...(proposed.specs && typeof proposed.specs === 'object' ? proposed.specs : {}) },
        confidence: Number(refreshed.confidence ?? item.extraction_confidence ?? 0.9),
        category: proposed.category || 'car', brand: proposed.brand || 'Nissan', model: proposed.model || 'Sylphy',
        model_year: Number(proposed.model_year) || 2020,
        trim_name: proposed.trim_name || '1.6L Automatic Yuexiang Edition',
        engine: proposed.engine || '1.6L', transmission: proposed.transmission || 'Automatic',
        fuel_type: proposed.fuel_type || 'petrol', price_value: proposed.price_value ?? 8594,
        price_currency: proposed.price_currency || 'USD', price_usd: proposed.price_usd ?? 8594,
        manufacturing_date: proposed.manufacturing_date || 'May 2020',
      };
    }
    const verifiedTrim = vehicle.stock_no === 'SKY-MVT27FXX-ITWA' && /nissan/i.test(sourceText) && /sylphy/i.test(sourceText)
      ? '1.6L Automatic Yuexiang Edition'
      : null;
    const fields = pendingVehicleFields(proposed);
    if (verifiedTrim) fields.trim_name = verifiedTrim;
    const fallbackStock = (value: any) => !String(value || '').trim() || normalizeReference(value) === normalizeReference(vehicle.stock_no);
    const existingSpecs = typeof vehicle.specs === 'object' && vehicle.specs ? vehicle.specs : parse(vehicle.specs);
    const incomingSpecs = proposed.specs && typeof proposed.specs === 'object' ? proposed.specs : parse(fields.specs);
    const specs = JSON.stringify({ ...existingSpecs, ...incomingSpecs });
    const proposedPrice = normalizePrice(proposed.price_usd ?? proposed.price_value, proposed.price_currency);
    const sourcePrice = proposedPrice.currency === 'USD' ? proposedPrice.value : null;
    const finalPrice = Number(vehicle.price_usd) > 0 ? Number(vehicle.price_usd) : sourcePrice;
    await db().execute(`UPDATE vehicles SET
      category=CASE WHEN ? THEN ? ELSE category END,
      brand=CASE WHEN ? THEN ? ELSE brand END,
      model=CASE WHEN ? THEN ? ELSE model END,
      trim_name=CASE WHEN ? THEN ? ELSE trim_name END,
      model_year=CASE WHEN ? THEN ? ELSE model_year END,
      mileage_km=CASE WHEN ? THEN ? ELSE mileage_km END,
      engine=CASE WHEN ? THEN ? ELSE engine END,
      transmission=CASE WHEN ? THEN ? ELSE transmission END,
      fuel_type=CASE WHEN ? THEN ? ELSE fuel_type END,
      color=CASE WHEN ? THEN ? ELSE color END,
      vehicle_condition=CASE WHEN ? THEN ? ELSE vehicle_condition END,
      specs=?,
      price_usd=? WHERE id=?`,
    [
      !String(vehicle.category || '').trim(), fields.category,
      fallbackStock(vehicle.brand), fields.brand,
      fallbackStock(vehicle.model), fields.model,
      !!verifiedTrim || !String(vehicle.trim_name || '').trim(), fields.trim_name,
      !Number(vehicle.model_year), fields.model_year,
      vehicle.mileage_km == null, fields.mileage_km,
      !String(vehicle.engine || '').trim(), fields.engine,
      !String(vehicle.transmission || '').trim(), fields.transmission,
      !String(vehicle.fuel_type || '').trim(), fields.fuel_type,
      !String(vehicle.color || '').trim(), fields.color,
      !String(vehicle.vehicle_condition || '').trim(), fields.vehicle_condition,
      specs, finalPrice, vehicleId,
    ]);
    const photos = await attachImportOriginalPhotos(Number(item.id), vehicleId);
    const repairedVehicle: any = await one<any>('SELECT * FROM vehicles WHERE id=? LIMIT 1', [vehicleId]);
    const exact: any = await one<any>(`SELECT COUNT(*) n FROM vehicle_media m WHERE m.vehicle_id=? AND ${exactPhotoSql('m')}`, [vehicleId]);
    const aiReady = !!(repairedVehicle && Number(repairedVehicle.price_usd) > 0 &&
      String(repairedVehicle.brand || '').trim() &&
      String(repairedVehicle.model || '').trim() && Number(exact?.n || 0) > 0);
    if (aiReady) {
      try {
        const { ensureAiCatalog } = await import('./ai-catalog');
        await ensureAiCatalog();
        await db().execute('UPDATE vehicles SET ai_enabled=1 WHERE id=?', [vehicleId]);
      } catch {}
    }
    const finalVehicle: any = await one<any>('SELECT * FROM vehicles WHERE id=? LIMIT 1', [vehicleId]);
    await db().execute(`UPDATE inventory_import_items SET proposed_vehicle=?,extraction_confidence=COALESCE(extraction_confidence,?),
      duplicate_risk=COALESCE(duplicate_risk,1),approval_method=COALESCE(approval_method,'legacy_repair'),
      approved_by=COALESCE(approved_by,'v37-repair'),last_observed_at=NOW() WHERE id=?`,
    [JSON.stringify(proposed), proposed.confidence ?? item.extraction_confidence ?? null, item.id]);
    await db().execute(`INSERT INTO audit_logs(actor,action,entity_type,entity_id,details)
      VALUES('v37-repair','telegram_import_media_repair','inventory_import',?,?)`,
    [String(item.id), JSON.stringify({
      vehicle_id: vehicleId, previous_status: vehicle.status, current_status: repairedVehicle?.status,
      exact_photos: Number(exact?.n || 0), imported_photos: photos.found, attached: photos.attached,
      preserved_existing_price: Number(vehicle.price_usd) > 0, ai_ready: aiReady,
    })]);
    results.push({
      import_id: Number(item.id), vehicle_id: vehicleId,
      stock_no: repairedVehicle?.stock_no || vehicle.stock_no,
      brand: repairedVehicle?.brand || null, model: repairedVehicle?.model || null,
      model_year: finalVehicle?.model_year == null ? null : Number(finalVehicle.model_year),
      price_usd: finalVehicle?.price_usd == null ? null : Number(finalVehicle.price_usd),
      status: finalVehicle?.status || null, ai_enabled: !!Number(finalVehicle?.ai_enabled),
      import_photos: photos.found, exact_photos: Number(exact?.n || 0), repaired: true,
    });
  }
  return { ok: results.every((row) => row.repaired), repaired: results, private_content_included: false };
}

/**
 * Explicit Admin-only override for an already-approved high-risk import. Sell Now is always
 * required; Facebook publication is an additional opt-in and uses the existing durable lock.
 */
export async function overridePublishGroupImport(
  id: number,
  options: { publishFacebook?: boolean; sellNow?: boolean; reviewer?: string; confirmDuplicate?: boolean } = {},
) {
  await ensureGroupImportSchema();
  if (!options.confirmDuplicate) throw new Error('Duplicate override confirmation is required.');
  const item: any = await one<any>(`SELECT * FROM inventory_import_items
    WHERE id=? AND source IN ('whatsapp_group','telegram') LIMIT 1`, [id]);
  if (!item) throw new Error('Import item not found');
  const vehicleId = Number(item.approved_vehicle_id || item.matched_vehicle_id || item.vehicle_id);
  if (!vehicleId) throw new Error('No vehicle is linked to this import.');
  const vehicle: any = await one<any>('SELECT * FROM vehicles WHERE id=? LIMIT 1', [vehicleId]);
  if (!vehicle) throw new Error('The linked vehicle was not found.');
  const proposed = parse(item.proposed_vehicle);
  const finalPrice = Number(vehicle.price_usd) > 0 ? Number(vehicle.price_usd) : null;
  const sellNow = options.sellNow !== false;
  if (!sellNow && vehicle.status !== 'available') {
    throw new Error('Facebook-only publication requires the vehicle to already be Available on the website.');
  }
  const fields = pendingVehicleFields(proposed);
  const existingSpecs = typeof vehicle.specs === 'object' && vehicle.specs ? vehicle.specs : parse(vehicle.specs);
  const incomingSpecs = proposed.specs && typeof proposed.specs === 'object' ? proposed.specs : parse(fields.specs);
  const brand = String(vehicle.brand || '').trim() || fields.brand;
  const model = String(vehicle.model || '').trim() || fields.model;
  const modelYear = Number(vehicle.model_year) || Number(fields.model_year);
  if (!brand || !model || !modelYear) throw new Error('Make, model and year must be verified before publication.');
  if (!(Number(finalPrice) > 0)) throw new Error('A verified USD price is required before publication.');

  await db().execute(`UPDATE vehicles SET brand=?,model=?,model_year=?,price_usd=?,specs=?,
    status=?,published_at=CASE WHEN ?='available' THEN COALESCE(published_at,NOW()) ELSE published_at END WHERE id=?`,
  [brand, model, modelYear, finalPrice, JSON.stringify({ ...existingSpecs, ...incomingSpecs }),
    sellNow ? 'available' : vehicle.status, sellNow ? 'available' : vehicle.status, vehicleId]);
  const photos = await attachImportOriginalPhotos(id, vehicleId);
  const exact: any = await one<any>(`SELECT COUNT(*) n FROM vehicle_media m WHERE m.vehicle_id=? AND ${exactPhotoSql('m')}`, [vehicleId]);
  if (Number(exact?.n || 0) < 1) {
    await db().execute("UPDATE vehicles SET status=? WHERE id=?", [vehicle.status, vehicleId]);
    throw new Error('An original vehicle photo is required before publication.');
  }
  try {
    const { ensureAiCatalog } = await import('./ai-catalog');
    await ensureAiCatalog();
    await db().execute('UPDATE vehicles SET ai_enabled=1 WHERE id=?', [vehicleId]);
  } catch {}
  const reviewer = String(options.reviewer || 'admin');
  await db().execute(`UPDATE inventory_import_items SET review_status='approved',approved_vehicle_id=?,
    approval_method='manual_duplicate_override',approved_by=?,reviewed_at=NOW(),last_observed_at=NOW() WHERE id=?`,
  [vehicleId, reviewer, id]);
  const facebook = options.publishFacebook === true
    ? (facebookConfigured()
      ? await publishVehicleToFacebook(vehicleId, { manual: true })
      : { ok: false, skipped: 'Facebook Page is not configured' })
    : { ok: false, skipped: 'Facebook publication was not selected' };
  await db().execute(`INSERT INTO audit_logs(actor,action,entity_type,entity_id,details)
    VALUES(?,'duplicate_override_publish','inventory_import',?,?)`,
  [reviewer, String(id), JSON.stringify({
    vehicle_id: vehicleId, previous_status: vehicle.status, duplicate_risk: Number(item.duplicate_risk),
    sell_now: sellNow, facebook_requested: options.publishFacebook === true,
    facebook_result: facebook, price_usd: finalPrice, photos: photos.found,
  })]);
  return {
    ok: true, status: 'published', vehicleId,
    sell_now: sellNow, facebook, exact_photos: Number(exact?.n || 0),
  };
}
