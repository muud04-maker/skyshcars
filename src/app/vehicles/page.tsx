import { getVehicles } from '../../lib/vehicles';
import VehicleGrid from '../../components/VehicleGrid';
export const dynamic = 'force-dynamic';
export default async function Vehicles({searchParams}:{searchParams:Promise<{q?:string;brand?:string}>}) {
  const sp=await searchParams;const vs=await getVehicles({search:sp.q||'',brand:sp.brand||''});
  return <main className="wrap pageVehicles"><div className="catalogTop"><div><span className="eyebrow">SKY CARS STOCK</span><h1>Vehicles</h1><p className="muted">Search current stock. Contact us to confirm availability before payment.</p></div><form className="catalogSearch" action="/vehicles"><input name="q" defaultValue={sp.q||''} placeholder="Search by brand, model or stock number"/><button className="btn">Search</button></form></div><VehicleGrid list={vs} emptyTitle="No matching vehicle found"/></main>;
}
