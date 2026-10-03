import {getVehicles} from '../../../lib/vehicles';

// Public API: whitelist only customer-facing fields (no source, specs, supplier data, descriptions or internal ids).
const PUBLIC_FIELDS=['id','stock_no','category','brand','model','trim_name','model_year','price_usd','status','mileage_km','transmission','fuel_type','steering','engine','color','location','cover_url','photo_kind'];
export const dynamic='force-dynamic';
export async function GET(){
  const list=await getVehicles();
  const inventory=(list as any[]).map(v=>Object.fromEntries(PUBLIC_FIELDS.filter(k=>k in v).map(k=>[k,v[k]])));
  return Response.json({inventory});
}
