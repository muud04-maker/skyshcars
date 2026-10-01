import { getVehicles } from '../../lib/vehicles';
import VehicleGrid from '../../components/VehicleGrid';
import Pager, { pageOf } from '../../components/Pager';
export const dynamic = 'force-dynamic';
export const metadata = { title: 'Motorcycles for Sale from China | Sky Cars', description: 'Browse motorcycles in stock in China with export support from Sky Cars.' };
export default async function Page({ searchParams }: { searchParams: Promise<{ page?: string }> }) {
  const sp = await searchParams;
  const list = await getVehicles({ category: 'motorcycle' });
  const p = pageOf(list, sp.page);
  return <main className="wrap pageMoto"><h1>Motorcycles</h1><p>{list.length} listings</p><VehicleGrid list={p.items} emptyTitle="No motorcycles listed right now" /><Pager base="/motorcycles" {...p} /></main>;
}
