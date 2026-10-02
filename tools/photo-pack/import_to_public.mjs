import fs from 'node:fs';
import path from 'node:path';

const SRC = path.resolve('./tools/photo-pack/photos');
const OUT = path.resolve('./public/uploads/vehicles');
fs.mkdirSync(OUT, { recursive: true });

function copyFile(src, dest) {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(src, dest);
}

if (!fs.existsSync(SRC)) {
  console.error('No downloaded photo folders found at tools/photo-pack/photos');
  process.exit(1);
}

for (const stockNo of fs.readdirSync(SRC)) {
  const srcDir = path.join(SRC, stockNo);
  if (!fs.statSync(srcDir).isDirectory()) continue;
  const outDir = path.join(OUT, stockNo);
  fs.mkdirSync(outDir, { recursive: true });

  let manifest = { stock_no: stockNo, note: 'Representative model photos', photos: [] };
  const manifestPath = path.join(srcDir, 'manifest.json');
  if (fs.existsSync(manifestPath)) {
    try { manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8')); } catch {}
  }

  const entries = [];
  const imageFiles = fs.readdirSync(srcDir).filter((f) => /\.(jpg|jpeg|png|webp)$/i.test(f)).sort();
  for (const [index, file] of imageFiles.entries()) {
    const srcFile = path.join(srcDir, file);
    const outFile = path.join(outDir, file);
    copyFile(srcFile, outFile);
    const found = Array.isArray(manifest.photos) ? manifest.photos.find((p) => path.basename(String(p.file || '')) === file) : null;
    entries.push({
      file: `uploads/vehicles/${stockNo}/${file}`,
      public_file: `/uploads/vehicles/${stockNo}/${file}`,
      title: found?.title || `Representative photo ${index + 1}`,
      source_page: found?.source_page || '',
      license: found?.license || '',
      artist: found?.artist || '',
      query: found?.query || '',
      representative: true,
    });
  }

  fs.writeFileSync(path.join(outDir, 'manifest.json'), JSON.stringify({
    stock_no: stockNo,
    note: 'Representative model photos from licensed/public internet sources. Not guaranteed to depict the exact physical stock unit unless later verified.',
    photos: entries,
  }, null, 2));

  console.log(`Imported ${stockNo}: ${entries.length} photos`);
}

console.log('Representative photo import complete.');
