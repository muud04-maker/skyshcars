import {db,rows,one} from '../../../../lib/db';
import {isAdmin} from '../../../../lib/admin';
import {handleVehiclePublished} from '../../../../lib/automation';
import {ensureLast50Vehicles} from '../../../../lib/inventory-seed';
import {ensureAiCatalog} from '../../../../lib/ai-catalog';
/** "Let the AI sell this car": ON unless the form explicitly unticks it. */
async function setAiEnabled(id:number,v:any){try{await ensureAiCatalog();await db().execute('UPDATE vehicles SET ai_enabled=? WHERE id=?',[v===false||v===0||v==='0'?0:1,id])}catch(e){console.error('AI_ENABLED_SAVE',e)}}
const allowed=['category','brand','manufacturer','model','trim_name','model_year','manufacturing_date','mileage_km','engine','transmission','fuel_type','drivetrain','steering','color','price_usd','supplier_price_usd','supplier_currency','source_description','extraction_method','extraction_quality','location','status','description'];

async function ensureVehicleSchema(){
  try{
    const [cols]:any=await db().execute("SHOW COLUMNS FROM vehicles LIKE 'status'");
    const type=String(cols?.[0]?.Type||'');
    if(type && (!type.includes("'hidden'")||!type.includes("'pending_verification'"))){
      await db().execute("ALTER TABLE vehicles MODIFY status ENUM('available','reserved','sold','pending_verification','hidden') NOT NULL DEFAULT 'pending_verification'");
    }
    for(const [column,definition] of [
      ['supplier_price_usd','DECIMAL(12,2) NULL'],
      ['manufacturer','VARCHAR(120) NULL'],
      ['supplier_currency','CHAR(3) NULL'],
      ['source_description','TEXT NULL'],
      ['extraction_method','VARCHAR(30) NULL'],
      ['extraction_quality','VARCHAR(20) NULL'],
    ] as Array<[string,string]>){
      try{await db().execute(`ALTER TABLE vehicles ADD COLUMN ${column} ${definition}`)}
      catch(e:any){if(e?.code!=='ER_DUP_FIELDNAME')throw e}
    }
  }catch(e){console.error('VEHICLE_SCHEMA_CHECK',e)}
}

export async function GET(){
  if(!(await isAdmin()))return Response.json({error:'unauthorized'},{status:401});
  await ensureVehicleSchema();await ensureLast50Vehicles();
  const vehicles=await rows<any>(`SELECT v.*, (SELECT url FROM vehicle_media m WHERE m.vehicle_id=v.id AND m.review_status='approved' ORDER BY m.is_cover DESC,m.sort_order,m.id LIMIT 1) cover_url FROM vehicles v ORDER BY v.updated_at DESC LIMIT 500`);
  return Response.json({vehicles});
}
export async function POST(req:Request){
  if(!(await isAdmin()))return Response.json({error:'unauthorized'},{status:401});await ensureVehicleSchema();
  const b=await req.json().catch(()=>({}));const stock=String(b.stock_no||'').trim();
  // Backend is the final authority: clear, structured, user-friendly errors (no SQL text ever).
  if(!stock)return Response.json({ok:false,code:'STOCK_REQUIRED',message:'Stock number is required.'},{status:400});
  if(!/^[A-Za-z0-9._-]{1,60}$/.test(stock))return Response.json({ok:false,code:'STOCK_INVALID',message:'Stock number may only contain letters, numbers, dot, dash and underscore (max 60).'},{status:400});
  if(!String(b.brand||'').trim())return Response.json({ok:false,code:'BRAND_REQUIRED',message:'Brand is required.'},{status:400});
  if(!String(b.model||'').trim())return Response.json({ok:false,code:'MODEL_REQUIRED',message:'Model is required.'},{status:400});
  const category=String(b.category||'car').trim();
  if(!['car','motorcycle','truck','van','bus','machinery','other'].includes(category))return Response.json({ok:false,code:'CATEGORY_INVALID',message:'Choose a valid category.'},{status:400});
  const defaults:any={category:'car',steering:'LHD',location:'China',status:'pending_verification'};const vals=allowed.map(k=>b[k]===undefined||b[k]===''?(defaults[k]??null):b[k]);let r:any;
  try{[r]=await db().execute(`INSERT INTO vehicles(stock_no,${allowed.join(',')},source,published_at) VALUES(?,${allowed.map(()=>'?').join(',')},'manual',?)`,[stock,...vals,b.status==='available'?new Date():null])}
  catch(e:any){
    if(e?.code==='ER_DUP_ENTRY'){
      const existing:any=await one<any>('SELECT id,stock_no,brand,model,model_year,status FROM vehicles WHERE stock_no=? LIMIT 1',[stock]).catch(()=>null);
      return Response.json({ok:false,code:'DUPLICATE_STOCK',message:`Stock number ${stock} already exists.`,existing:existing?{id:Number(existing.id),stock_no:String(existing.stock_no),title:[existing.model_year,existing.brand,existing.model].filter(Boolean).join(' '),status:String(existing.status||'')}:null},{status:409});
    }
    console.error('ADMIN_VEHICLE_CREATE',e?.code||e?.message||e);
    return Response.json({ok:false,code:'CREATE_FAILED',message:'Could not save the vehicle right now. Please try again.'},{status:500});
  }
  await setAiEnabled(Number(r.insertId),b.ai_enabled);
  const image=String(b.image_url||'').trim();if(image)await db().execute("INSERT INTO vehicle_media(vehicle_id,url,source,is_cover,review_status,caption) VALUES(?,?,'admin',1,'approved','Exact stock photo added by admin')",[r.insertId,image]);
  let social:any=null;if(b.status==='available'){try{social=await handleVehiclePublished(Number(r.insertId),'manual')}catch(e){console.error('AUTO_PUBLISH_NEW_VEHICLE',e)}}return Response.json({ok:true,id:r.insertId,social});
}
export async function PATCH(req:Request){
  if(!(await isAdmin()))return Response.json({error:'unauthorized'},{status:401});await ensureVehicleSchema();
  try{
    const b=await req.json();const id=Number(b.id);if(!id)return Response.json({error:'id required'},{status:400});
    const before:any=await one('SELECT status FROM vehicles WHERE id=? LIMIT 1',[id]);if(!before)return Response.json({error:'Vehicle not found'},{status:404});
    if(Object.prototype.hasOwnProperty.call(b,'ai_enabled'))await setAiEnabled(id,b.ai_enabled);
    const keys=allowed.filter(k=>Object.prototype.hasOwnProperty.call(b,k));
    if(keys.length){const vals=keys.map(k=>b[k]===undefined||b[k]===''?null:b[k]);await db().execute(`UPDATE vehicles SET ${keys.map(k=>`${k}=?`).join(',')}${b.status==='available'?',published_at=COALESCE(published_at,NOW())':''} WHERE id=?`,[...vals,id])}
    if(Object.prototype.hasOwnProperty.call(b,'image_url')&&String(b.image_url||'').trim()){await db().execute('UPDATE vehicle_media SET is_cover=0 WHERE vehicle_id=?',[id]);await db().execute("INSERT INTO vehicle_media(vehicle_id,url,source,is_cover,review_status,caption) VALUES(?,?,'admin',1,'approved','Exact stock photo added by admin')",[id,String(b.image_url).trim()])}
    let social:any=null;if(b.status==='available'&&before.status!=='available'){try{social=await handleVehiclePublished(id,'manual')}catch(e){console.error('AUTO_PUBLISH_AVAILABLE_VEHICLE',e)}}
    return Response.json({ok:true,social});
  }catch(e:any){console.error('ADMIN_VEHICLE_UPDATE',e);return Response.json({error:'Could not update vehicle: '+String('database error')},{status:500})}
}
export async function DELETE(req:Request){
  if(!(await isAdmin()))return Response.json({error:'unauthorized'},{status:401});await ensureVehicleSchema();
  try{const b=await req.json();const id=Number(b.id);if(!id)return Response.json({error:'id required'},{status:400});await db().execute("UPDATE vehicles SET status='hidden' WHERE id=?",[id]);return Response.json({ok:true})}catch(e:any){return Response.json({error:'Could not hide vehicle: '+String('database error')},{status:500})}
}
