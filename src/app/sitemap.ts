import type { MetadataRoute } from 'next';
import { getVehicles } from '../lib/vehicles';
import { SITE_URL } from '../lib/site';
export const dynamic = 'force-dynamic';
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const pages = ['', '/vehicles', '/cars', '/motorcycles', '/quote', '/shipping', '/destinations', '/tracking', '/about', '/contact', '/faq', '/privacy', '/terms']
    .map(p => ({ url: SITE_URL + p, changeFrequency: 'weekly' as const, priority: p === '' ? 1 : 0.7 }));
  let vehicles: MetadataRoute.Sitemap = [];
  try {
    const list: any[] = await getVehicles({ limit: 1000 });
    vehicles = list.filter(v => v.status !== 'hidden').map(v => ({ url: `${SITE_URL}/vehicles/${v.id}`, changeFrequency: 'weekly' as const, priority: 0.6 }));
  } catch { /* sitemap still lists static pages when the database is unavailable */ }
  return [...pages, ...vehicles];
}
