import {isAdmin} from '../../../../../lib/admin';
import {db} from '../../../../../lib/db';
import data from '../../../../../../data/v16_last_50.json';
export const dynamic='force-dynamic';
export async function POST(){
 if(!(await isAdmin())) return Response.json({error:'Unauthorized'},{status:401});
 let created=0,skipped=0;
 for(const v of data as any[]){
  const [r]:any=await db().execute(`INSERT IGNORE INTO vehicles(stock_no,category,brand,model,trim_name,model_year,price_usd,fuel_type,transmission,status,location,source,description,specs,published_at)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,NOW())`,[v.stock_no,v.category,v.brand,v.model,v.trim_name,v.model_year,v.price_usd,v.fuel_type,v.transmission,v.status,v.location,v.source,v.description,JSON.stringify(v.specs)]);
  if(r.affectedRows) created++; else skipped++;
 }
 return Response.json({ok:true,created,skipped,total:(data as any[]).length});
}
