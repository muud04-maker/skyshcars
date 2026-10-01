import axios from 'axios';
import { db, one, rows } from './db';
import { saveBlob } from './media-store';

const MODEL=process.env.DEEPSEEK_MODEL||'deepseek-chat';

export async function ensureGroupImportSchema(){
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
}

async function extractVehicle(text:string){
  if(!process.env.DEEPSEEK_API_KEY) return {description:text};
  const prompt=`Extract a vehicle listing from the supplier message below. Return ONLY JSON. Never invent missing fields. Keys: category (car|motorcycle|truck|van|bus|machinery|other|null), brand, model, trim_name, model_year, manufacturing_date, mileage_km, engine, transmission, fuel_type, drivetrain, steering (LHD|RHD|unknown|null), color, price_usd, location, description, specs. Keep original currency/price text inside specs if USD is not explicitly given; do not convert currencies. Message:\n${text}`;
  try{
    const r=await axios.post('https://api.deepseek.com/chat/completions',{model:MODEL,temperature:0,max_tokens:800,messages:[{role:'user',content:prompt}]},{headers:{Authorization:`Bearer ${process.env.DEEPSEEK_API_KEY}`,'Content-Type':'application/json'},timeout:25000});
    const raw=String(r.data.choices?.[0]?.message?.content||'').trim().replace(/^```json\s*/i,'').replace(/```$/,'').trim();
    return JSON.parse(raw);
  }catch(e){console.error('GROUP_IMPORT_EXTRACT',e);return {description:text};}
}

export async function createGroupImport(payload:any){
  await ensureGroupImportSchema();
  const messageId=String(payload.messageId||payload.source_message_id||'').trim();
  if(!messageId) throw new Error('messageId is required');
  const existing:any=await one('SELECT id,review_status FROM inventory_import_items WHERE source=? AND source_message_id=? LIMIT 1',['whatsapp_group',messageId]);
  if(existing) return {created:false,id:existing.id,status:existing.review_status};
  const text=String(payload.text||payload.caption||'').trim();
  const proposed=await extractVehicle(text);
  const rawSafe={groupName:payload.groupName||null,sender:payload.sender||null,text,receivedAt:payload.receivedAt||null};
  const [r]:any=await db().execute(`INSERT INTO inventory_import_items(source,source_message_id,raw_payload,proposed_vehicle,review_status) VALUES('whatsapp_group',?,?,?,'pending')`,[messageId,JSON.stringify(rawSafe),JSON.stringify(proposed)]);
  const itemId=Number(r.insertId);
  const media=Array.isArray(payload.media)?payload.media.slice(0,20):[];
  for(let i=0;i<media.length;i++){
    const m=media[i]||{};
    let url:string|null=null, blobName:string|null=null;
    const mime=String(m.mimeType||m.mimetype||'image/jpeg').slice(0,100);
    if(m.data){
      const buf=Buffer.from(String(m.data),'base64');
      if(buf.length>0 && buf.length<=12*1024*1024){
        blobName=`grp-${itemId}-${i+1}-${Date.now()}`;
        url=await saveBlob(blobName,mime,buf);
      }
    }else if(m.url){ url=String(m.url); }
    if(url) await db().execute('INSERT INTO inventory_import_media(import_item_id,url,mime_type,blob_name) VALUES(?,?,?,?)',[itemId,url,mime,blobName]);
  }
  return {created:true,id:itemId,status:'pending'};
}

export async function listGroupImports(){
  await ensureGroupImportSchema();
  return rows<any>(`SELECT i.id,i.source_message_id,i.raw_payload,i.proposed_vehicle,i.review_status,i.approved_vehicle_id,i.created_at,i.reviewed_at,
    (SELECT COUNT(*) FROM inventory_import_media m WHERE m.import_item_id=i.id) media_count
    FROM inventory_import_items i WHERE i.source='whatsapp_group' ORDER BY i.id DESC LIMIT 200`);
}

function stockNo(){return 'SKY-'+Date.now().toString(36).toUpperCase()+'-'+Math.random().toString(36).slice(2,6).toUpperCase()}
export async function reviewGroupImport(id:number,action:'approve'|'reject'){
  await ensureGroupImportSchema();
  const item:any=await one(`SELECT * FROM inventory_import_items WHERE id=? AND source='whatsapp_group' LIMIT 1`,[id]);
  if(!item) throw new Error('Import item not found');
  if(action==='reject'){
    await db().execute(`UPDATE inventory_import_items SET review_status='rejected',reviewed_at=NOW() WHERE id=?`,[id]);
    return {ok:true,status:'rejected'};
  }
  if(item.review_status==='approved' && item.approved_vehicle_id) return {ok:true,status:'approved',vehicleId:item.approved_vehicle_id};
  const v=typeof item.proposed_vehicle==='string'?JSON.parse(item.proposed_vehicle||'{}'):(item.proposed_vehicle||{});
  const category=['car','motorcycle','truck','van','bus','machinery','other'].includes(v.category)?v.category:'car';
  const steering=['LHD','RHD','unknown'].includes(v.steering)?v.steering:'unknown';
  const [r]:any=await db().execute(`INSERT INTO vehicles(stock_no,category,brand,model,trim_name,model_year,manufacturing_date,mileage_km,engine,transmission,fuel_type,drivetrain,steering,color,price_usd,location,status,description,specs,source,published_at)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,NOW())`,[
      stockNo(),category,v.brand||null,v.model||null,v.trim_name||null,v.model_year||null,v.manufacturing_date||null,v.mileage_km||null,v.engine||null,v.transmission||null,v.fuel_type||null,v.drivetrain||null,steering,v.color||null,v.price_usd||null,v.location||'China','pending_verification',v.description||null,JSON.stringify(v.specs||{}),'whatsapp_group'
    ]);
  const vehicleId=Number(r.insertId);
  const media=await rows<any>('SELECT url,mime_type FROM inventory_import_media WHERE import_item_id=? ORDER BY id',[id]);
  for(let i=0;i<media.length;i++) await db().execute(`INSERT INTO vehicle_media(vehicle_id,media_type,url,source,is_cover,sort_order,review_status) VALUES(?,'image',?,'whatsapp_group',?,?, 'pending')`,[vehicleId,media[i].url,i===0?1:0,i]);
  await db().execute(`UPDATE inventory_import_items SET review_status='approved',approved_vehicle_id=?,reviewed_at=NOW() WHERE id=?`,[vehicleId,id]);
  return {ok:true,status:'approved',vehicleId};
}
