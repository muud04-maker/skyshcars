const fs=require('fs');
const must=[
 'src/app/page.tsx','src/app/vehicles/page.tsx','src/app/cars/page.tsx','src/app/motorcycles/page.tsx',
 'src/lib/vehicles.ts','src/app/quote/QuoteForm.tsx','src/app/login/page.tsx','src/app/signup/page.tsx','src/auth.ts',
 'src/app/admin/launch/page.tsx','src/app/admin/launch/LaunchReadiness.tsx','src/app/api/admin/readiness/route.ts','src/lib/readiness.ts',
 'src/app/admin/social/SocialPublisher.tsx','src/app/api/admin/social/route.ts','src/lib/social.ts',
 'src/app/admin/automation/AutomationClient.tsx','src/lib/automation.ts',
 'src/app/admin/group-reader/GroupReaderClient.tsx','tools/whatsapp-group-bridge/server.js','tools/whatsapp-group-bridge/SETUP_GROUP_READER_WINDOWS.ps1','tools/whatsapp-group-bridge/INSTALL_STARTUP_TASK.ps1',
 'src/app/api/facebook/webhook/route.ts','src/app/lab/page.tsx','proxy.ts','data/shipping_reference.json','V31_READ_THIS_FIRST.txt'
];
for(const f of must)if(!fs.existsSync(f))throw Error('Missing '+f);
const ready=fs.readFileSync('src/lib/readiness.ts','utf8');if(!ready.includes('checkFacebookPage')||!ready.includes('last_heartbeat_at'))throw Error('Live readiness checks missing');
const social=fs.readFileSync('src/lib/social.ts','utf8');if(!social.includes("exactPhotoSql('m')")||!social.includes('link: `${SITE}/vehicles/${v.id}`')||!social.includes('NO_EXACT_PHOTO_LINE'))throw Error('Safe Facebook real-photo/link-post behavior missing');
const group=fs.readFileSync('src/app/admin/group-reader/GroupReaderClient.tsx','utf8');if(!group.includes('OFFLINE')||!group.includes('INSTALL_STARTUP_TASK.ps1'))throw Error('Group Reader production status/setup missing');
const aut=fs.readFileSync('src/app/admin/automation/AutomationClient.tsx','utf8');if(!aut.includes('Use safe sell-now preset'))throw Error('Sell-now automation preset missing');
const fb=fs.readFileSync('src/app/api/facebook/webhook/route.ts','utf8');const fbLib=fs.readFileSync('src/lib/facebook.ts','utf8');if(!fb.includes('checkSignature')||!fbLib.includes('META_GRAPH_VERSION'))throw Error('Facebook Messenger Graph version fix missing');
console.log('Sky Cars V31 structure OK — live Facebook, Sell Now readiness, safe social posting, Group Reader production scripts and automation preset present.');
