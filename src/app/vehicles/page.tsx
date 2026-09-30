import { getVehicles } from '../../lib/vehicles';
import VehicleGrid from '../../components/VehicleGrid';
export const dynamic = 'force-dynamic';
export default async function Vehicles() {
  const vs = await getVehicles();
  return <main className="wrap pageVehicles"><h1>Vehicles</h1><p className="muted">Contact us to confirm current availability before payment.</p><VehicleGrid list={vs} /></main>;
}
