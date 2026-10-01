import { getVehicles } from '../../lib/vehicles';
import VehicleGrid from '../../components/VehicleGrid';
import Pager, { pageOf } from '../../components/Pager';
export const dynamic = 'force-dynamic';
export const metadata = { title: 'Cars for Sale from China | Sky Cars', description: 'Browse cars in stock in China with price, year, mileage and export support from Sky Cars.' };
export default async function Page({ searchParams }: { searchParams: Promise<{ page?: string }> }) {
  const sp = await searchParams;
  const list = await getVehicles({ category: 'car' });
  const p = pageOf(list, sp.page);
  return <main className="wrap pageCars"><h1>Cars</h1><p>{list.length} listings</p><VehicleGrid list={p.items} emptyTitle="No cars listed right now" /><Pager base="/cars" {...p} /></main>;
}
