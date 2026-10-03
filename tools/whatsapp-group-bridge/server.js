require('dotenv').config();
const qrcode=require('qrcode-terminal');
const {Client,LocalAuth}=require('whatsapp-web.js');
const base=(process.env.SKY_CARS_URL||'https://skyshcars.com').replace(/\/$/,'');
const secret=process.env.WHATSAPP_SERVICE_SECRET||'';
const bridgeId=process.env.BRIDGE_ID||'primary';
const VERSION='32';
// Messages from the same supplier in the same group within this quiet window form ONE post (photos + caption).
// The website also merges a caption/photos sent up to 3 minutes apart into the same pending vehicle.
const POST_WINDOW_MS=Number(process.env.POST_WINDOW_MS||20000);
if(!secret){console.error('WHATSAPP_SERVICE_SECRET is missing');process.exit(1)}
let allowed=[];let account='';let visible=0;let state='starting';let lastError='';let sentPosts=0;
const pending=new Map();

async function api(path,opts={}){return fetch(base+path,{...opts,headers:{'x-sky-secret':secret,'Content-Type':'application/json',...(opts.headers||{})}})}
async function refreshConfig(){try{const r=await api('/api/bridge/whatsapp-group/config');if(!r.ok)throw new Error(await r.text());const j=await r.json();allowed=(j.groups||[]).map(g=>({name:String(g.group_name||'').trim().toLowerCase(),id:String(g.group_external_id||'')}));console.log('Authorized groups:',allowed.map(x=>x.name).join(', ')||'(none)')}catch(e){lastError='config: '+e.message;console.error('Config refresh failed:',e.message)}}
function groupAllowed(chat){const name=String(chat.name||'').trim().toLowerCase();const id=String(chat.id?._serialized||'');return allowed.some(x=>x.name===name||(x.id&&x.id===id))}
async function heartbeat(status=state){state=status;try{await api('/api/bridge/whatsapp-group/heartbeat',{method:'POST',body:JSON.stringify({bridgeId,status,whatsappAccount:account,visibleGroups:visible,version:VERSION,details:{authorized:allowed.length,pendingPosts:pending.size,sentPosts,lastError:lastError||null}})})}catch(e){console.error('Heartbeat failed:',e.message)}}

async function upload(payload,attempt=1){
  try{
    const r=await api('/api/bridge/whatsapp-group',{method:'POST',body:JSON.stringify(payload)});const out=await r.text();
    if(r.ok){sentPosts++;console.log('Inventory draft sent:',payload.groupName,payload.messageIds.length,'message(s),',payload.media.length,'photo(s)');return}
    // 4xx (unauthorized group, disabled reader) will not succeed on retry.
    if(r.status>=400&&r.status<500){lastError=`upload ${r.status}`;console.error('Bridge upload rejected',r.status,out);return}
    throw new Error(`HTTP ${r.status} ${out.slice(0,200)}`);
  }catch(e){
    lastError='upload: '+e.message;
    if(attempt>=4){console.error('Upload failed permanently:',e.message);return}
    const wait=attempt*30000;console.error(`Upload failed (attempt ${attempt}), retrying in ${wait/1000}s:`,e.message);
    setTimeout(()=>upload(payload,attempt+1),wait); // the website ignores duplicates, so retries are safe
  }
}

function flush(key,x){
  if(pending.get(key)!==x)return;
  if(x.inflight>0){x.timer=setTimeout(()=>flush(key,x),2000);return} // a photo is still downloading
  pending.delete(key);
  const payload={messageId:[...x.ids].sort().join('+'),messageIds:x.ids,groupName:x.groupName,groupId:x.groupId,sender:x.sender,text:x.texts.filter(Boolean).join('\n'),receivedAt:x.receivedAt,media:x.media};
  upload(payload);
}

const client=new Client({authStrategy:new LocalAuth({clientId:'sky-cars-group-reader-v27'}),puppeteer:{headless:true,args:['--no-sandbox','--disable-setuid-sandbox']}});
client.on('qr',qr=>{console.log('Scan this QR with the Sky Cars WhatsApp account:');qrcode.generate(qr,{small:true});heartbeat('qr_required')});
client.on('ready',async()=>{console.log(`Sky Cars V${VERSION} group bridge READY`);const info=client.info||{};account=String(info.wid?._serialized||'');try{const chats=await client.getChats();visible=chats.filter(c=>c.isGroup).length}catch{}await refreshConfig();lastError='';await heartbeat('online')});
client.on('auth_failure',m=>{console.error('WhatsApp authentication failed:',m);lastError='auth_failure';heartbeat('auth_failed')});
client.on('disconnected',r=>{console.error('WhatsApp disconnected:',r);lastError='disconnected: '+r;heartbeat('disconnected');setTimeout(()=>{console.log('Reconnecting…');client.initialize().catch(e=>console.error('Reconnect failed',e.message))},30000)});
client.on('message_create',async msg=>{
  try{
    const chat=await msg.getChat();if(!chat.isGroup||!groupAllowed(chat))return;
    const body=String(msg.body||'').trim();if(!body&&!msg.hasMedia)return;
    const groupId=String(chat.id?._serialized||'');const sender=String(msg.author||msg.from||'');const key=groupId+'|'+sender;
    // Register the message synchronously (before any download) so the post cannot be flushed without it.
    let x=pending.get(key);
    if(!x){x={ids:[],groupName:chat.name,groupId,sender,texts:[],media:[],receivedAt:new Date().toISOString(),timer:null,inflight:0};pending.set(key,x)}
    clearTimeout(x.timer);
    x.ids.push(msg.id?._serialized||String(Date.now()));if(body)x.texts.push(body);
    if(msg.hasMedia){
      x.inflight++;
      try{const m=await msg.downloadMedia();if(m?.data&&/^image\//i.test(m.mimetype||''))x.media.push({data:m.data,mimeType:m.mimetype||'image/jpeg',filename:m.filename||null})}
      catch(e){console.error('Media download failed',e.message)}
      finally{x.inflight--}
    }
    clearTimeout(x.timer);x.timer=setTimeout(()=>flush(key,x),POST_WINDOW_MS);
  }catch(e){console.error('GROUP_MESSAGE_ERROR',e)}
});

// Heartbeat every minute from start-up, so Admin can see "starting" / "qr_required" / "disconnected", not just "online".
heartbeat('starting');
setInterval(()=>heartbeat(),60000);
setInterval(refreshConfig,60000);
client.initialize();
