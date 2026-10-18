import {getVehicle} from '../../../../../lib/vehicles';
import {vehicleDisplayTitle} from '../../../../../lib/display-title';
export const dynamic='force-dynamic';

type Img={url:string;title:string};
const BAD_IMAGE_TITLE=/(logo|badge|icon|diagram|drawing|interior|engine|wheel|emblem|manual|brochure|catalog|page|scan|document|poster|advertisement|book|magazine|newspaper|certificate|invoice|specification|repair|workshop|parts|license|plate|screenshot|text)/i;
const photoCache=new Map<string,{url:string|null;expires:number}>();

function hash(s:string){let h=2166136261;for(const c of s){h^=c.charCodeAt(0);h=Math.imul(h,16777619)}return h>>>0}

async function commons(query:string):Promise<Img[]>{
  const p=new URLSearchParams({action:'query',format:'json',origin:'*',generator:'search',gsrsearch:query+' filetype:bitmap',gsrnamespace:'6',gsrlimit:'24',prop:'imageinfo',iiprop:'url',iiurlwidth:'1400'});
  const r=await fetch('https://commons.wikimedia.org/w/api.php?'+p.toString(),{headers:{'user-agent':'SkyCars/2.0 authorized vehicle catalogue'},cache:'force-cache',signal:AbortSignal.timeout(2500)});
  if(!r.ok)return[];
  const j:any=await r.json();
  const pages:any[]=Object.values(j?.query?.pages||{});
  return pages.map((pg:any)=>({url:pg?.imageinfo?.[0]?.thumburl||pg?.imageinfo?.[0]?.url,title:String(pg?.title||'')}))
    .filter(x=>/^https:\/\//i.test(x.url)&&!/\.(pdf|svg|djvu|tif|tiff)$/i.test(x.url)&&!BAD_IMAGE_TITLE.test(x.title));
}

function vehicleTokens(v:any){
  const raw=[v?.brand,v?.model].filter(Boolean).join(' ').toLowerCase();
  const generic=new Set(['car','cars','vehicle','vehicles','automobile','auto','sedan','suv','pickup','motorcycle','bike','plus','abs','the','and','new','used']);
  return [...new Set(raw.split(/[^a-z0-9]+/).filter(x=>x.length>=3&&!generic.has(x)))];
}

function matchesVehicle(title:string,tokens:string[]){
  if(!tokens.length)return true;
  const t=title.toLowerCase();
  return tokens.some(token=>t.includes(token));
}

function fallbackSvg(seed:string){
  const h=hash(seed)%360;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="675"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop stop-color="hsl(${h} 42% 25%)"/><stop offset="1" stop-color="#071b2d"/></linearGradient></defs><rect width="1200" height="675" fill="url(#g)"/><g transform="translate(170 160)"><path d="M80 150h610c40 0 75 30 80 70l5 50H20l8-66c5-31 28-54 62-54z" fill="#f4f7fb"/><path d="M200 150l85-105h245l130 105" fill="none" stroke="#f4f7fb" stroke-width="35" stroke-linejoin="round"/><circle cx="180" cy="275" r="68" fill="#0b2940" stroke="#fff" stroke-width="18"/><circle cx="635" cy="275" r="68" fill="#0b2940" stroke="#fff" stroke-width="18"/></g></svg>`;
}

export async function GET(_req:Request,{params}:{params:Promise<{id:string,index:string}>}){
  const {id,index}=await params;
  const v:any=await getVehicle(id);
  if(!v)return new Response('not found',{status:404});
  const idx=Math.max(0,Math.min(7,Number(index)||0));
  const title=vehicleDisplayTitle(v);
  const cacheKey=`${v.stock_no||id}:${idx}:${title}`;
  const cached=photoCache.get(cacheKey);
  if(cached&&cached.expires>Date.now()){
    if(cached.url)return Response.redirect(cached.url,302);
    return new Response(fallbackSvg(String(v.stock_no||id)+idx),{headers:{'Content-Type':'image/svg+xml; charset=utf-8','Cache-Control':'public, max-age=600'}});
  }
  const tokens=vehicleTokens(v);
  try{
    let imgs=(await commons(`${title} car automobile`)).filter(x=>matchesVehicle(x.title,tokens));
    if(imgs.length<3) imgs=[...imgs,...(await commons(`${v.brand||''} ${v.model||''} vehicle`)).filter(x=>matchesVehicle(x.title,tokens))];
    const uniq=imgs.filter((x,i,a)=>a.findIndex(y=>y.url===x.url)===i);
    if(uniq.length){
      const start=hash(String(v.stock_no||id))%uniq.length;
      const pick=uniq[(start+idx)%uniq.length];
      photoCache.set(cacheKey,{url:pick.url,expires:Date.now()+3600_000});
      return Response.redirect(pick.url,302);
    }
  }catch(e){console.error('MODEL_PHOTO',e)}
  photoCache.set(cacheKey,{url:null,expires:Date.now()+600_000});
  return new Response(fallbackSvg(String(v.stock_no||id)+idx),{headers:{'Content-Type':'image/svg+xml; charset=utf-8','Cache-Control':'public, max-age=600'}});
}
