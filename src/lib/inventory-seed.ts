import data from '../../data/v16_last_50.json';
import {db, dbConfigured} from './db';

let seedPromise: Promise<void> | null = null;

/** Ensure the 50 user-supplied vehicles exist in MySQL. Safe and idempotent. */
export async function ensureLast50Vehicles(){
  if(!dbConfigured()) return;
  if(seedPromise) return seedPromise;
  seedPromise=(async()=>{
    for(const v of data as any[]){
      await db().execute(`INSERT INTO vehicles(stock_no,category,brand,model,trim_name,model_year,price_usd,fuel_type,transmission,status,location,source,description,specs,published_at)
        VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,NOW())
        ON DUPLICATE KEY UPDATE brand=VALUES(brand),model=VALUES(model),trim_name=VALUES(trim_name),model_year=VALUES(model_year),price_usd=VALUES(price_usd),fuel_type=VALUES(fuel_type),transmission=COALESCE(VALUES(transmission),transmission),location=VALUES(location),description=VALUES(description),specs=VALUES(specs)`,
        [v.stock_no,v.category,v.brand,v.model,v.trim_name,v.model_year,v.price_usd,v.fuel_type,v.transmission,v.status,v.location,v.source,v.description,JSON.stringify(v.specs)]);
    }
  })().catch(e=>{seedPromise=null; console.error('ENSURE_LAST50',e);});
  return seedPromise;
}
