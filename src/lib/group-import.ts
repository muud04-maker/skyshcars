import axios from 'axios';
import {createHash} from 'crypto';
import { db, one, rows } from './db';
import { saveBlob } from './media-store';
import { handleVehiclePublished } from './automation';
import { loggedMediaFor } from './group-log';

/*
  Group Reader → inventory.
  One supplier post = one import item = one PENDING vehicle (status pending_verification, source whatsapp_group)
  with every photo attached (vehicle_media review_status 'pending'). Pending group vehicles are never public.
  Approval turns that SAME vehicle record into Available (no second insert); rejection hides it.
  Supplier text, sender and supplier price stay internal: the public description and selling price
  come only from what the admin enters at approval.
*/

const MODEL=process.env.DEEPSEEK_MODEL||'deepseek-chat';
const MERGE_WINDOW_MIN=3; // photos and caption sent separately by the same supplier are one post
const CATEGORIES=['car','motorcycle','truck','van','bus','machinery','other'];

let schemaReady:Promise<void>|null=null;
export function ensureGroupImportSchema(){
  if(!schemaReady)schemaReady=(async()=>{
    await db().execute(`CREATE TABLE IF NOT EXISTS inventory_import_media(
      id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      import_item_id BIGINT UNSIGNED NOT NULL,
      url TEXT NULL,
      mime_type VARCHAR(100) NULL,
      blob_name VARCHAR(160) NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(import_item_id) REFERENCES inventory_import_items(id) ON DELETE CASCADE,
      INDEX(import_item_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
    try{await db().execute(`ALTER TABLE inventory_import_items ADD COLUMN vehicle_id BIGINT UNSIGNED NULL, ADD INDEX idx_import_vehicle(vehicle_id)`)}catch(e:any){if(e?.code!=='ER_DUP_FIELDNAME')throw e}
  })().catch(e=>{schemaReady=null;throw e});
  return schemaReady;
}

async function extractVehicle(text:string){
  if(!text)return {};
  if(!process.env.DEEPSEEK_API_KEY) return {description:text};
  const prompt=`Extract a vehicle listing from the supplier message below. Return ONLY JSON. Never invent missing fields. Keys: category (car|motorcycle|truck|van|bus|machinery|other|null), brand, model, trim_name, model_year, manufacturing_date, mileage_km, engine, transmission, fuel_type, drivetrain, steering (LHD|RHD|unknown|null), color, price_usd, location, description, specs. Keep original currency/price text inside specs if USD is not explicitly given; do not convert currencies. Message:\n${text}`;
  try{
    const r=await axios.post('https://api.deepseek.com/chat/completions',{model:MODEL,temperature:0,max_tokens:800,messages:[{role:'user',content:prompt}]},{headers:{Authorization:`Bearer ${process.env.DEEPSEEK_API_KEY}`,'Content-Type':'application/json'},timeout:25000});
    const raw=String(r.data.choices?.[0]?.message?.content||'').trim().replace(/^```json\s*/i,'').replace(/```$/,'').trim();
    return JSON.parse(raw);
  }catch(e){console.error('GROUP_IMPORT_EXTRACT',e);return {description:text};}
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

async function saveMedia(itemId:number,vehicleId:number|null,media:any[],startIndex:number){
  let n=0;
  for(let i=0;i<media.length;i++){
    const m=media[i]||{};
    let url:string|null=null, blobName:string|null=null;
    const mime=String(m.mimeType||m.mimetype||'image/jpeg').slice(0,100);
    if(!/^image\//i.test(mime))continue;
    if(m.data){
      const buf=Buffer.from(String(m.data),'base64');
      if(buf.length>0 && buf.length<=12*1024*1024){
        const hash=createHash('sha256').update(buf).digest('hex').slice(0,24);
        blobName=`grp-${itemId}-${hash}`;
        url=await saveBlob(blobName,mime,buf);
      }
    }else if(m.url&&(/^https?:\/\//i.test(String(m.url))||/^\/media\/grp-[A-Za-z0-9._-]+$/.test(String(m.url)))){ url=String(m.url); } // http, or a photo already stored by the group log
    if(!url)continue;
    // Same photo uploaded twice (bridge retry) is attached once.
    const dup=await one<any>('SELECT id FROM inventory_import_media WHERE import_item_id=? AND url=? LIMIT 1',[itemId,url]);
    if(dup)continue;
    await db().execute('INSERT INTO inventory_import_media(import_item_id,url,mime_type,blob_name) VALUES(?,?,?,?)',[itemId,url,mime,blobName]);
    if(vehicleId)await db().execute(`INSERT INTO vehicle_media(vehicle_id,media_type,url,caption,source,is_cover,sort_order,review_status) VALUES(?,'image',?,NULL,'whatsapp_group',?,?,'pending')`,[vehicleId,url,startIndex+n===0?1:0,startIndex+n]);
    n++;
  }
  return n;
}

/** Fields copied onto the pending vehicle. Supplier price and raw text are deliberately NOT copied. */
function pendingVehicleFields(p:any){
  return {
    category:CATEGORIES.includes(p.category)?p.category:'car',
    brand:str(p.brand,120),model:str(p.model,160),trim_name:str(p.trim_name,160),
    model_year:int(p.model_year),mileage_km:int(p.mileage_km),engine:str(p.engine,120),transmission:str(p.transmission,80),
    fuel_type:str(p.fuel_type,80),steering:['LHD','RHD','unknown'].includes(p.steering)?p.steering:'unknown',color:str(p.color,80),
  };
}

export async function createGroupImport(payload:any){
  await ensureGroupImportSchema();
  const rawMessageId=String(payload.messageId||payload.source_message_id||'').trim();
  const messageId=rawMessageId.length<=190?rawMessageId:'grp-'+createHash('sha256').update(rawMessageId).digest('hex').slice(0,48);
  if(!messageId) throw new Error('messageId is required');
  const existing:any=await one('SELECT id,review_status FROM inventory_import_items WHERE source=? AND source_message_id=? LIMIT 1',['whatsapp_group',messageId]);
  if(existing) return {created:false,id:existing.id,status:existing.review_status};

  const text=String(payload.text||payload.caption||'').trim();
  const groupName=String(payload.groupName||'');
  const sender=String(payload.sender||'');
  let media=Array.isArray(payload.media)?payload.media.slice(0,20):[];
  // Current bridge: photos were already stored by the group log; reuse them instead of a second upload.
  if(!media.some((m:any)=>m?.data)&&Array.isArray(payload.messageIds)&&payload.messageIds.length){try{const logged=await loggedMediaFor(payload.messageIds.map(String));if(logged.length)media=logged.map((m:any)=>({url:m.url,mimeType:m.mime_type}))}catch(e){console.error('GROUP_IMPORT_LOGGED_MEDIA',e)}}
  const motoGroup=/motorcycle|motorbike|moto|bike/i.test(groupName);

  // Merge into the same supplier's pending post when photos and caption arrived separately.
  const recent:any=await one(`SELECT i.id,i.vehicle_id,i.raw_payload,(SELECT COUNT(*) FROM inventory_import_media m WHERE m.import_item_id=i.id) media_count
    FROM inventory_import_items i WHERE i.source='whatsapp_group' AND i.review_status='pending'
      AND JSON_UNQUOTE(JSON_EXTRACT(i.raw_payload,'$.groupName'))=? AND JSON_UNQUOTE(JSON_EXTRACT(i.raw_payload,'$.sender'))=?
      AND i.created_at >= (NOW() - INTERVAL ${MERGE_WINDOW_MIN} MINUTE)
    ORDER BY i.id DESC LIMIT 1`,[groupName,sender]);
  if(recent){
    const prev=parse(recent.raw_payload);const prevText=String(prev.text||'').trim();
    const canMerge=!text||!prevText||!media.length||!Number(recent.media_count);
    if(canMerge){
      const added=await saveMedia(Number(recent.id),recent.vehicle_id?Number(recent.vehicle_id):null,media,Number(recent.media_count||0));
      const ids=[...(Array.isArray(prev.mergedMessageIds)?prev.mergedMessageIds:[]),messageId];
      const mergedText=[prevText,text].filter(Boolean).join('\n');
      const raw={...prev,text:mergedText,mergedMessageIds:ids};
      await db().execute('UPDATE inventory_import_items SET raw_payload=? WHERE id=?',[JSON.stringify(raw),recent.id]);
      if(text){
        const proposed:any=await extractVehicle(mergedText);
        if((!proposed.category||proposed.category==='other')&&motoGroup)proposed.category='motorcycle';
        await db().execute('UPDATE inventory_import_items SET proposed_vehicle=? WHERE id=?',[JSON.stringify(proposed),recent.id]);
        if(recent.vehicle_id){const f=pendingVehicleFields(proposed);await db().execute(`UPDATE vehicles SET category=?,brand=?,model=?,trim_name=?,model_year=?,mileage_km=?,engine=?,transmission=?,fuel_type=?,steering=?,color=? WHERE id=? AND status='pending_verification'`,[f.category,f.brand,f.model,f.trim_name,f.model_year,f.mileage_km,f.engine,f.transmission,f.fuel_type,f.steering,f.color,recent.vehicle_id])}
      }
      return {created:false,merged:true,id:Number(recent.id),photosAdded:added,status:'pending'};
    }
  }

  const proposed:any=await extractVehicle(text);
  // The authorized motorcycle group is a strong category signal, but we still never invent make/model/specs.
  if((!proposed.category || proposed.category==='other') && motoGroup) proposed.category='motorcycle';
  const rawSafe={groupName:payload.groupName||null,sender:payload.sender||null,text,receivedAt:payload.receivedAt||null,mergedMessageIds:[messageId]};
  const [r]:any=await db().execute(`INSERT INTO inventory_import_items(source,source_message_id,raw_payload,proposed_vehicle,review_status) VALUES('whatsapp_group',?,?,?,'pending')`,[messageId,JSON.stringify(rawSafe),JSON.stringify(proposed)]);
  const itemId=Number(r.insertId);
  const f=pendingVehicleFields(proposed);
  const [vr]:any=await db().execute(`INSERT INTO vehicles(stock_no,category,brand,model,trim_name,model_year,mileage_km,engine,transmission,fuel_type,steering,color,location,status,source)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,'China','pending_verification','whatsapp_group')`,[stockNo(),f.category,f.brand,f.model,f.trim_name,f.model_year,f.mileage_km,f.engine,f.transmission,f.fuel_type,f.steering,f.color]);
  const vehicleId=Number(vr.insertId);
  await db().execute('UPDATE inventory_import_items SET vehicle_id=? WHERE id=?',[vehicleId,itemId]);
  const photos=await saveMedia(itemId,vehicleId,media,0);
  return {created:true,id:itemId,vehicleId,photos,status:'pending'};
}

export async function listGroupImports(){
  await ensureGroupImportSchema();
  return rows<any>(`SELECT i.id,i.source_message_id,i.raw_payload,i.proposed_vehicle,i.review_status,i.approved_vehicle_id,i.vehicle_id,i.created_at,i.reviewed_at,
    v.stock_no,v.status vehicle_status,
    (SELECT COUNT(*) FROM inventory_import_media m WHERE m.import_item_id=i.id) media_count,
    (SELECT GROUP_CONCAT(m.url ORDER BY m.id SEPARATOR '\n') FROM inventory_import_media m WHERE m.import_item_id=i.id) media_urls
    FROM inventory_import_items i LEFT JOIN vehicles v ON v.id=i.vehicle_id WHERE i.source='whatsapp_group' ORDER BY i.id DESC LIMIT 200`);
}

export type ReviewEdits={category?:string;brand?:string;model?:string;trim_name?:string;model_year?:any;price_usd?:any;mileage_km?:any;fuel_type?:string;transmission?:string;steering?:string;color?:string;description?:string};

export async function reviewGroupImport(id:number,action:'approve'|'reject',edits:ReviewEdits={}){
  await ensureGroupImportSchema();
  const item:any=await one(`SELECT * FROM inventory_import_items WHERE id=? AND source='whatsapp_group' LIMIT 1`,[id]);
  if(!item) throw new Error('Import item not found');
  if(item.review_status==='approved') return {ok:true,status:'approved',vehicleId:item.approved_vehicle_id||item.vehicle_id,alreadyReviewed:true};

  if(action==='reject'){
    const [u]:any=await db().execute(`UPDATE inventory_import_items SET review_status='rejected',reviewed_at=NOW() WHERE id=? AND review_status='pending'`,[id]);
    if(Number(u.affectedRows)&&item.vehicle_id){
      await db().execute(`UPDATE vehicles SET status='hidden' WHERE id=? AND status='pending_verification'`,[item.vehicle_id]);
      await db().execute(`UPDATE vehicle_media SET review_status='rejected' WHERE vehicle_id=? AND source='whatsapp_group' AND review_status='pending'`,[item.vehicle_id]);
    }
    return {ok:true,status:'rejected'};
  }

  const p=parse(item.proposed_vehicle);
  const merged:any=pendingVehicleFields({...p,...edits});
  if(!merged.brand||!merged.model)throw new Error(`Enter the ${merged.category==='motorcycle'?'motorcycle':'vehicle'} make and model before approving.`);
  const price=edits.price_usd===''||edits.price_usd==null?null:int(edits.price_usd);
  const description=publicDescription(edits.description);

  // Claim the item so a double click / two admins cannot approve twice.
  const [claim]:any=await db().execute(`UPDATE inventory_import_items SET review_status='approved',reviewed_at=NOW() WHERE id=? AND review_status='pending'`,[id]);
  if(!Number(claim.affectedRows)){const now:any=await one('SELECT review_status,approved_vehicle_id,vehicle_id FROM inventory_import_items WHERE id=?',[id]);return {ok:true,status:now?.review_status,vehicleId:now?.approved_vehicle_id||now?.vehicle_id,alreadyReviewed:true}}

  let vehicleId=item.vehicle_id?Number(item.vehicle_id):0;
  try{
    if(vehicleId){
      const [u]:any=await db().execute(`UPDATE vehicles SET category=?,brand=?,model=?,trim_name=?,model_year=?,mileage_km=?,engine=?,transmission=?,fuel_type=?,steering=?,color=?,price_usd=?,description=?,status='available',published_at=NOW() WHERE id=?`,
        [merged.category,merged.brand,merged.model,merged.trim_name,merged.model_year,merged.mileage_km,merged.engine,merged.transmission,merged.fuel_type,merged.steering,merged.color,price,description,vehicleId]);
      if(Number(u.affectedRows))await db().execute(`UPDATE vehicle_media SET review_status='approved' WHERE vehicle_id=? AND source='whatsapp_group' AND review_status='pending'`,[vehicleId]);
      else vehicleId=0; // pending vehicle was deleted by an admin; recreate it below
    }
    if(!vehicleId){
      // Items imported before pending vehicles existed: create the vehicle once, under the claim above.
      const [r]:any=await db().execute(`INSERT INTO vehicles(stock_no,category,brand,model,trim_name,model_year,mileage_km,engine,transmission,fuel_type,steering,color,price_usd,location,status,description,source,published_at)
        VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,'China','available',?,'whatsapp_group',NOW())`,[stockNo(),merged.category,merged.brand,merged.model,merged.trim_name,merged.model_year,merged.mileage_km,merged.engine,merged.transmission,merged.fuel_type,merged.steering,merged.color,price,description]);
      vehicleId=Number(r.insertId);
      const media=await rows<any>('SELECT url FROM inventory_import_media WHERE import_item_id=? ORDER BY id',[id]);
      for(let i=0;i<media.length;i++) await db().execute(`INSERT INTO vehicle_media(vehicle_id,media_type,url,source,is_cover,sort_order,review_status) VALUES(?,'image',?,'whatsapp_group',?,?,'approved')`,[vehicleId,media[i].url,i===0?1:0,i]);
      await db().execute('UPDATE inventory_import_items SET vehicle_id=? WHERE id=?',[vehicleId,id]);
    }
    await db().execute(`UPDATE inventory_import_items SET approved_vehicle_id=? WHERE id=?`,[vehicleId,id]);
  }catch(e){
    await db().execute(`UPDATE inventory_import_items SET review_status='pending',reviewed_at=NULL WHERE id=?`,[id]).catch(()=>{});
    throw e;
  }
  let automation:any=null;try{automation=await handleVehiclePublished(vehicleId,'group')}catch(e){console.error('GROUP_AUTOMATION',e)}
  return {ok:true,status:'approved',vehicleId,automation};
}
