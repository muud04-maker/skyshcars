require('dotenv').config();
const qrcode=require('qrcode-terminal');
const {Client,LocalAuth}=require('whatsapp-web.js');

/*
  Sky Cars WhatsApp Group Reader bridge. READ-ONLY: this program never sends anything to WhatsApp.
  Runs unattended on a VPS under Docker (restart: unless-stopped) or pm2 (autorestart).
  On a fatal error it exits with code 1 so the supervisor restarts it cleanly.
  The WhatsApp login is saved in ./.wwebjs_auth (a Docker volume), so the QR is scanned only once.
*/
const base=(process.env.SKY_CARS_URL||'https://skyshcars.com').replace(/\/$/,'');
const secret=process.env.WHATSAPP_SERVICE_SECRET||'';
const bridgeId=process.env.BRIDGE_ID||'primary';
const VERSION='33';
// Messages from the same supplier in the same group within this quiet window form ONE post (photos + caption).
// The website also merges a caption/photos sent up to 3 minutes apart into the same pending vehicle.
const POST_WINDOW_MS=Number(process.env.POST_WINDOW_MS||20000);

const ts=()=>new Date().toISOString().replace('T',' ').slice(0,19);
const log=(...a)=>console.log(ts(),'[INFO]',...a);
const warn=(...a)=>console.warn(ts(),'[WARN]',...a);
const fail=(...a)=>console.error(ts(),'[ERROR]',...a);

process.on('unhandledRejection',e=>fail('Unhandled promise rejection:',e?.message||e));
process.on('uncaughtException',e=>{fail('Crash:',e?.stack||e);process.exit(1)});
for(const sig of ['SIGINT','SIGTERM'])process.on(sig,async()=>{log(`Received ${sig}, shutting down.`);try{await client?.destroy()}catch{}process.exit(0)});

if(!secret){
  // Do not crash-loop: wait and explain until the setting is added and the bridge restarted.
  const msg='WHATSAPP_SERVICE_SECRET is empty in .env. Add the same value as on the website, then restart the bridge.';
  fail(msg);setInterval(()=>fail(msg),5*60*1000);
  return;
}

let allowed=[];let account='';let visible=0;let state='starting';let lastError='';let sentPosts=0;
const pending=new Map();

async function api(path,opts={}){return fetch(base+path,{...opts,headers:{'x-sky-secret':secret,'Content-Type':'application/json',...(opts.headers||{})}})}
async function refreshConfig(){try{const r=await api('/api/bridge/whatsapp-group/config');if(!r.ok)throw new Error(`HTTP ${r.status} ${(await r.text()).slice(0,200)}`);const j=await r.json();allowed=(j.groups||[]).map(g=>({name:String(g.group_name||'').trim().toLowerCase(),id:String(g.group_external_id||'')}));log('Authorized groups:',allowed.map(x=>x.name).join(', ')||'(none)')}catch(e){lastError='config: '+e.message;fail('Could not load authorized groups from the website:',e.message)}}
function groupAllowed(chat){const name=String(chat.name||'').trim().toLowerCase();const id=String(chat.id?._serialized||'');return allowed.some(x=>x.name===name||(x.id&&x.id===id))}
async function heartbeat(status=state){state=status;try{await api('/api/bridge/whatsapp-group/heartbeat',{method:'POST',body:JSON.stringify({bridgeId,status,whatsappAccount:account,visibleGroups:visible,version:VERSION,details:{authorized:allowed.length,pendingPosts:pending.size,sentPosts,lastError:lastError||null}})})}catch(e){warn('Heartbeat failed:',e.message)}}

async function upload(payload,attempt=1){
  try{
    const r=await api('/api/bridge/whatsapp-group',{method:'POST',body:JSON.stringify(payload)});const out=await r.text();
    if(r.ok){sentPosts++;log('Post sent to website:',payload.groupName,payload.messageIds.length,'message(s),',payload.media.length,'photo(s)');return}
    // 4xx (unauthorized group, disabled reader) will not succeed on retry.
    if(r.status>=400&&r.status<500){lastError=`upload ${r.status}`;fail('Website rejected post',r.status,out.slice(0,200));return}
    throw new Error(`HTTP ${r.status} ${out.slice(0,200)}`);
  }catch(e){
    lastError='upload: '+e.message;
    if(attempt>=4){fail('Upload failed permanently:',e.message);return}
    const wait=attempt*30000;warn(`Upload failed (attempt ${attempt}), retrying in ${wait/1000}s:`,e.message);
    setTimeout(()=>upload(payload,attempt+1),wait); // the website ignores duplicates, so retries are safe
  }
}

/** Logs ONE group message (text, photos, sender, time) to the website. Resolves true once stored. */
async function logMessage(entry,attempt=1){
  try{
    const r=await api('/api/bridge/whatsapp-group/log',{method:'POST',body:JSON.stringify(entry)});
    if(r.ok)return true;
    if(r.status>=400&&r.status<500){warn('Website refused message log',r.status,(await r.text()).slice(0,200));return false}
    throw new Error(`HTTP ${r.status}`);
  }catch(e){
    if(attempt>=4){fail('Message log failed permanently:',e.message);return false}
    await new Promise(res=>setTimeout(res,attempt*15000));
    return logMessage(entry,attempt+1); // the website ignores duplicates, so retries are safe
  }
}

async function flush(key,x){
  if(pending.get(key)!==x)return;
  if(x.inflight>0){x.timer=setTimeout(()=>flush(key,x),2000);return} // a photo is still downloading
  pending.delete(key);
  // Photos were stored by the message log; the website reuses them. Only re-send photo data if a log failed.
  const logged=(await Promise.all(x.logs)).every(Boolean);
  const payload={messageId:[...x.ids].sort().join('+'),messageIds:x.ids,groupName:x.groupName,groupId:x.groupId,sender:x.sender,senderPhone:x.senderPhone,senderName:x.senderName,text:x.texts.filter(Boolean).join('\n'),receivedAt:x.receivedAt,photoCount:x.media.length,media:logged?[]:x.media};
  upload(payload);
}

const puppeteer={headless:true,args:['--no-sandbox','--disable-setuid-sandbox','--disable-dev-shm-usage','--disable-gpu']};
if(process.env.PUPPETEER_EXECUTABLE_PATH)puppeteer.executablePath=process.env.PUPPETEER_EXECUTABLE_PATH; // system Chromium inside Docker
const client=new Client({authStrategy:new LocalAuth({clientId:'sky-cars-group-reader-v27'}),puppeteer});

client.on('qr',qr=>{
  log('==================== WHATSAPP LOGIN NEEDED ====================');
  log('On the Sky Cars phone: WhatsApp > Settings > Linked devices > Link a device, then scan this QR:');
  qrcode.generate(qr,{small:true});
  log('The QR changes every ~20 seconds; if it expires, a new one is printed below.');
  heartbeat('qr_required');
});
client.on('authenticated',()=>log('WhatsApp login accepted; session saved.'));
client.on('ready',async()=>{log(`Sky Cars Group Reader v${VERSION} READY (read-only, never sends messages)`);const info=client.info||{};account=String(info.wid?._serialized||'');try{const chats=await client.getChats();visible=chats.filter(c=>c.isGroup).length}catch{}await refreshConfig();lastError='';await heartbeat('online')});
client.on('auth_failure',async m=>{fail('WhatsApp login failed:',m,'- delete the saved session and scan the QR again (see SETUP_VPS.md).');lastError='auth_failure';await heartbeat('auth_failed');setTimeout(()=>process.exit(1),60000)});
client.on('disconnected',async r=>{fail('WhatsApp disconnected:',r,'- restarting in 30 s.');lastError='disconnected: '+r;await heartbeat('disconnected');setTimeout(()=>process.exit(1),30000)});
client.on('message_create',async msg=>{
  try{
    const chat=await msg.getChat();if(!chat.isGroup||!groupAllowed(chat))return;
    const body=String(msg.body||'').trim();if(!body&&!msg.hasMedia)return;
    const groupId=String(chat.id?._serialized||'');const sender=String(msg.author||msg.from||'');const key=groupId+'|'+sender;
    const messageId=msg.id?._serialized||`${groupId}-${sender}-${msg.timestamp||Date.now()}`;
    let senderName=null,senderPhone=null;try{const c=await msg.getContact();senderName=c?.pushname||c?.name||null;senderPhone=c?.number||null}catch{}
    // Register the message synchronously (before any download) so the post cannot be flushed without it.
    let x=pending.get(key);
    if(!x){x={ids:[],logs:[],groupName:chat.name,groupId,sender,senderPhone,senderName,texts:[],media:[],receivedAt:new Date().toISOString(),timer:null,inflight:0};pending.set(key,x)}
    clearTimeout(x.timer);
    x.ids.push(messageId);if(body)x.texts.push(body);
    const photos=[];
    if(msg.hasMedia){
      x.inflight++;
      try{const m=await msg.downloadMedia();if(m?.data&&/^image\//i.test(m.mimetype||'')){const p={data:m.data,mimeType:m.mimetype||'image/jpeg',filename:m.filename||null};photos.push(p);x.media.push(p)}}
      catch(e){warn('Photo download failed:',e.message)}
      finally{x.inflight--}
    }
    // Every message is logged on its own (questions and chat too); listing detection happens on the website.
    x.logs.push(logMessage({messageId,groupName:chat.name,groupId,sender,senderPhone,senderName,fromMe:!!msg.fromMe,type:msg.type||'chat',text:body,timestamp:msg.timestamp||null,receivedAt:new Date().toISOString(),media:photos}));
    log(`Group message: ${chat.name} · ${senderName||sender} · ${body?body.slice(0,60).replace(/\s+/g,' '):''}${photos.length?` [${photos.length} photo]`:''}`);
    clearTimeout(x.timer);x.timer=setTimeout(()=>flush(key,x),POST_WINDOW_MS);
  }catch(e){fail('Group message error:',e?.message||e)}
});

log(`Starting Sky Cars Group Reader v${VERSION}; website: ${base}; bridge id: ${bridgeId}`);
// Heartbeat every minute from start-up, so Admin can see "starting" / "qr_required" / "disconnected", not just "online".
heartbeat('starting');
setInterval(()=>heartbeat(),60000);
setInterval(refreshConfig,60000);
client.initialize().catch(e=>{fail('Could not start WhatsApp (browser):',e?.message||e);setTimeout(()=>process.exit(1),30000)});
