import {getVehicles} from '../../../lib/vehicles';

// Public API: never expose internal fields (supplier flags, import source, legacy ids, internal specs).
const PRIVATE_FIELDS=['source','specs','legacy_id','supplier','supplier_id','source_url','base_price','internal_notes'];
export const dynamic='force-dynamic';
export async function GET(){
  const list=await getVehicles();
  const inventory=(list as any[]).map(v=>{const o:any={...v};for(const k of PRIVATE_FIELDS)delete o[k];return o});
  return Response.json({inventory});
}
