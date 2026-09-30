import { getVehicles } from '../../lib/vehicles';
import VehicleGrid from '../../components/VehicleGrid';
export const dynamic = 'force-dynamic';
export default async function Page() {
  const list = await getVehicles({ category: 'motorcycle' });
  const demo=list.some((v:any)=>String(v.source||'').startsWith('demo_')); return <main className="wrap pageMoto"><h1>Motorcycles</h1><p>{list.length} listings{demo?' · Demo/test inventory shown until verified motorcycles are published':''}</p><VehicleGrid list={list} emptyTitle="No motorcycles listed right now" /></main>;
}
