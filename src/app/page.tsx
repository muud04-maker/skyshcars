import { getVehicles } from '../lib/vehicles';
import { WA_NUMBER, waLink, vehicleTitle } from '../lib/site';
import SkyCarsHomepage, {
  type SkyCarsHomepageProps,
  type SkyVehicle,
} from '../components/sky-cars-homepage/SkyCarsHomepage';

export const dynamic = 'force-dynamic';

function specsOf(value: any) {
  if (typeof value === 'object' && value) return value;
  try { return JSON.parse(String(value || '{}')); } catch { return {}; }
}

function exactImage(vehicle: any) {
  const url = String(vehicle?.exact_cover_url || '').trim();
  if (!url || vehicle?.photo_kind === 'representative') return null;
  if (url.includes('/api/model-photo/') || url.includes('/api/representative-photo/') || url.includes('/api/vehicle-art/') || url.includes('/demo/')) return null;
  return url;
}

function summaryOf(vehicle: any) {
  const specs = specsOf(vehicle.specs);
  const year = Number(vehicle.model_year) > 0 ? String(Number(vehicle.model_year)) : '';
  const engine = String(vehicle.engine || specs.engine || '').trim();
  const fuel = String(vehicle.fuel_type || specs.fuel || '').trim();
  const transmission = String(vehicle.transmission || specs.transmission || '').trim();
  const drive = String(specs.drive_type || specs.drivetrain || vehicle.drive_type || '').trim();
  const mileage = Number(vehicle.mileage_km) > 0 ? `${Number(vehicle.mileage_km).toLocaleString('en-US')} km` : '';
  return [year, engine, fuel, transmission, drive, mileage].filter(Boolean).join(' - ');
}

function mapVehicle(vehicle: any, category: SkyVehicle['category']): SkyVehicle | null {
  const price = Number(vehicle.price_usd);
  const imageUrl = exactImage(vehicle);
  if (!imageUrl || !Number.isFinite(price) || price <= 0) return null;
  const year = Number(vehicle.model_year);
  const title = vehicleTitle(vehicle);
  return {
    id: vehicle.id,
    title: Number(year) > 0 ? title.replace(new RegExp(`\\s+${year}$`), '') : title,
    priceUsd: price,
    imageUrl,
    href: `/vehicles/${vehicle.id}`,
    summary: summaryOf(vehicle),
    category,
  };
}

function uniqueTitles(vehicles: SkyVehicle[]) {
  const seen = new Set<string>();
  return vehicles.filter((vehicle) => {
    const key = vehicle.title
      .toLowerCase()
      .replace(/\b(19|20)\d{2}\b/g, '')
      .replace(/\s+/g, ' ')
      .trim();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export default async function Home() {
  const [carRows, motorcycleRows] = await Promise.all([
    getVehicles({ category: 'car', limit: 60, onlyAvailable: true, sort: 'created_desc' }).catch(() => [] as any[]),
    getVehicles({ category: 'motorcycle', limit: 60, onlyAvailable: true, sort: 'created_desc' }).catch(() => [] as any[]),
  ]);

  /*
    Amazon-style collection cards: each one is a 2x2 grid of REAL photo-backed, priced units from the
    available inventory, linking to the filtered catalogue. A card is only shown with 2+ real units.
  */
  const photoUnits = (list: any[], category: SkyVehicle['category']) => list
    .map((vehicle: any) => ({ raw: vehicle, card: mapVehicle(vehicle, category) }))
    .filter((x) => x.card) as { raw: any; card: SkyVehicle }[];
  const allCars = photoUnits(carRows, 'Cars');
  const allMotos = photoUnits(motorcycleRows, 'Motorcycles');
  const electric = allCars.filter((x) => /electric|hybrid|ev\b|phev/i.test(String(x.raw.fuel_type || '')));
  const budget = [...allCars, ...allMotos].filter((x) => Number(x.raw.price_usd) > 0 && Number(x.raw.price_usd) <= 5000)
    .sort((a, b) => Number(a.raw.price_usd) - Number(b.raw.price_usd));
  const collections: NonNullable<SkyCarsHomepageProps['collections']> = [
    { title: 'Motorcycles', href: '/motorcycles', link: 'See all motorcycles', items: uniqueTitles(allMotos.map((x) => x.card)).slice(0, 4) },
    { title: 'Cars & SUVs', href: '/cars', link: 'See all cars', items: uniqueTitles(allCars.map((x) => x.card)).slice(0, 4) },
    { title: 'Electric & hybrid', href: '/vehicles?fuel=electric', link: 'Shop electric', items: uniqueTitles(electric.map((x) => x.card)).slice(0, 4) },
    { title: 'Under $5,000', href: '/vehicles?maxPrice=5000', link: 'See budget picks', items: uniqueTitles(budget.map((x) => x.card)).slice(0, 4) },
  ].filter((c) => c.items.length >= 2);

  const cars = uniqueTitles(carRows.map((vehicle: any) => mapVehicle(vehicle, 'Cars')).filter(Boolean) as SkyVehicle[]).slice(0, 5);
  const motorcycles = uniqueTitles(motorcycleRows.map((vehicle: any) => mapVehicle(vehicle, 'Motorcycles')).filter(Boolean) as SkyVehicle[]).slice(0, 5);
  const vehicles = [...cars, ...motorcycles];
  const hero = cars[1] || cars[0] || motorcycles[0];
  const urls: NonNullable<SkyCarsHomepageProps['urls']> = {
    inventory: '/vehicles',
    account: '/account',
    saved: '/account#favorites',
    cart: '/account#favorites',
    tracking: '/tracking',
    shipping: '/shipping',
    quote: '/quote',
    faq: '/faq',
    about: '/about',
    contact: '/contact',
  };

  return <SkyCarsHomepage
    vehicles={vehicles}
    collections={collections}
    reviews={[]}
    heroImageUrl={hero?.imageUrl}
    heroVehicleTitle={hero?.title}
    whatsappUrl={waLink('Hello Sky Cars, I would like help choosing a vehicle.')}
    whatsappNumber={WA_NUMBER}
    urls={urls}
  />;
}
