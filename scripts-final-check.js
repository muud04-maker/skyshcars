const fs=require('fs');
const path=require('path');
function fail(m){console.error('FINAL CHECK FAILED:',m);process.exitCode=1}
const pkg=JSON.parse(fs.readFileSync('package.json','utf8'));
if(!String(pkg.scripts?.build||'').includes('next build --webpack')) fail('Hostinger webpack build flag missing');
const list=JSON.parse(fs.readFileSync('data/v16_last_50.json','utf8'));
if(list.length!==50) fail('Last-50 file must contain exactly 50 records');
if(new Set(list.map(x=>x.stock_no)).size!==50) fail('Last-50 stock numbers are not unique');
const card=fs.readFileSync('src/components/VehicleCard.tsx','utf8');
if(/Reference image/i.test(card)) fail('Visible Reference image wording remains in VehicleCard');
const vehicles=fs.readFileSync('src/lib/vehicles.ts','utf8');
if(!vehicles.includes("pending_verification")) fail('Full active inventory is not included');
if(!vehicles.includes("LIKE ?")) fail('Flexible brand filtering missing');
const sup=fs.readFileSync('src/app/api/admin/suppliers/sync/route.ts','utf8');
if(!sup.includes('publishItem')||!sup.includes('supplierPrice+markup')) fail('Supplier direct import/markup missing');
if(!fs.existsSync('src/lib/media-store.ts')||!fs.existsSync('src/app/media/[name]/route.ts')) fail('Database photo storage missing');
if(/Mozilla/.test(sup)) fail('Supplier sync must not impersonate a browser');
const api=fs.readFileSync('src/app/api/vehicles/route.ts','utf8');
if(!api.includes('PRIVATE_FIELDS')) fail('Public vehicle API does not strip private fields');
for(const f of ['src/app/robots.ts','src/app/sitemap.ts','src/app/not-found.tsx','src/app/error.tsx','src/lib/ratelimit.ts','src/components/VehicleGallery.tsx']) if(!fs.existsSync(f)) fail('Missing '+f);
if(!/X-Frame-Options/.test(fs.readFileSync('next.config.mjs','utf8'))) fail('Security headers missing');
if(!/rateLimit\(/.test(fs.readFileSync('src/app/api/admin/login/route.ts','utf8'))) fail('Login rate limit missing');

const hgm=fs.readFileSync('src/lib/hgm-scraper.ts','utf8');
if(!hgm.includes('535')&&!hgm.includes('totalVehicles')) fail('HGM full catalogue detection missing');
if(!hgm.includes('/uploads/vehicles/${id}/')) fail('HGM per-vehicle gallery filter missing');
const hgmRoute=fs.readFileSync('src/app/api/admin/suppliers/hgm-page/route.ts','utf8');
if(!hgmRoute.includes('Supplier stock photo')||!hgmRoute.includes('supplier_vehicle_map')) fail('HGM stable import/gallery upsert missing');
if(!vehicles.includes("category='motorcycle'")||!vehicles.includes("status='hidden'")) fail('Invalid legacy motorcycle cleanup missing');
if(/api\/model-photo/.test(card)) fail('Vehicle cards still use unrelated model-photo fallback');
const catalog=fs.readFileSync('src/components/CatalogFilters.tsx','utf8');
for(const token of ['Brand','Body Type','Steering','Fuel Type','Min price','Max price','Min year','Max year','Min mileage','Max mileage','Stock Status']) if(!catalog.includes(token)) fail('Catalog filter missing: '+token);

console.log('FINAL CHECK OK: 50 extra vehicles, full-active inventory query, no public Reference badge, supplier import + markup, Hostinger webpack build.');

// Resolve all relative imports so a bad ../ path is caught before npm build.
function walk(dir){
  return fs.readdirSync(dir,{withFileTypes:true}).flatMap(e=>{
    const p=path.join(dir,e.name); return e.isDirectory()?walk(p):[p];
  });
}
for(const file of walk('src').filter(f=>/\.(ts|tsx|js|jsx)$/.test(f))){
  const text=fs.readFileSync(file,'utf8');
  const re=/(?:from\s+|import\s*\()(['"])(\.[^'"]+)\1/g;
  let m;
  while((m=re.exec(text))){
    const base=path.resolve(path.dirname(file),m[2]);
    const candidates=[base,base+'.ts',base+'.tsx',base+'.js',base+'.jsx',path.join(base,'index.ts'),path.join(base,'index.tsx'),path.join(base,'index.js'),path.join(base,'index.jsx')];
    if(!candidates.some(p=>fs.existsSync(p))) fail(`Unresolved relative import in ${file}: ${m[2]}`);
  }
}
