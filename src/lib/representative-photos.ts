import fs from 'node:fs';
import path from 'node:path';

export type RepresentativePhoto = {
  url: string;
  caption?: string;
  source?: string;
  isRepresentative: true;
};

function safeStock(stockNo?: string | null) {
  return String(stockNo || '').replace(/[^a-zA-Z0-9._-]+/g, '_').slice(0, 120);
}

const PROJECT_ROOT = process.cwd();
const PUBLIC_ROOT = path.join(PROJECT_ROOT, 'public', 'uploads', 'vehicles');
const TOOL_ROOT = path.join(PROJECT_ROOT, 'tools', 'photo-pack', 'photos');

function firstExistingDir(stockNo: string) {
  const folder = safeStock(stockNo);
  const candidates = [path.join(PUBLIC_ROOT, folder), path.join(TOOL_ROOT, folder)];
  return candidates.find((p) => fs.existsSync(p) && fs.statSync(p).isDirectory()) || null;
}

function publicUrlFromFile(filePath: string, stockNo: string) {
  const normalized = filePath.replaceAll('\\', '/');
  if (normalized.startsWith('/')) return normalized;
  if (normalized.startsWith('public/')) return '/' + normalized.slice('public/'.length);
  if (normalized.startsWith('uploads/')) return '/' + normalized;
  if (normalized.startsWith('photos/')) {
    const filename = path.basename(normalized);
    return `/api/representative-photo/${encodeURIComponent(stockNo)}/${encodeURIComponent(filename)}`;
  }
  return `/api/representative-photo/${encodeURIComponent(stockNo)}/${encodeURIComponent(path.basename(filePath))}`;
}

export function getRepresentativePhotos(stockNo?: string | null): RepresentativePhoto[] {
  const stock = safeStock(stockNo);
  if (!stock) return [];
  const dir = firstExistingDir(stock);
  if (!dir) return [];

  const manifestPath = path.join(dir, 'manifest.json');
  try {
    if (fs.existsSync(manifestPath)) {
      const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
      const list = Array.isArray(manifest?.photos) ? manifest.photos : [];
      const mapped = list
        .map((item: any, idx: number) => {
          const rel = String(item?.public_file || item?.file || '').trim();
          if (!rel) return null;
          return {
            url: publicUrlFromFile(rel, stock),
            caption: item?.title || item?.caption || `Representative photo ${idx + 1}`,
            source: item?.source_page || item?.source || '',
            isRepresentative: true as const,
          };
        })
        .filter(Boolean) as RepresentativePhoto[];
      if (mapped.length) return mapped;
    }
  } catch {}

  const files = fs.readdirSync(dir)
    .filter((name) => /\.(jpg|jpeg|png|webp)$/i.test(name))
    .sort((a, b) => a.localeCompare(b));
  return files.map((name, idx) => ({
    url: dir.startsWith(PUBLIC_ROOT)
      ? `/uploads/vehicles/${encodeURIComponent(stock)}/${encodeURIComponent(name)}`
      : `/api/representative-photo/${encodeURIComponent(stock)}/${encodeURIComponent(name)}`,
    caption: `Representative photo ${idx + 1}`,
    source: '',
    isRepresentative: true as const,
  }));
}

export function getRepresentativeCover(stockNo?: string | null) {
  return getRepresentativePhotos(stockNo)[0] || null;
}

export function hasRepresentativePhotos(stockNo?: string | null) {
  return getRepresentativePhotos(stockNo).length > 0;
}
