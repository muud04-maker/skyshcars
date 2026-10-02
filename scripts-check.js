const fs=require('fs');
const must=[
 'src/app/page.tsx','src/app/vehicles/page.tsx','src/app/cars/page.tsx','src/app/motorcycles/page.tsx',
 'src/lib/vehicles.ts','src/app/api/model-photo/[id]/[index]/route.ts','src/app/quote/QuoteForm.tsx',
 'src/app/login/page.tsx','src/app/signup/page.tsx','src/auth.ts','src/app/api/auth/[...nextauth]/route.ts',
 'src/app/admin/vehicles/_components/VehicleManager.tsx','src/app/api/admin/vehicles/route.ts',
 'src/app/admin/shipments/ShipmentsClient.tsx','src/app/api/admin/shipments/route.ts',
 'src/app/admin/automation/AutomationClient.tsx','src/app/api/admin/automation/route.ts',
 'tools/whatsapp-group-bridge/server.js','src/app/admin/group-reader/page.tsx','src/app/lab/page.tsx','proxy.ts',
 'data/shipping_reference.json','database/Sky_Cars_Hostinger_MySQL_Master_Schema.sql','DEPLOY_NOW.ps1'
];
for(const f of must)if(!fs.existsSync(f))throw Error('Missing '+f);
const q=fs.readFileSync('src/app/quote/QuoteForm.tsx','utf8');if(!q.includes('Choose country')||!q.includes('Email <span className="muted">(optional)'))throw Error('Quote selector/optional email fix missing');
const sh=fs.readFileSync('src/app/admin/shipments/ShipmentsClient.tsx','utf8');if(!sh.includes('+ Add Shipment'))throw Error('Shipment creation UI missing');
const au=fs.readFileSync('src/app/admin/automation/AutomationClient.tsx','utf8');if(!au.includes('automationToggle'))throw Error('Automation layout fix missing');
const veh=fs.readFileSync('src/lib/vehicles.ts','utf8');if(!veh.includes('/api/model-photo/'))throw Error('Representative photo fallback missing');
const auth=fs.readFileSync('src/auth.ts','utf8');if(!auth.includes('Customer account created via'))throw Error('Customer social-account sync missing');
const proxy=fs.readFileSync('proxy.ts','utf8');if(!proxy.includes('LAB_PATH_FALLBACK'))throw Error('Lab path fallback missing');
console.log('Sky Cars V30.1 structure OK — photo fallback, social accounts, quote selectors, vehicle update, shipments, automation and Lab fallback are present.');
