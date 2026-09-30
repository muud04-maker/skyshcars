import { getVehicles } from '../../lib/vehicles';
import VehicleGrid from '../../components/VehicleGrid';
export const dynamic = 'force-dynamic';
export default async function Page() {
  const list = await getVehicles({ category: 'car' });
  return <main className="wrap pageCars"><h1>Cars</h1><p>{list.length} listings</p><VehicleGrid list={list} emptyTitle="No cars listed right now" /></main>;
}
