require('dotenv').config();
const qrcode=require('qrcode-terminal');
const {Client,LocalAuth}=require('whatsapp-web.js');
const base=(process.env.SKY_CARS_URL||'https://skyshcars.com').replace(/\/$/,'');
const secret=process.env.WHATSAPP_SERVICE_SECRET||'';
const target=(process.env.TARGET_GROUP_NAME||'').trim().toLowerCase();
if(!secret){console.error('WHATSAPP_SERVICE_SECRET is missing in tools/whatsapp-group-bridge/.env');process.exit(1)}
const client=new Client({authStrategy:new LocalAuth({clientId:'sky-cars-group-reader'}),puppeteer:{headless:true,args:['--no-sandbox','--disable-setuid-sandbox']}});
client.on('qr',qr=>{console.log('Scan this QR with the Sky Cars WhatsApp account:');qrcode.generate(qr,{small:true})});
client.on('ready',async()=>{console.log('Sky Cars group bridge READY.');const chats=await client.getChats();const groups=chats.filter(c=>c.isGroup);console.log('Visible groups:');groups.forEach(g=>console.log(' - '+g.name));if(target)console.log('Watching: '+process.env.TARGET_GROUP_NAME)});
client.on('auth_failure',m=>console.error('WhatsApp authentication failed:',m));
client.on('disconnected',r=>console.error('WhatsApp disconnected:',r));
client.on('message_create',async msg=>{
 try{
  const chat=await msg.getChat();
  if(!chat.isGroup) return;
  if(target && String(chat.name||'').trim().toLowerCase()!==target) return;
  // Ignore your own plain discussion messages unless they contain a listing-like body or media.
  const body=String(msg.body||'').trim();
  if(!body && !msg.hasMedia) return;
  const media=[];
  if(msg.hasMedia){
    try{const m=await msg.downloadMedia();if(m?.data)media.push({data:m.data,mimeType:m.mimetype||'image/jpeg',filename:m.filename||null});}catch(e){console.error('Media download failed',e.message)}
  }
  // WhatsApp albums often arrive as separate messages. The website deduplicates by message id and keeps each draft separate.
  const payload={messageId:msg.id?._serialized||String(Date.now()),groupName:chat.name,sender:msg.author||msg.from,text:body,receivedAt:new Date(Number(msg.timestamp||0)*1000).toISOString(),media};
  const r=await fetch(base+'/api/bridge/whatsapp-group',{method:'POST',headers:{'Content-Type':'application/json','x-sky-secret':secret},body:JSON.stringify(payload)});
  const out=await r.text();
  if(!r.ok)console.error('Bridge upload failed',r.status,out);else console.log('Sent group item:',payload.messageId,out);
 }catch(e){console.error('GROUP_MESSAGE_ERROR',e)}
});
client.initialize();
