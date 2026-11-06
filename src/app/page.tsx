import { getVehicles } from '../lib/vehicles';
import { waLink, vehicleTitle } from '../lib/site';
import SkyCarsHomepage, {
  type SkyBrand,
  type SkyCategory,
  type SkyVehicle,
} from '../components/sky-cars-homepage/SkyCarsHomepage';

export const dynamic = 'force-dynamic';

function specsOf(value: any) {
  if (typeof value === 'object' && value) return value;
  try { return JSON.parse(String(value || '{}')); } catch { return {}; }
}

function categoryLabel(vehicle: any) {
  const fuel = String(vehicle.fuel_type || '').toLowerCase();
  const specs = specsOf(vehicle.specs);
  const body = String(specs.body_type || vehicle.body_type || '').toLowerCase();
  if (/(electric|hybrid|phev)/.test(fuel)) return 'Electric';
  if (body.includes('suv')) return 'SUVs';
  if (body.includes('pickup')) return 'Pickups';
  if (String(vehicle.category || '') === 'motorcycle') return 'Motorcycles';
  if (['van', 'bus'].includes(String(vehicle.category || ''))) return 'Vans & Buses';
  if (['truck', 'machinery'].includes(String(vehicle.category || ''))) return 'Commercial';
  return 'Cars';
}

function exactImage(vehicle: any) {
  const url = String(
    vehicle?.exact_cover_url
      ?? (vehicle?.exact_cover_url === undefined ? vehicle?.cover_url : '')
      ?? ''
  ).trim();
  if (!url || vehicle?.photo_kind === 'representative') return null;
  if (url.includes('/api/model-photo/') || url.includes('/api/representative-photo/') || url.includes('/api/vehicle-art/') || url.includes('/demo/')) return null;
  return url;
}

export default async function Home() {
  const rows = await getVehicles({ limit: 300, onlyAvailable: true, sort: 'created_desc' }).catch(() => [] as any[]);
  const vehicles: SkyVehicle[] = rows.map((vehicle: any) => ({
    id: vehicle.id,
    title: vehicleTitle(vehicle),
    priceUsd: Number(vehicle.price_usd) > 0 ? Number(vehicle.price_usd) : null,
    imageUrl: exactImage(vehicle),
    href: `/vehicles/${vehicle.id}`,
    category: categoryLabel(vehicle),
    brand: String(vehicle.brand || '').trim() || undefined,
    year: Number(vehicle.model_year) || undefined,
    mileageKm: vehicle.mileage_km == null ? null : Number(vehicle.mileage_km),
    fuel: String(vehicle.fuel_type || '').trim() || undefined,
    transmission: String(vehicle.transmission || '').trim() || undefined,
    country: 'China',
    available: String(vehicle.status || '') === 'available',
  }));

  const categoryNames = ['Cars', 'Motorcycles', 'Electric', 'SUVs', 'Pickups', 'Vans & Buses', 'Commercial', 'Sold Vehicles'];
  const categoryHref: Record<string, string> = {
    Cars: '/cars', Motorcycles: '/motorcycles', Electric: '/vehicles?fuel=electric',
    SUVs: '/vehicles?body=SUV', Pickups: '/vehicles?body=pickup',
    'Vans & Buses': '/vehicles?category=van', Commercial: '/vehicles?category=truck',
    'Sold Vehicles': '/sold-vehicles',
  };
  const categories: SkyCategory[] = categoryNames.map((label) => ({
    label,
    href: categoryHref[label],
    imageUrl: vehicles.find((vehicle) => vehicle.category === label && vehicle.imageUrl)?.imageUrl || null,
  }));
  const brands: SkyBrand[] = [...new Set(vehicles.map((vehicle) => String(vehicle.brand || '').trim()).filter(Boolean))]
    .sort()
    .map((name) => ({ name, href: `/vehicles?brand=${encodeURIComponent(name)}` }));
  const exactVehicles = vehicles.filter((vehicle) => vehicle.imageUrl);
  const heroImageUrl = exactVehicles[0]?.imageUrl || undefined;
  const shippingImageUrl = exactVehicles[1]?.imageUrl || heroImageUrl;
  const requestImageUrl = exactVehicles[2]?.imageUrl || heroImageUrl;

  return <SkyCarsHomepage
    vehicles={vehicles}
    categories={categories}
    brands={brands}
    heroImageUrl={heroImageUrl}
    shippingImageUrl={shippingImageUrl}
    requestImageUrl={requestImageUrl}
    whatsappUrl={waLink('Hello Sky Cars, I would like help choosing a vehicle.')}
    urls={{
      inventory: '/vehicles', account: '/account', compare: '/compare', saved: '/account#favorites',
      tracking: '/tracking', signup: '/signup', shipping: '/shipping', quote: '/quote',
      faq: '/faq', about: '/about',
    }}
  />;
}
