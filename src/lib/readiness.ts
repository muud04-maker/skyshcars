import axios from 'axios';
import {ping, rows, one, dbConfigured} from './db';
import {checkWhatsAppNumber, whatsappConfigSummary} from './meta';
import {bridgeHealth, ensureGroupReaderSchema} from './group-reader';
import {ensureAutomationSchema} from './automation';
import {facebookStatus} from './facebook';
import {googleCredentials} from './auth-providers';
import {exactPhotoSql, sellableVehicleSql} from './exact-photos';

/*
  Sell Now readiness. Every check is a REAL check where one is possible (database ping, Graph API reads,
  DeepSeek key check, heartbeat age, actual inventory counts). Nothing here sends a message or posts.
*/
export type CheckStatus='ok'|'warn'|'fail'|'info';
export type Check={id:string;area:string;label:string;status:CheckStatus;detail:string;link?:string};

// Kept for existing imports.
export async function checkFacebookPage(){return facebookStatus()}

async function checkDeepSeek():Promise<{ok:boolean;detail:string}>{
  const key=String(process.env.DEEPSEEK_API_KEY||'').trim();
  if(!key)return {ok:false,detail:'Not configured — WhatsApp replies use the simple built-in fallback text.'};
  try{const r=await axios.get('https://api.deepseek.com/models',{headers:{Authorization:`Bearer ${key}`},timeout:10000});const ids=(r.data?.data||[]).map((m:any)=>m.id);return {ok:true,detail:`Key accepted. Model: ${process.env.DEEPSEEK_MODEL||'deepseek-chat'}${ids.length&&!ids.includes(process.env.DEEPSEEK_MODEL||'deepseek-chat')?' (not in the account model list!)':''}`}}
  catch(e:any){const s=e?.response?.status;return {ok:false,detail:s===401?'DeepSeek rejected the API key.':`DeepSeek check failed: ${s||e?.message||e}`}}
}

async function lab(){
  try{const ctl=new AbortController();const t=setTimeout(()=>ctl.abort(),6000);const r=await fetch('https://lab.skyshcars.com',{method:'HEAD',redirect:'manual',signal:ctl.signal,cache:'no-store'});clearTimeout(t);return {reachable:r.status>0,status:r.status,error:''}}
  catch(e:any){return {reachable:false,status:0,error:e?.name==='AbortError'?'timeout':(e?.message||String(e))}}
}

const n=(r:any[])=>Number(r?.[0]?.n||0);
const ago=(sec:number|null)=>sec==null?'never':sec<120?`${sec}s ago`:sec<7200?`${Math.round(sec/60)} min ago`:sec<172800?`${Math.round(sec/3600)} h ago`:`${Math.round(sec/86400)} days ago`;

export async function launchReadiness(){
  const checks:Check[]=[];
  const add=(c:Check)=>checks.push(c);

  // Run the slow external checks in parallel.
  const [dbRes,fb,waLive,ai,labRes]=await Promise.all([
    dbConfigured()?ping().then(()=>({ok:true,error:''})).catch((e:any)=>({ok:false,error:e?.code||e?.message||String(e)})):Promise.resolve({ok:false,error:'Database settings missing'}),
    facebookStatus(),
    checkWhatsAppNumber(),
    checkDeepSeek(),
    lab(),
  ]);
  const wa=whatsappConfigSummary();

  add({id:'database',area:'Website',label:'Database connection',status:dbRes.ok?'ok':'fail',detail:dbRes.ok?'Connected (live ping).':`Not connected: ${dbRes.error}`});
  add({id:'auth_secret',area:'Website',label:'Customer login sessions',status:process.env.AUTH_SECRET?'ok':'fail',detail:process.env.AUTH_SECRET?'Session secret set; email + password login available.':'AUTH_SECRET is missing — customers cannot log in.'});
  add({id:'google',area:'Website',label:'Google sign-in',status:googleCredentials()?'ok':'info',detail:googleCredentials()?'Configured — button shown on login and signup.':'Not configured — Google button is hidden (optional).'});

  add({id:'wa_api',area:'WhatsApp AI',label:'WhatsApp Cloud API number',status:waLive.ok?'ok':'fail',detail:waLive.ok?`${(waLive as any).name||'Number'} ${(waLive as any).number||''}${(waLive as any).quality?` · quality ${(waLive as any).quality}`:''} (live Graph check)`:String((waLive as any).error||'Not reachable'),link:'/admin/whatsapp-health'});
  add({id:'wa_signature',area:'WhatsApp AI',label:'Webhook signature check',status:wa.signatureMode==='secure'?'ok':'warn',detail:wa.signatureMode==='secure'?'App secret set — webhook calls are verified.':'Compatibility mode — add WHATSAPP_APP_SECRET so webhook calls are verified.'});
  add({id:'ai',area:'WhatsApp AI',label:'AI sales model (DeepSeek)',status:ai.ok?'ok':String(process.env.DEEPSEEK_API_KEY||'')?'fail':'warn',detail:ai.detail});
  add({id:'media_ai',area:'WhatsApp AI',label:'Voice notes & photo understanding',status:(process.env.MEDIA_AI_API_KEY||process.env.OPENAI_API_KEY)?'ok':'info',detail:(process.env.MEDIA_AI_API_KEY||process.env.OPENAI_API_KEY)?'Configured.':'Not configured — voice notes and customer photos are handed to a human (optional).'});

  add({id:'fb_page',area:'Facebook',label:'Facebook Page connection',status:fb.connected?(fb.warnings.some(w=>/expires|missing permission/i.test(w))?'warn':'ok'):fb.configured?'fail':'warn',detail:fb.connected?`${fb.name} · ${fb.neverExpires?'token never expires':fb.daysLeft!=null?`token expires in ${fb.daysLeft} days`:'token expiry unknown'}${fb.missingScopes?.length?` · missing ${fb.missingScopes.join(', ')}`:''}`:(fb.error||'Not connected'),link:'/admin/social'});

  let inventory:any={cars:0,motorcycles:0,realPhotoVehicles:0,pendingImports:0};
  let group:any={configured:false,online:false,lastHeartbeat:null,authorizedGroups:0};
  let automation:any={campaigns:0,approvedDue:0};
  if(dbRes.ok){
    try{
      await ensureGroupReaderSchema();await ensureAutomationSchema();
      const S=sellableVehicleSql('v');
      const [cars,motos,photos,imports,groups,bridge,campaigns,due,webhook,lastFb]=await Promise.all([
        rows<any>(`SELECT COUNT(*) n FROM vehicles v WHERE ${S} AND v.category='car'`),
        rows<any>(`SELECT COUNT(*) n FROM vehicles v WHERE ${S} AND v.category='motorcycle' AND TRIM(COALESCE(v.brand,''))<>'' AND TRIM(COALESCE(v.model,''))<>''`),
        rows<any>(`SELECT COUNT(DISTINCT v.id) n FROM vehicles v JOIN vehicle_media m ON m.vehicle_id=v.id WHERE ${S} AND ${exactPhotoSql('m')}`),
        rows<any>("SELECT COUNT(*) n FROM inventory_import_items WHERE review_status='pending'"),
        rows<any>("SELECT COUNT(*) n FROM whatsapp_group_sources WHERE enabled=1"),
        rows<any>("SELECT * FROM whatsapp_group_bridge_status ORDER BY last_heartbeat_at DESC LIMIT 1"),
        rows<any>("SELECT COUNT(*) n FROM automation_campaigns WHERE status IN ('draft','approved','sending')"),
        rows<any>("SELECT COUNT(*) n FROM automation_campaigns WHERE status='approved' AND scheduled_at IS NOT NULL AND scheduled_at<=NOW()"),
        one<any>("SELECT TIMESTAMPDIFF(SECOND,MAX(created_at),NOW()) age FROM ai_agent_events WHERE event_type='webhook_received' AND status='ok'").catch(()=>null),
        one<any>("SELECT status,details,created_at,TIMESTAMPDIFF(SECOND,created_at,NOW()) age FROM social_publish_log WHERE channel='facebook' ORDER BY id DESC LIMIT 1").catch(()=>null),
      ]);
      inventory={cars:n(cars),motorcycles:n(motos),realPhotoVehicles:n(photos),pendingImports:n(imports)};
      const b=bridge[0];const h=bridgeHealth(b);
      group={configured:n(groups)>0,online:h.online,lastHeartbeat:b?.last_heartbeat_at||null,minutes:h.minutes,status:h.state,authorizedGroups:n(groups)};
      automation={campaigns:n(campaigns),approvedDue:n(due)};

      const whAge=webhook?.age==null?null:Number(webhook.age);
      add({id:'wa_webhook',area:'WhatsApp AI',label:'Incoming WhatsApp messages (webhook)',status:whAge==null?'warn':whAge<7*86400?'ok':'warn',detail:whAge==null?'No webhook delivery recorded yet — send a test message to the business number.':`Last webhook delivery ${ago(whAge)}.`});
      add({id:'group_reader',area:'Group Reader',label:'Group Reader bridge (PC)',status:!group.configured?'warn':h.online?'ok':'fail',detail:!group.configured?'No supplier group authorized yet.':h.online?`Online · last heartbeat ${ago(h.minutes!=null?h.minutes*60:null)} · ${group.authorizedGroups} group(s)`:h.state==='never'?'The bridge PC has never connected.':`Offline (${h.state}) · last heartbeat ${h.minutes} min ago`,link:'/admin/group-reader'});
      add({id:'pending_imports',area:'Group Reader',label:'Supplier posts waiting for review',status:inventory.pendingImports?'info':'ok',detail:`${inventory.pendingImports} pending`,link:'/admin/imports'});
      const total=inventory.cars+inventory.motorcycles;
      add({id:'inventory',area:'Inventory',label:'Sellable inventory',status:total?'ok':'fail',detail:`${inventory.cars} cars and ${inventory.motorcycles} motorcycles Available (demo listings excluded).`,link:'/admin/vehicles'});
      add({id:'photos',area:'Inventory',label:'Vehicles with exact photos',status:inventory.realPhotoVehicles?'ok':'warn',detail:`${inventory.realPhotoVehicles} of ${total} available vehicles have an exact photo. Only these can be auto-posted to Facebook or sent as WhatsApp photos.`});
      add({id:'fb_last',area:'Facebook',label:'Last Facebook post attempt',status:!lastFb?'info':lastFb.status==='sent'?'ok':lastFb.status==='failed'?'fail':'info',detail:!lastFb?'No posts yet. Post one real vehicle from Social Auto-Post to test.':`${lastFb.status} ${ago(Number(lastFb.age))}${lastFb.status!=='sent'?` — ${String(lastFb.details||'').slice(0,160)}`:''}`,link:'/admin/social'});
      add({id:'campaigns',area:'Facebook',label:'Campaigns waiting',status:automation.approvedDue?'warn':'info',detail:`${automation.campaigns} draft/approved campaign(s)${automation.approvedDue?`, ${automation.approvedDue} overdue`:''}`,link:'/admin/campaigns'});
    }catch(e:any){add({id:'db_checks',area:'Website',label:'Database checks',status:'fail',detail:e?.message||String(e)})}
  }
  add({id:'lab',area:'Website',label:'Private Lab subdomain',status:labRes.reachable?'ok':'info',detail:labRes.reachable?`Reachable (HTTP ${labRes.status})`:`Not routed (${labRes.error||labRes.status}) — /lab fallback still works.`});

  const summary={ok:checks.filter(c=>c.status==='ok').length,warn:checks.filter(c=>c.status==='warn').length,fail:checks.filter(c=>c.status==='fail').length};
  return {
    checkedAt:new Date().toISOString(),summary,checks,
    // Legacy fields kept for compatibility.
    database:dbRes,website:{ok:true,url:process.env.NEXT_PUBLIC_SITE_URL||'https://skyshcars.com'},facebook:fb,
    whatsapp:{configured:!!wa.configured,live:waLive.ok},ai:{configured:!!process.env.DEEPSEEK_API_KEY,ok:ai.ok},group,inventory,automation,lab:labRes,
    auth:{google:!!googleCredentials(),facebook:!!(process.env.AUTH_FACEBOOK_ID&&process.env.AUTH_FACEBOOK_SECRET),github:!!(process.env.AUTH_GITHUB_ID&&process.env.AUTH_GITHUB_SECRET)}
  };
}
