import {NextResponse} from 'next/server';
import {mkdir,writeFile} from 'fs/promises';
import path from 'path';
import {randomBytes} from 'crypto';
import {getAdminSession} from '../../../../../lib/admin';
import {db} from '../../../../../lib/db';
export const runtime='nodejs';
const allowed=new Map([['image/jpeg','jpg'],['image/png','png'],['image/webp','webp'],['image/gif','gif']]);
export async function POST(req:Request){
 const admin=await getAdminSession();if(!admin)return NextResponse.json({error:'Unauthorized'},{status:401});
 const form=await req.formData();const vehicleId=Number(form.get('vehicle_id'));const files=form.getAll('files').filter((x):x is File=>x instanceof File);
 if(!vehicleId)return NextResponse.json({error:'Choose a vehicle first'},{status:400});if(!files.length)return NextResponse.json({error:'Choose at least one image'},{status:400});if(files.length>12)return NextResponse.json({error:'Upload up to 12 images at a time'},{status:400});
 const dir=path.join(process.cwd(),'public','uploads','vehicles');await mkdir(dir,{recursive:true});const inserted:any[]=[];
 for(const file of files){const ext=allowed.get(file.type);if(!ext)return NextResponse.json({error:`Unsupported image type: ${file.type||file.name}`},{status:400});if(file.size>10*1024*1024)return NextResponse.json({error:`${file.name} is larger than 10 MB`},{status:400});const name=`v${vehicleId}-${Date.now()}-${randomBytes(5).toString('hex')}.${ext}`;const abs=path.join(dir,name);await writeFile(abs,Buffer.from(await file.arrayBuffer()));const url=`/uploads/vehicles/${name}`;const [r]:any=await db().execute("INSERT INTO vehicle_media(vehicle_id,media_type,url,storage_key,source,is_cover,sort_order,review_status) VALUES(?,'image',?,?,'admin',0,0,'approved')",[vehicleId,url,name]);inserted.push({id:r.insertId,url});}
 const [countRows]:any=await db().execute("SELECT COUNT(*) c FROM vehicle_media WHERE vehicle_id=? AND review_status='approved' AND media_type='image' AND is_cover=1",[vehicleId]);if(Number(countRows?.[0]?.c||0)===0&&inserted[0])await db().execute('UPDATE vehicle_media SET is_cover=1 WHERE id=?',[inserted[0].id]);
 try{await db().execute('INSERT INTO audit_logs(actor,action,entity_type,entity_id,details) VALUES(?,?,?,?,?)',[admin.email,'upload_images','vehicle',String(vehicleId),JSON.stringify({count:inserted.length})])}catch{}
 return NextResponse.json({ok:true,images:inserted});
}
