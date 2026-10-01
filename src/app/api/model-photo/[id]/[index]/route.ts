import {getVehicle} from '../../../../../lib/vehicles';
export const dynamic='force-dynamic';

type Img={url:string;title:string};
function hash(s:string){let h=2166136261;for(const c of s){h^=c.charCodeAt(0);h=Math.imul(h,16777619)}return h>>>0}
async function commons(query:string):Promise<Img[]>{
  const p=new URLSearchParams({action:'query',format:'json',origin:'*',generator:'search',gsrsearch:query,gsrnamespace:'6',gsrlimit:'24',prop:'imageinfo',iiprop:'url',iiurlwidth:'1400'});
  const r=await fetch('https://commons.wikimedia.org/w/api.php?'+p.toString(),{headers:{'user-agent':'SkyCars/2.0 authorized vehicle catalogue'},cache:'force-cache'});
  if(!r.ok)return[];const j:any=await r.json();const pages:any[]=Object.values(j?.query?.pages||{});
  return pages.map((pg:any)=>({url:pg?.imageinfo?.[0]?.thumburl||pg?.imageinfo?.[0]?.url,title:String(pg?.title||'')}))
    .filter(x=>/^https:\/\//i.test(x.url)&&!/(logo|badge|icon|diagram|drawing|interior|engine|wheel|emblem)/i.test(x.title));
}
function fallbackSvg(title:string,seed:string){const h=hash(seed)%360;return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="675"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop stop-color="hsl(${h} 42% 25%)"/><stop offset="1" stop-color="#071b2d"/></linearGradient></defs><rect width="1200" height="675" fill="url(#g)"/><g transform="translate(170 160)"><path d="M80 150h610c40 0 75 30 80 70l5 50H20l8-66c5-31 28-54 62-54z" fill="#f4f7fb"/><path d="M200 150l85-105h245l130 105" fill="none" stroke="#f4f7fb" stroke-width="35" stroke-linejoin="round"/><circle cx="180" cy="275" r="68" fill="#0b2940" stroke="#fff" stroke-width="18"/><circle cx="635" cy="275" r="68" fill="#0b2940" stroke="#fff" stroke-width="18"/></g><text x="70" y="600" fill="#fff" font-size="42" font-family="Arial" font-weight="700">${title.replace(/[&<>]/g,'')}</text></svg>`}
export async function GET(_req:Request,{params}:{params:Promise<{id:string,index:string}>}){
  const {id,index}=await params;const v:any=await getVehicle(id);if(!v)return new Response('not found',{status:404});
  const idx=Math.max(0,Math.min(7,Number(index)||0));const title=`${v.model_year||''} ${v.brand||''} ${v.model||''}`.trim();
  try{
    let imgs=await commons(`${title} car automobile`);
    if(imgs.length<3) imgs=[...imgs,...await commons(`${v.brand||''} ${v.model||''} vehicle`)];
    const uniq=imgs.filter((x,i,a)=>a.findIndex(y=>y.url===x.url)===i);
    if(uniq.length){const start=hash(String(v.stock_no||id))%uniq.length;const pick=uniq[(start+idx)%uniq.length];return Response.redirect(pick.url,302)}
  }catch(e){console.error('MODEL_PHOTO',e)}
  return new Response(fallbackSvg(title,String(v.stock_no||id)+idx),{headers:{'content-type':'image/svg+xml; charset=utf-8','cache-control':'public,max-age=3600'}})
}
