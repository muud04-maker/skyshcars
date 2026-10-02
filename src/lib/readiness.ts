import axios from 'axios';
import {db, ping, rows, one} from './db';
import {whatsappConfigSummary} from './meta';
import {ensureGroupReaderSchema} from './group-reader';
import {ensureAutomationSchema} from './automation';

const GRAPH_VERSION=process.env.META_GRAPH_VERSION||process.env.WHATSAPP_GRAPH_VERSION||'v26.0';
const GRAPH=`https://graph.facebook.com/${GRAPH_VERSION}`;

export async function checkFacebookPage(){
  const pageId=String(process.env.META_PAGE_ID||'').trim();
  const token=String(process.env.META_PAGE_ACCESS_TOKEN||'').trim();
  if(!pageId||!token)return {configured:false,connected:false,error:'META_PAGE_ID or META_PAGE_ACCESS_TOKEN missing'};
  try{
    const r=await axios.get(`${GRAPH}/${encodeURIComponent(pageId)}`,{params:{fields:'id,name,category,link',access_token:token},timeout:15000});
    const d=r.data||{};
    return {configured:true,connected:String(d.id)===pageId,id:d.id||pageId,name:d.name||'',category:d.category||'',link:d.link||''};
  }catch(e:any){
    const data=e?.response?.data;
    return {configured:true,connected:false,error:data?.error?.message||e?.message||String(e),code:data?.error?.code||null};
  }
}

export async function launchReadiness(){
  let database:any={ok:true};
  try{await ping()}catch(e:any){database={ok:false,error:e?.message||String(e)}}
  const wa=whatsappConfigSummary();
  const facebook=await checkFacebookPage();
  let inventory:any={cars:0,motorcycles:0,realPhotoVehicles:0,pendingImports:0};
  let group:any={configured:false,online:false,lastHeartbeat:null,authorizedGroups:0};
  let automation:any={campaigns:0,approvedDue:0};
  if(database.ok){
    try{await ensureGroupReaderSchema();await ensureAutomationSchema();
      const [cars,motos,photos,imports,groups,bridge,campaigns,due]=await Promise.all([
        rows<any>("SELECT COUNT(*) n FROM vehicles WHERE status='available' AND category='car'"),
        rows<any>("SELECT COUNT(*) n FROM vehicles WHERE status='available' AND category='motorcycle' AND TRIM(COALESCE(brand,''))<>'' AND TRIM(COALESCE(model,''))<>''"),
        rows<any>(`SELECT COUNT(DISTINCT v.id) n FROM vehicles v JOIN vehicle_media m ON m.vehicle_id=v.id WHERE v.status='available' AND m.media_type='image' AND m.review_status='approved' AND m.url NOT LIKE '/demo/vehicles/%' AND m.url NOT LIKE '%vehicle-placeholder%' AND m.url NOT LIKE '/api/vehicle-art/%' AND COALESCE(m.caption,'') NOT LIKE 'MODEL PHOTO%' AND COALESCE(m.caption,'') NOT LIKE '%Reference image%' AND COALESCE(m.caption,'') NOT LIKE '%Representative%'`),
        rows<any>("SELECT COUNT(*) n FROM inventory_import_items WHERE review_status='pending'"),
        rows<any>("SELECT COUNT(*) n FROM whatsapp_group_sources WHERE enabled=1"),
        rows<any>("SELECT *,TIMESTAMPDIFF(SECOND,last_heartbeat_at,NOW()) age_seconds FROM whatsapp_group_bridge_status ORDER BY last_heartbeat_at DESC LIMIT 1"),
        rows<any>("SELECT COUNT(*) n FROM automation_campaigns WHERE status IN ('draft','approved','sending')"),
        rows<any>("SELECT COUNT(*) n FROM automation_campaigns WHERE status='approved' AND scheduled_at IS NOT NULL AND scheduled_at<=NOW()")
      ]);
      inventory={cars:Number(cars[0]?.n||0),motorcycles:Number(motos[0]?.n||0),realPhotoVehicles:Number(photos[0]?.n||0),pendingImports:Number(imports[0]?.n||0)};
      const b=bridge[0];group={configured:Number(groups[0]?.n||0)>0,online:!!b&&Number(b.age_seconds||999999)<150,lastHeartbeat:b?.last_heartbeat_at||null,ageSeconds:b?Number(b.age_seconds):null,status:b?.status||'offline',authorizedGroups:Number(groups[0]?.n||0)};
      automation={campaigns:Number(campaigns[0]?.n||0),approvedDue:Number(due[0]?.n||0)};
    }catch(e:any){inventory.error=e?.message||String(e)}
  }
  let lab:any={fallback:'/lab',subdomain:'https://lab.skyshcars.com',reachable:false,error:''};
  try{const ctl=new AbortController();const t=setTimeout(()=>ctl.abort(),6000);const r=await fetch('https://lab.skyshcars.com',{method:'HEAD',redirect:'manual',signal:ctl.signal,cache:'no-store'});clearTimeout(t);lab.reachable=r.status>0;lab.status=r.status}catch(e:any){lab.error=e?.name==='AbortError'?'timeout':(e?.message||String(e))}
  return {
    database,
    website:{ok:true,url:process.env.NEXT_PUBLIC_SITE_URL||'https://skyshcars.com'},
    facebook,
    whatsapp:{configured:!!wa.configured,details:wa},
    ai:{configured:!!process.env.DEEPSEEK_API_KEY,model:process.env.DEEPSEEK_MODEL||'deepseek-chat'},
    group,
    inventory,
    automation,
    lab,
    auth:{google:!!(process.env.AUTH_GOOGLE_ID&&process.env.AUTH_GOOGLE_SECRET),facebook:!!(process.env.AUTH_FACEBOOK_ID&&process.env.AUTH_FACEBOOK_SECRET),github:!!(process.env.AUTH_GITHUB_ID&&process.env.AUTH_GITHUB_SECRET)}
  };
}
