import {db,rows,one} from '../../../../lib/db';
import {isAdmin} from '../../../../lib/admin';
import {handleVehiclePublished} from '../../../../lib/automation';
import {ensureLast50Vehicles} from '../../../../lib/inventory-seed';
const allowed=['category','brand','model','trim_name','model_year','manufacturing_date','mileage_km','engine','transmission','fuel_type','drivetrain','steering','color','price_usd','location','status','description'];

async function ensureVehicleSchema(){
  try{
    const [cols]:any=await db().execute("SHOW COLUMNS FROM vehicles LIKE 'status'");
    const type=String(cols?.[0]?.Type||'');
    if(type && (!type.includes("'hidden'")||!type.includes("'pending_verification'"))){
      await db().execute("ALTER TABLE vehicles MODIFY status ENUM('available','reserved','sold','pending_verification','hidden') NOT NULL DEFAULT 'pending_verification'");
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
  const b=await req.json();const stock=String(b.stock_no||'').trim();if(!stock)return Response.json({error:'Stock number is required'},{status:400});
  const defaults:any={category:'car',steering:'LHD',location:'China',status:'pending_verification'};const vals=allowed.map(k=>b[k]===undefined||b[k]===''?(defaults[k]??null):b[k]);let r:any;
  try{[r]=await db().execute(`INSERT INTO vehicles(stock_no,${allowed.join(',')},source,published_at) VALUES(?,${allowed.map(()=>'?').join(',')},'manual',?)`,[stock,...vals,b.status==='available'?new Date():null])}catch(e:any){if(e?.code==='ER_DUP_ENTRY')return Response.json({error:'That stock number already exists'},{status:409});console.error('ADMIN_VEHICLE_CREATE',e);return Response.json({error:'Could not save vehicle: '+(e?.sqlMessage||e?.message||'database error')},{status:500})}
  const image=String(b.image_url||'').trim();if(image)await db().execute("INSERT INTO vehicle_media(vehicle_id,url,source,is_cover,review_status,caption) VALUES(?,?,'admin',1,'approved','Exact stock photo added by admin')",[r.insertId,image]);
  let social:any=null;if(b.status==='available'){try{social=await handleVehiclePublished(Number(r.insertId),'manual')}catch(e){console.error('AUTO_PUBLISH_NEW_VEHICLE',e)}}return Response.json({ok:true,id:r.insertId,social});
}
export async function PATCH(req:Request){
  if(!(await isAdmin()))return Response.json({error:'unauthorized'},{status:401});await ensureVehicleSchema();
  try{
    const b=await req.json();const id=Number(b.id);if(!id)return Response.json({error:'id required'},{status:400});
    const before:any=await one('SELECT status FROM vehicles WHERE id=? LIMIT 1',[id]);if(!before)return Response.json({error:'Vehicle not found'},{status:404});
    const keys=allowed.filter(k=>Object.prototype.hasOwnProperty.call(b,k));
    if(keys.length){const vals=keys.map(k=>b[k]===undefined||b[k]===''?null:b[k]);await db().execute(`UPDATE vehicles SET ${keys.map(k=>`${k}=?`).join(',')}${b.status==='available'?',published_at=COALESCE(published_at,NOW())':''} WHERE id=?`,[...vals,id])}
    if(Object.prototype.hasOwnProperty.call(b,'image_url')&&String(b.image_url||'').trim()){await db().execute('UPDATE vehicle_media SET is_cover=0 WHERE vehicle_id=?',[id]);await db().execute("INSERT INTO vehicle_media(vehicle_id,url,source,is_cover,review_status,caption) VALUES(?,?,'admin',1,'approved','Exact stock photo added by admin')",[id,String(b.image_url).trim()])}
    let social:any=null;if(b.status==='available'&&before.status!=='available'){try{social=await handleVehiclePublished(id,'manual')}catch(e){console.error('AUTO_PUBLISH_AVAILABLE_VEHICLE',e)}}
    return Response.json({ok:true,social});
  }catch(e:any){console.error('ADMIN_VEHICLE_UPDATE',e);return Response.json({error:'Could not update vehicle: '+String(e?.sqlMessage||e?.message||'database error')},{status:500})}
}
export async function DELETE(req:Request){
  if(!(await isAdmin()))return Response.json({error:'unauthorized'},{status:401});await ensureVehicleSchema();
  try{const b=await req.json();const id=Number(b.id);if(!id)return Response.json({error:'id required'},{status:400});await db().execute("UPDATE vehicles SET status='hidden' WHERE id=?",[id]);return Response.json({ok:true})}catch(e:any){return Response.json({error:'Could not hide vehicle: '+String(e?.sqlMessage||e?.message||'database error')},{status:500})}
}
