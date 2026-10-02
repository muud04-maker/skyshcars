require('dotenv').config();
const qrcode=require('qrcode-terminal');
const {Client,LocalAuth}=require('whatsapp-web.js');
const base=(process.env.SKY_CARS_URL||'https://skyshcars.com').replace(/\/$/,'');
const secret=process.env.WHATSAPP_SERVICE_SECRET||'';
const bridgeId=process.env.BRIDGE_ID||'primary';
if(!secret){console.error('WHATSAPP_SERVICE_SECRET is missing');process.exit(1)}
let allowed=[];let account='';let visible=0;const pending=new Map();
async function api(path,opts={}){return fetch(base+path,{...opts,headers:{'x-sky-secret':secret,'Content-Type':'application/json',...(opts.headers||{})}})}
async function refreshConfig(){try{const r=await api('/api/bridge/whatsapp-group/config');if(!r.ok)throw new Error(await r.text());const j=await r.json();allowed=(j.groups||[]).map(g=>({name:String(g.group_name||'').trim().toLowerCase(),id:String(g.group_external_id||'')}));console.log('Authorized groups:',allowed.map(x=>x.name).join(', ')||'(none)')}catch(e){console.error('Config refresh failed:',e.message)}}
function groupAllowed(chat){const name=String(chat.name||'').trim().toLowerCase();const id=String(chat.id?._serialized||'');return allowed.some(x=>x.name===name||(x.id&&x.id===id))}
async function heartbeat(status='online'){try{await api('/api/bridge/whatsapp-group/heartbeat',{method:'POST',body:JSON.stringify({bridgeId,status,whatsappAccount:account,visibleGroups:visible,version:'27',details:{authorized:allowed.length}})})}catch{}}
async function flush(key){const x=pending.get(key);if(!x)return;pending.delete(key);try{const payload={messageId:x.ids.sort().join('+'),messageIds:x.ids,groupName:x.groupName,groupId:x.groupId,sender:x.sender,text:x.texts.filter(Boolean).join('\n'),receivedAt:x.receivedAt,media:x.media};const r=await api('/api/bridge/whatsapp-group',{method:'POST',body:JSON.stringify(payload)});const out=await r.text();if(!r.ok)console.error('Bridge upload failed',r.status,out);else console.log('Inventory draft sent:',payload.groupName,payload.messageId)}catch(e){console.error('Flush failed',e)}}
const client=new Client({authStrategy:new LocalAuth({clientId:'sky-cars-group-reader-v27'}),puppeteer:{headless:true,args:['--no-sandbox','--disable-setuid-sandbox']}});
client.on('qr',qr=>{console.log('Scan this QR with the Sky Cars WhatsApp account:');qrcode.generate(qr,{small:true})});
client.on('ready',async()=>{console.log('Sky Cars V27 group bridge READY');const info=client.info||{};account=String(info.wid?._serialized||'');const chats=await client.getChats();visible=chats.filter(c=>c.isGroup).length;await refreshConfig();await heartbeat();setInterval(refreshConfig,60000);setInterval(()=>heartbeat('online'),60000)});
client.on('auth_failure',m=>{console.error('WhatsApp authentication failed:',m);heartbeat('auth_failed')});
client.on('disconnected',r=>{console.error('WhatsApp disconnected:',r);heartbeat('disconnected')});
client.on('message_create',async msg=>{try{const chat=await msg.getChat();if(!chat.isGroup||!groupAllowed(chat))return;const body=String(msg.body||'').trim();if(!body&&!msg.hasMedia)return;const groupId=String(chat.id?._serialized||'');const sender=String(msg.author||msg.from||'');const key=groupId+'|'+sender;let x=pending.get(key);if(!x){x={ids:[],groupName:chat.name,groupId,sender,texts:[],media:[],receivedAt:new Date().toISOString(),timer:null};pending.set(key,x)}x.ids.push(msg.id?._serialized||String(Date.now()));if(body)x.texts.push(body);if(msg.hasMedia){try{const m=await msg.downloadMedia();if(m?.data&&/^image\//i.test(m.mimetype||''))x.media.push({data:m.data,mimeType:m.mimetype||'image/jpeg',filename:m.filename||null})}catch(e){console.error('Media download failed',e.message)}}clearTimeout(x.timer);x.timer=setTimeout(()=>flush(key),5000)}catch(e){console.error('GROUP_MESSAGE_ERROR',e)}});
client.initialize();
