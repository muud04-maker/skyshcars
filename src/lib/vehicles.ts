import fallback from '../../data/inventory.json';
import { rows, one, dbConfigured, lim, db } from './db';
import { ensureLast50Vehicles } from './inventory-seed';

const VERIFIED_MEDIA = `m.media_type='image' AND m.review_status='approved'
  AND m.url NOT LIKE '/demo/vehicles/%'
  AND m.url NOT LIKE '%vehicle-placeholder%'
  AND m.url NOT LIKE '/api/vehicle-art/%'
  AND COALESCE(m.caption,'') NOT LIKE 'MODEL PHOTO%'
  AND COALESCE(m.caption,'') NOT LIKE '%Reference image%'`;
const COVER = `(SELECT url FROM vehicle_media m WHERE m.vehicle_id=v.id AND ${VERIFIED_MEDIA}
  ORDER BY m.is_cover DESC, m.sort_order, m.id LIMIT 1) cover_url`;

let readyPromise:Promise<void>|null=null;
async function ensureCatalogueReady(){
  if(!dbConfigured()) return;
  if(readyPromise) return readyPromise;
  readyPromise=(async()=>{
    await ensureLast50Vehicles();
    await db().execute(`DELETE FROM vehicle_media WHERE
      url LIKE '/demo/vehicles/%' OR url LIKE '%vehicle-placeholder%' OR url LIKE '/api/vehicle-art/%'
      OR COALESCE(caption,'') LIKE 'MODEL PHOTO%' OR COALESCE(caption,'') LIKE '%Reference image%'`);
    // The old imported "motorcycle" records contain no make/model/photo data and were showing random car images.
    // Keep them in the database for audit, but never publish them as real motorcycles.
    await db().execute(`UPDATE vehicles SET status='hidden'
      WHERE category='motorcycle' AND (TRIM(COALESCE(brand,''))='' OR TRIM(COALESCE(model,''))='')
      AND source IN ('inventory_json','import') AND status<>'sold'`);
  })().catch(e=>{readyPromise=null;console.error('CATALOGUE_READY',e)});
  return readyPromise;
}

function legacy(v: any) {
  if (!v) return null;
  return {id:v.id,stock_no:`SC${String(v.id).padStart(5,'0')}`,category:v.category,brand:v.brand,model:v.model,model_year:v.year,price_usd:v.price_usd,status:'available',mileage_km:v.specifications?.actual_mileage||v.specifications?.mileage,transmission:v.specifications?.transmission,engine:v.specifications?.engine,location:v.location||'China',cover_url:null,specs:v.specifications||{}};
}

export type VehicleQuery = {
  limit?:number;category?:string;search?:string;brand?:string;steering?:string;fuel?:string;bodyType?:string;
  minPrice?:number;maxPrice?:number;minYear?:number;maxYear?:number;minMileage?:number;maxMileage?:number;
  stock?:string;sort?:string;
};

function num(v:any){const n=Number(v);return Number.isFinite(n)?n:null}
function buildWhere(opts:VehicleQuery){
  const args:any[]=[];let where=`v.status IN ('available','reserved','pending_verification')`;
  where+=` AND NOT (v.category='motorcycle' AND (TRIM(COALESCE(v.brand,''))='' OR TRIM(COALESCE(v.model,''))=''))`;
  if(opts.category){where+=' AND v.category=?';args.push(opts.category)}
  if(opts.brand){where+=' AND LOWER(v.brand)=?';args.push(String(opts.brand).toLowerCase())}
  if(opts.search){where+=` AND (LOWER(v.brand) LIKE ? OR LOWER(v.model) LIKE ? OR LOWER(COALESCE(v.trim_name,'')) LIKE ? OR LOWER(v.stock_no) LIKE ?)`;const s='%'+String(opts.search).toLowerCase()+'%';args.push(s,s,s,s)}
  if(opts.steering&&['LHD','RHD'].includes(opts.steering)){where+=' AND v.steering=?';args.push(opts.steering)}
  if(opts.fuel){where+=' AND LOWER(COALESCE(v.fuel_type,\'\'))=?';args.push(String(opts.fuel).toLowerCase())}
  if(opts.bodyType){where+=` AND LOWER(COALESCE(JSON_UNQUOTE(JSON_EXTRACT(v.specs,'$.body_type')),''))=?`;args.push(String(opts.bodyType).toLowerCase())}
  const minP=num(opts.minPrice),maxP=num(opts.maxPrice),minY=num(opts.minYear),maxY=num(opts.maxYear),minM=num(opts.minMileage),maxM=num(opts.maxMileage);
  if(minP!==null){where+=' AND v.price_usd>=?';args.push(minP)}if(maxP!==null){where+=' AND v.price_usd<=?';args.push(maxP)}
  if(minY!==null){where+=' AND v.model_year>=?';args.push(minY)}if(maxY!==null){where+=' AND v.model_year<=?';args.push(maxY)}
  if(minM!==null){where+=' AND v.mileage_km>=?';args.push(minM)}if(maxM!==null){where+=' AND v.mileage_km<=?';args.push(maxM)}
  if(opts.stock==='available')where+=` AND v.status='available'`;else if(opts.stock==='preorder')where+=` AND v.status='pending_verification'`;
  return {where,args};
}
function orderOf(sort?:string){switch(sort){case'price_asc':return'v.price_usd IS NULL, v.price_usd ASC, v.id DESC';case'price_desc':return'v.price_usd IS NULL, v.price_usd DESC, v.id DESC';case'year_desc':return'v.model_year IS NULL, v.model_year DESC, v.id DESC';case'mileage_asc':return'v.mileage_km IS NULL, v.mileage_km ASC, v.id DESC';default:return"v.status='available' DESC, v.updated_at DESC, v.id DESC"}}

export async function getVehicles(q:VehicleQuery|number={}){
  const opts:VehicleQuery=typeof q==='number'?{limit:q}:q;const limit=lim(opts.limit??1200);
  if(!dbConfigured()){
    let list=(fallback as any).inventory.map(legacy).filter(Boolean);
    if(opts.category)list=list.filter((v:any)=>v.category===opts.category);
    if(opts.brand)list=list.filter((v:any)=>String(v.brand||'').toLowerCase()===String(opts.brand).toLowerCase());
    if(opts.search){const s=String(opts.search).toLowerCase();list=list.filter((v:any)=>`${v.brand} ${v.model} ${v.stock_no}`.toLowerCase().includes(s))}
    if(opts.category==='motorcycle')list=list.filter((v:any)=>String(v.brand||'').trim()&&String(v.model||'').trim());
    return list.slice(0,limit);
  }
  try{await ensureCatalogueReady();const {where,args}=buildWhere(opts);return await rows<any>(`SELECT v.*, ${COVER} FROM vehicles v WHERE ${where} ORDER BY ${orderOf(opts.sort)} LIMIT ${limit}`,args)}catch(e){console.error('GET_VEHICLES_DB_ERROR',e);return[]}
}

export async function getVehicleFilterOptions(category='car'){
  if(!dbConfigured())return {brands:[],fuels:[],bodyTypes:[],minPrice:0,maxPrice:0,minYear:2011,maxYear:new Date().getFullYear(),minMileage:0,maxMileage:0};
  try{await ensureCatalogueReady();const base=`status IN ('available','reserved','pending_verification') AND category=?`;
    const brands=await rows<any>(`SELECT brand,COUNT(*) count FROM vehicles WHERE ${base} AND TRIM(COALESCE(brand,''))<>'' GROUP BY brand ORDER BY brand`,[category]);
    const fuels=await rows<any>(`SELECT LOWER(fuel_type) fuel,COUNT(*) count FROM vehicles WHERE ${base} AND TRIM(COALESCE(fuel_type,''))<>'' GROUP BY LOWER(fuel_type) ORDER BY fuel`,[category]);
    const bodies=await rows<any>(`SELECT LOWER(JSON_UNQUOTE(JSON_EXTRACT(specs,'$.body_type'))) body,COUNT(*) count FROM vehicles WHERE ${base} AND JSON_EXTRACT(specs,'$.body_type') IS NOT NULL GROUP BY body ORDER BY body`,[category]);
    const range:any=await one(`SELECT MIN(price_usd) minPrice,MAX(price_usd) maxPrice,MIN(model_year) minYear,MAX(model_year) maxYear,MIN(mileage_km) minMileage,MAX(mileage_km) maxMileage FROM vehicles WHERE ${base}`,[category]);
    return {brands,fuels,bodyTypes:bodies,...range};
  }catch(e){console.error('FILTER_OPTIONS',e);return {brands:[],fuels:[],bodyTypes:[]}}
}

export async function getVehicle(id:string){
  if(!dbConfigured())return legacy((fallback as any).inventory.find((x:any)=>String(x.id)===id));
  try{await ensureCatalogueReady();return await one<any>(`SELECT v.*, ${COVER} FROM vehicles v WHERE (v.id=? OR v.legacy_id=? OR v.stock_no=?) AND v.status IN ('available','reserved','pending_verification','sold') LIMIT 1`,[id,id,id])}catch(e){console.error('GET_VEHICLE_DB_ERROR',e);return null}
}
export async function getVehicleMedia(vehicleId:number|string){if(!dbConfigured())return[];try{return await rows<any>(`SELECT id,url,caption,source,is_cover,sort_order FROM vehicle_media m WHERE m.vehicle_id=? AND ${VERIFIED_MEDIA} ORDER BY is_cover DESC,sort_order,id LIMIT 20`,[vehicleId])}catch(e){console.error('GET_VEHICLE_MEDIA_DB_ERROR',e);return[]}}
