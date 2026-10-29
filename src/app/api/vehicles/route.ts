import {getVehicles} from '../../../lib/vehicles';

// Public API: whitelist only customer-facing fields (no source, specs, supplier data, descriptions or internal ids).
const PUBLIC_FIELDS=['id','stock_no','category','brand','model','trim_name','model_year','price_usd','status','mileage_km','transmission','fuel_type','steering','engine','color','location','cover_url','photo_kind'];
export const dynamic='force-dynamic';

function textParam(params: URLSearchParams, key: string, max = 120) {
  return String(params.get(key) || '').trim().slice(0, max) || undefined;
}

function numberParam(params: URLSearchParams, key: string) {
  const raw = params.get(key);
  if (raw == null || raw === '') return undefined;
  const value = Number(raw);
  return Number.isFinite(value) ? value : undefined;
}

export async function GET(request: Request){
  const params = new URL(request.url).searchParams;
  const stock = textParam(params, 'stock', 20);
  const list=await getVehicles({
    limit: Math.max(1, Math.min(500, numberParam(params, 'limit') || 1200)),
    offset: Math.max(0, numberParam(params, 'offset') || 0),
    category: textParam(params, 'category', 30),
    search: textParam(params, 'q'),
    brand: textParam(params, 'brand'),
    steering: textParam(params, 'steering', 3),
    fuel: textParam(params, 'fuel', 80),
    bodyType: textParam(params, 'body', 80),
    transmission: textParam(params, 'transmission', 80),
    engine: textParam(params, 'engine', 120),
    minPrice: numberParam(params, 'minPrice'),
    maxPrice: numberParam(params, 'maxPrice'),
    minYear: numberParam(params, 'minYear'),
    maxYear: numberParam(params, 'maxYear'),
    minMileage: numberParam(params, 'minMileage'),
    maxMileage: numberParam(params, 'maxMileage'),
    stock,
    sort: textParam(params, 'sort', 30),
    onlyAvailable: stock === 'available',
    stockStatus: stock === 'sold' ? 'sold' : stock === 'all' ? 'all' : 'available',
  });
  const inventory=(list as any[]).map(v=>Object.fromEntries(PUBLIC_FIELDS.filter(k=>k in v).map(k=>[k,v[k]])));
  return Response.json({inventory});
}
