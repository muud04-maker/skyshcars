import axios from 'axios';
import {ping, rows, one, dbConfigured} from './db';
import {checkWhatsAppNumber, whatsappConfigSummary, whatsappConfigured} from './meta';
import {bridgeHealth, ensureGroupReaderSchema} from './group-reader';
import {ensureAutomationSchema} from './automation';
import {facebookStatus} from './facebook';
import {googleCredentials} from './auth-providers';
import {exactPhotoSql, sellableVehicleSql} from './exact-photos';
import {catalogCounts} from './ai-catalog';
import {welcomesSentToday} from './welcome';
import {referralStats} from './referrals';

/*
  Sell Now readiness — the ONLY place that names missing settings ("needs setup: VARIABLE_NAME").
  Every check is a real check where possible (database ping, Graph API reads, DeepSeek key check,
  heartbeat age, actual inventory counts). Nothing here sends a message or posts.
*/
export type CheckStatus='ok'|'warn'|'fail'|'info';
export type Check={id:string;area:string;label:string;status:CheckStatus;detail:string;link?:string;needs?:string[]};

// Kept for existing imports.
export async function checkFacebookPage(){return facebookStatus()}

const has=(k:string)=>!!String(process.env[k]||'').trim();
/** Names (from the given list) that are not set. Alternatives are written 'A|B' (either one is enough). */
function missing(...names:string[]){return names.filter(n=>!n.split('|').some(has)).map(n=>n.split('|')[0])}
const needsText=(m:string[])=>`needs setup: ${m.join(', ')}`;

export async function checkDeepSeek():Promise<{ok:boolean;detail:string}>{
  const key=String(process.env.DEEPSEEK_API_KEY||'').trim();
  if(!key)return {ok:false,detail:`${needsText(['DEEPSEEK_API_KEY'])} — until then WhatsApp replies use the simple built-in text.`};
  try{const r=await axios.get('https://api.deepseek.com/models',{headers:{Authorization:`Bearer ${key}`},timeout:10000});const ids=(r.data?.data||[]).map((m:any)=>m.id);const model=process.env.DEEPSEEK_MODEL||'deepseek-chat';return {ok:true,detail:`Key accepted. Model: ${model}${ids.length&&!ids.includes(model)?' (not in the account model list — check DEEPSEEK_MODEL)':''}`}}
  catch(e:any){const s=e?.response?.status;return {ok:false,detail:s===401?'DeepSeek rejected DEEPSEEK_API_KEY.':`DeepSeek check failed: ${s||e?.message||e}`}}
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

  const [dbRes,fb,waLive,ai,labRes]=await Promise.all([
    dbConfigured()?ping().then(()=>({ok:true,error:''})).catch((e:any)=>({ok:false,error:e?.code||e?.message||String(e)})):Promise.resolve({ok:false,error:'not set up'}),
    facebookStatus(),
    whatsappConfigured()?checkWhatsAppNumber():Promise.resolve({ok:false,error:''} as any),
    checkDeepSeek(),
    lab(),
  ]);
  const wa=whatsappConfigSummary();

  // Website & customer accounts
  const dbMissing=missing('DB_HOST','DB_NAME','DB_USER','DB_PASSWORD');
  add({id:'database',area:'Website',label:'Database connection',status:dbRes.ok?'ok':'fail',needs:dbMissing,detail:dbRes.ok?'Connected (live ping).':dbMissing.length?`${needsText(dbMissing)} — inventory falls back to the built-in list; accounts, quotes and WhatsApp AI are off.`:`Set up but not reachable: ${dbRes.error}`});
  const authMissing=missing('AUTH_SECRET');
  add({id:'accounts',area:'Website',label:'Customer accounts (email + password)',status:!authMissing.length&&!dbMissing.length?'ok':'warn',needs:[...authMissing,...dbMissing],detail:!authMissing.length&&!dbMissing.length?'On — customers can sign up and log in.':`Off (login and signup show a neutral notice). ${needsText([...authMissing,...(dbMissing.length?['database']:[])])}`});
  if(!has('AUTH_URL'))add({id:'auth_url',area:'Website',label:'Login callback address',status:'info',needs:['AUTH_URL'],detail:`${needsText(['AUTH_URL'])} (recommended: https://skyshcars.com) so Google returns to the right address.`});
  const gMissing=googleCredentials()?[]:['GOOGLE_CLIENT_ID','GOOGLE_CLIENT_SECRET'];
  add({id:'google',area:'Website',label:'Google sign-in',status:gMissing.length?'info':'ok',needs:gMissing,detail:gMissing.length?`Button hidden. Optional — ${needsText(gMissing)}`:'Configured — button shown on login and signup.'});

  // WhatsApp AI
  const waMissing=missing('WHATSAPP_ACCESS_TOKEN|WHATSAPP_TOKEN','WHATSAPP_PHONE_NUMBER_ID|PHONE_NUMBER_ID');
  add({id:'wa_api',area:'WhatsApp AI',label:'WhatsApp Cloud API number',status:waMissing.length?'fail':waLive.ok?'ok':'fail',needs:waMissing,detail:waMissing.length?`${needsText(waMissing)} — messages are stored but no replies are sent.`:waLive.ok?`${waLive.name||'Number'} ${waLive.number||''}${waLive.quality?` · quality ${waLive.quality}`:''} (live check)`:String(waLive.error||'Not reachable'),link:'/admin/whatsapp-health'});
  const verifyMissing=missing('WHATSAPP_VERIFY_TOKEN|VERIFY_TOKEN');
  if(verifyMissing.length)add({id:'wa_verify',area:'WhatsApp AI',label:'Webhook verification token',status:'warn',needs:verifyMissing,detail:`${needsText(verifyMissing)} — required once when connecting the webhook in Meta.`});
  let mismatches=0;
  if(dbRes.ok&&wa.signatureMode==='monitor'){try{const r:any=await one("SELECT COUNT(*) n FROM ai_agent_events WHERE event_type='signature_mismatch' AND created_at>=NOW()-INTERVAL 7 DAY");mismatches=Number(r?.n||0)}catch{}}
  add({id:'wa_signature',area:'WhatsApp AI',label:'Webhook signature check',status:wa.signatureMode==='secure'?'ok':wa.signatureMode==='monitor'?(mismatches?'warn':'ok'):'warn',needs:wa.signatureMode==='compatibility'?['WHATSAPP_APP_SECRET']:[],
    detail:wa.signatureMode==='secure'?'Enforced — unsigned requests are rejected.':wa.signatureMode==='monitor'?`Checked, not enforced. ${mismatches} mismatch(es) in 7 days.${mismatches?' Check WHATSAPP_APP_SECRET before enforcing.':' Safe to set REQUIRE_WHATSAPP_SIGNATURE=true.'}`:`Not checked (messages still accepted). ${needsText(['WHATSAPP_APP_SECRET'])}`});
  add({id:'ai',area:'WhatsApp AI',label:'AI sales model (DeepSeek)',status:ai.ok?'ok':has('DEEPSEEK_API_KEY')?'fail':'warn',needs:has('DEEPSEEK_API_KEY')?[]:['DEEPSEEK_API_KEY'],detail:ai.detail});
  const mediaMissing=missing('MEDIA_AI_API_KEY|OPENAI_API_KEY');
  add({id:'media_ai',area:'WhatsApp AI',label:'Voice notes & photo understanding',status:mediaMissing.length?'info':'ok',needs:mediaMissing,detail:mediaMissing.length?`Optional — voice notes and customer photos go to a human. ${needsText(mediaMissing)}`:'Configured.'});

  // Facebook
  const fbMissing=missing('META_PAGE_ID','META_PAGE_ACCESS_TOKEN|META_USER_ACCESS_TOKEN');
  const fbWarn=fb.connected&&(fb.missingScopes?.length||(fb.daysLeft!=null&&fb.daysLeft<14));
  add({id:'fb_page',area:'Facebook',label:'Facebook Page connection',status:fbMissing.length?'warn':fb.connected?(fbWarn?'warn':'ok'):'fail',needs:fbMissing,link:'/admin/social',
    detail:fbMissing.length?`Posting is off. ${needsText(fbMissing)}`:fb.connected?`${fb.name} · ${fb.neverExpires?'token never expires':fb.daysLeft!=null?`token expires in ${fb.daysLeft} days`:'token expiry unknown'}${fb.missingScopes?.length?` · token missing ${fb.missingScopes.join(', ')}`:''}`:(fb.error||'Not connected')});
  if(!fbMissing.length&&!fb.debugAvailable)add({id:'fb_debug',area:'Facebook',label:'Token expiry & permission check',status:'info',needs:missing('META_APP_ID','META_APP_SECRET'),detail:`Optional — ${needsText(missing('META_APP_ID','META_APP_SECRET'))}`});
  if(!has('META_VERIFY_TOKEN'))add({id:'fb_messenger',area:'Facebook',label:'Messenger replies',status:'info',needs:['META_VERIFY_TOKEN'],detail:`Optional — ${needsText(['META_VERIFY_TOKEN'])} to connect the Messenger webhook.`});
  if(!has('AUTOMATION_CRON_SECRET'))add({id:'cron',area:'Facebook',label:'Scheduled campaigns',status:'info',needs:['AUTOMATION_CRON_SECRET'],detail:`Optional — scheduled campaigns only run when sent manually. ${needsText(['AUTOMATION_CRON_SECRET'])}`});

  let inventory:any={cars:0,motorcycles:0,realPhotoVehicles:0,pendingImports:0};
  let group:any={configured:false,online:false,lastHeartbeat:null,authorizedGroups:0};
  let automation:any={campaigns:0,approvedDue:0};
  const bridgeMissing=missing('WHATSAPP_SERVICE_SECRET');
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
      add({id:'group_reader',area:'Group Reader',label:'Group Reader bridge (PC)',status:bridgeMissing.length?'warn':!group.configured?'warn':h.online?'ok':'fail',needs:bridgeMissing,link:'/admin/group-reader',
        detail:bridgeMissing.length?`Off. ${needsText(bridgeMissing)} (same value on the website and in the bridge PC's .env)`:!group.configured?'No supplier group authorized yet.':h.online?`Online · last heartbeat ${ago(h.minutes!=null?h.minutes*60:null)} · ${group.authorizedGroups} group(s)`:h.state==='never'?'The bridge PC has never connected.':`Offline (${h.state}) · last heartbeat ${h.minutes} min ago`});
      add({id:'pending_imports',area:'Group Reader',label:'Supplier posts waiting for review',status:inventory.pendingImports?'info':'ok',detail:`${inventory.pendingImports} pending`,link:'/admin/imports'});
      const total=inventory.cars+inventory.motorcycles;
      add({id:'inventory',area:'Inventory',label:'Sellable inventory',status:total?'ok':'fail',detail:`${inventory.cars} cars and ${inventory.motorcycles} motorcycles Available (demo listings excluded).`,link:'/admin/vehicles'});
      add({id:'photos',area:'Inventory',label:'Vehicles with exact photos',status:inventory.realPhotoVehicles?'ok':'warn',detail:`${inventory.realPhotoVehicles} of ${total} available vehicles have an exact photo. Only these can be auto-posted to Facebook or sent as WhatsApp photos.`});
      add({id:'fb_last',area:'Facebook',label:'Last Facebook post attempt',status:!lastFb?'info':lastFb.status==='sent'?'ok':lastFb.status==='failed'?'fail':'info',detail:!lastFb?'No posts yet. Post one real vehicle from Social Auto-Post to test.':`${lastFb.status} ${ago(Number(lastFb.age))}${lastFb.status!=='sent'?` — ${String(lastFb.details||'').slice(0,160)}`:''}`,link:'/admin/social'});
      add({id:'campaigns',area:'Facebook',label:'Campaigns waiting',status:automation.approvedDue?'warn':'info',detail:`${automation.campaigns} draft/approved campaign(s)${automation.approvedDue?`, ${automation.approvedDue} overdue`:''}`,link:'/admin/campaigns'});
      // Part 9: real AI, welcome, referral, waiting-chat and business metrics (never green just because an env var exists).
      const [cat,welcomeToday,refs]=await Promise.all([
        catalogCounts().catch(()=>({mode:'selected',aiCount:0,availableCount:0})),
        welcomesSentToday().catch(()=>null),
        referralStats(7).catch(()=>({total:0,matched:0,rate:null as number|null})),
      ]);
      add({id:'ai_catalog',area:'WhatsApp AI',label:'AI Catalog',status:cat.aiCount?'ok':'warn',link:'/admin/ai-catalog',detail:`AI sells ${cat.aiCount} of ${cat.availableCount} Available vehicles (mode: ${cat.mode}).${cat.aiCount?'':' Turn cars on in the AI Catalog.'}`});
      add({id:'welcome_today',area:'WhatsApp AI',label:'Welcome messages sent today',status:'info',detail:welcomeToday==null?'Unknown (welcome log not reachable).':`${welcomeToday} first-contact welcome(s) sent today.`});
      add({id:'referral_rate',area:'Facebook',label:'Ad/post referral match rate (7 days)',status:refs.total?(refs.matched?'ok':'warn'):'info',detail:refs.total?`${refs.matched} of ${refs.total} referrals matched to a vehicle (${refs.rate}%).`:'No Facebook ad/post referrals in the last 7 days.'});
      const echo=await one<any>("SELECT TIMESTAMPDIFF(SECOND,MAX(created_at),NOW()) age FROM ai_agent_events WHERE event_type='staff_echo' AND status='ok'").catch(()=>null);
      add({id:'staff_echo',area:'WhatsApp AI',label:'Last staff message from the phone',status:echo?.age==null?'info':'ok',detail:echo?.age==null?'None recorded yet. Meta must deliver message_echoes for this to work.':`${ago(Number(echo.age))}.`});
      const waiting=await one<any>(`SELECT COUNT(*) n FROM conversations c
        WHERE (SELECT COALESCE(MAX(m1.id),0) FROM messages m1 WHERE m1.conversation_id=c.id AND m1.sender='customer' AND m1.direction='inbound')
            > (SELECT COALESCE(MAX(m2.id),0) FROM messages m2 WHERE m2.conversation_id=c.id AND m2.sender IN ('ai','human') AND m2.direction='outbound')
          AND (SELECT MAX(m3.created_at) FROM messages m3 WHERE m3.conversation_id=c.id AND m3.sender='customer' AND m3.direction='inbound') <= (NOW() - INTERVAL 10 MINUTE)`).catch(()=>null);
      add({id:'waiting10',area:'WhatsApp AI',label:'Chats waiting more than 10 minutes',status:Number(waiting?.n||0)?'warn':'ok',link:'/admin/whatsapp',detail:`${Number(waiting?.n||0)} conversation(s) have an unanswered customer message older than 10 minutes.`});
      const aiErr=await one<any>("SELECT details,TIMESTAMPDIFF(SECOND,created_at,NOW()) age FROM ai_agent_events WHERE event_type='reply' AND status='failed' ORDER BY id DESC LIMIT 1").catch(()=>null);
      add({id:'ai_last_error',area:'WhatsApp AI',label:'Last AI reply error',status:aiErr?'fail':'ok',link:'/admin/agent-health',detail:aiErr?`${ago(Number(aiErr.age))}: ${String(aiErr.details||'').slice(0,160)}`:'No AI reply failures recorded.'});
      const biz=await one<any>(`SELECT (SELECT COUNT(*) FROM quote_requests WHERE status IN ('new','reviewing')) quotes,
        (SELECT COUNT(*) FROM shipments WHERE current_status<>'completed') shipments,
        (SELECT COUNT(*) FROM leads WHERE status IN ('new','contacted','qualified')) leads`).catch(()=>null);
      add({id:'business',area:'Business',label:'Open quotes, shipments and leads',status:'info',link:'/admin/quotes',detail:`${Number(biz?.quotes||0)} open quote(s), ${Number(biz?.shipments||0)} active shipment(s), ${Number(biz?.leads||0)} unresolved lead(s).`});
    }catch(e:any){add({id:'db_checks',area:'Website',label:'Database checks',status:'fail',detail:e?.message||String(e)})}
  }else{
    add({id:'group_reader',area:'Group Reader',label:'Group Reader bridge (PC)',status:'warn',needs:[...bridgeMissing,...dbMissing],detail:`Off until the database is connected.${bridgeMissing.length?` ${needsText(bridgeMissing)}`:''}`});
  }
  add({id:'lab',area:'Website',label:'Private Lab subdomain',status:labRes.reachable?'ok':'info',detail:labRes.reachable?`Reachable (HTTP ${labRes.status})`:`Not routed (${labRes.error||labRes.status}) — /lab fallback still works.`});

  const summary={ok:checks.filter(c=>c.status==='ok').length,warn:checks.filter(c=>c.status==='warn').length,fail:checks.filter(c=>c.status==='fail').length};
  const needsSetup=Array.from(new Set(checks.flatMap(c=>c.needs||[]))).filter(x=>x!=='database');
  return {
    checkedAt:new Date().toISOString(),summary,needsSetup,checks,
    // Legacy fields kept for compatibility.
    database:{ok:dbRes.ok},website:{ok:true,url:process.env.NEXT_PUBLIC_SITE_URL||'https://skyshcars.com'},facebook:fb,
    whatsapp:{configured:!!wa.configured,live:!!waLive.ok},ai:{configured:has('DEEPSEEK_API_KEY'),ok:ai.ok},group,inventory,automation,lab:labRes,
    auth:{google:!!googleCredentials(),facebook:!!(process.env.AUTH_FACEBOOK_ID&&process.env.AUTH_FACEBOOK_SECRET),github:!!(process.env.AUTH_GITHUB_ID&&process.env.AUTH_GITHUB_SECRET)}
  };
}
