const fs = require('fs');
const must = ['src/app/page.tsx','src/app/vehicles/page.tsx','src/app/cars/page.tsx','src/app/motorcycles/page.tsx',
  'src/lib/vehicles.ts','src/lib/ai.ts','src/app/api/whatsapp/webhook/route.ts',
  'database/Sky_Cars_Hostinger_MySQL_Master_Schema.sql','database/Sky_Cars_Import_198_Vehicles_Africa_Markets.sql'];
for (const f of must) if (!fs.existsSync(f)) throw Error('Missing ' + f);
for (const f of ['src/app/cars/page.tsx','src/app/motorcycles/page.tsx'])
  if (fs.readFileSync(f,'utf8').includes('inventory.json')) throw Error(f + ' must read the database, not inventory.json');
if (fs.existsSync('services/whatsapp')) throw Error('Old group reader still present');
console.log('Sky Cars V10 structure OK — inventory source: database');
