export type HgmItem={
  id:string; name:string; price_usd:number|null; url:string; images:string[];
  year:number|null; mileage_km:number|null; mileage_range:string|null;
  fuel_type:string|null; transmission:string|null; steering:'LHD'|'RHD'|'unknown';
  stock_status:string|null; body_type:string|null; description:string;
};

function decode(s:string){return String(s||'').replace(/&nbsp;/g,' ').replace(/&amp;/g,'&').replace(/&quot;/g,'"').replace(/&#39;/g,"'").replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&#x([0-9a-f]+);/gi,(_,x)=>String.fromCharCode(parseInt(x,16))).replace(/&#(\d+);/g,(_,x)=>String.fromCharCode(Number(x)))}
function text(s:string){return decode(String(s||'').replace(/<script[\s\S]*?<\/script>/gi,' ').replace(/<style[\s\S]*?<\/style>/gi,' ').replace(/<[^>]+>/g,' ').replace(/\s+/g,' ').trim())}
function absolute(u:string,base:string){try{return new URL(decode(u),base).toString()}catch{return''}}
function imageOk(u:string){return /^https?:\/\//i.test(u)&&!/\.(svg)(?:$|\?)/i.test(u)&&!/(logo|icon|flag|avatar|qrcode|qr-code|placeholder|loading|sprite|favicon|wechat|whatsapp)/i.test(u)}
function titleFrom(html:string){const h1=html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)?.[1];const og=html.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i)?.[1];const t=html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1];return text(h1||og||t||'').replace(/\s*[|–-]\s*(HongGuanMa|HGM).*$/i,'').trim()}
function priceFrom(s:string){const ms=[...s.matchAll(/(?:US\s*\$|USD\s*|\$)\s*([0-9][0-9,]*(?:\.[0-9]{1,2})?)/gi)];const nums=ms.map(m=>Number(m[1].replace(/,/g,''))).filter(n=>Number.isFinite(n)&&n>=0&&n<1000000);return nums.length?nums[0]:null}
function yearFrom(s:string){const ys=[...s.matchAll(/\b(20(?:1\d|2\d)|19[89]\d)\b/g)].map(m=>Number(m[1])).filter(y=>y>=1990&&y<=2035);return ys.length?ys[0]:null}
function mileageRange(s:string){const m=s.match(/([0-9][0-9,]*)\s*[-–]\s*([0-9][0-9,]*)\s*km/i);return m?`${m[1].replace(/,/g,'')}-${m[2].replace(/,/g,'')} km`:null}
function mileageLower(s:string){const r=mileageRange(s);if(r)return Number(r.split('-')[0]);const m=s.match(/([0-9][0-9,]*)\s*km\b/i);return m?Number(m[1].replace(/,/g,'')):null}
function bodyType(s:string){const t=s.toLowerCase();if(/pickup|pick-up|d-max|fengjun|poer|ranger|hilux/.test(t))return'pickup';if(/mpv|7[- ]?seat|minivan|alphard|gl8/.test(t))return'mpv';if(/suv|tiguan|rav4|x-trail|cr-v|highlander|prado|land cruiser|ix35|trax|yuan plus/.test(t))return'suv';if(/hatchback|golf|fit|yaris/.test(t))return'hatchback';if(/van|transit|hiace/.test(t))return'van';if(/sedan|camry|corolla|passat|bora|lavida|accord|civic|cruze|sail/.test(t))return'sedan';return null}
function productImages(html:string,url:string,id:string){const out:string[]=[];const push=(u:string)=>{u=absolute(u,url);if(!imageOk(u))return;const p=new URL(u).pathname;if(p.includes(`/uploads/vehicles/${id}/`))out.push(u)};for(const m of html.matchAll(/<meta[^>]+(?:property|name)=["'](?:og:image|twitter:image)["'][^>]+content=["']([^"']+)["']/gi))push(m[1]);for(const m of html.matchAll(/<img[^>]+(?:src|data-src|data-original|data-lazy-src)=["']([^"']+)["']/gi))push(m[1]);for(const m of html.matchAll(/srcset=["']([^"']+)["']/gi))for(const p of m[1].split(','))push(p.trim().split(/\s+/)[0]);return [...new Set(out)].slice(0,20)}

export async function hgmFetchHtml(url:string){const ctl=new AbortController();const timer=setTimeout(()=>ctl.abort(),20000);try{const r=await fetch(url,{headers:{'user-agent':'SkyCarsCatalogSync/26.0 (+https://skyshcars.com; authorized inventory mirror)','accept':'text/html,application/xhtml+xml'},cache:'no-store',redirect:'follow',signal:ctl.signal});if(!r.ok)throw new Error(`HongGuanMa HTTP ${r.status}`);return await r.text()}finally{clearTimeout(timer)}}

export function hgmPageInfo(html:string,base='https://hongguanma.com/vehicles'){
  const links:string[]=[];for(const m of html.matchAll(/<a[^>]+href=["']([^"'#]+)["']/gi)){const u=absolute(m[1],base);try{const p=new URL(u).pathname;if(/^\/vehicles\/\d+\/?$/.test(p))links.push(u)}catch{}}
  const txt=text(html);const pageMatch=txt.match(/Page\s+(\d+)\s+of\s+(\d+)/i);const totalMatch=txt.match(/([0-9,]+)\s+Vehicles/i);
  return {detailUrls:[...new Set(links)],page:Number(pageMatch?.[1]||1),totalPages:Number(pageMatch?.[2]||0)||null,totalVehicles:Number((totalMatch?.[1]||'0').replace(/,/g,''))||null};
}

export function parseHgmDetail(html:string,url:string):HgmItem|null{
  const id=(new URL(url).pathname.match(/\/vehicles\/(\d+)/)?.[1]||'').trim();if(!id)return null;
  const raw=text(html);const name=titleFrom(html);if(!name)return null;
  const price=priceFrom(raw);const mileage_range=mileageRange(raw);const lower=mileageLower(raw);
  const fuel=/\belectric\b|\bev\b/i.test(raw)?'electric':/\bhybrid\b/i.test(raw)?'hybrid':/\bdiesel\b/i.test(raw)?'diesel':/\bgasoline\b|\bpetrol\b/i.test(raw)?'gasoline':null;
  const transmission=/\bautomatic\b|\bcvt\b|\bdct\b/i.test(raw)?'Automatic':/\bmanual\b/i.test(raw)?'Manual':null;
  const steering=/\bRHD\b/i.test(raw)?'RHD':/\bLHD\b/i.test(raw)?'LHD':'unknown';
  const status=/\bpre[- ]?order\b/i.test(raw)?'Pre-order':/\bin stock\b/i.test(raw)?'In Stock':null;
  return {id,name,price_usd:price,url,images:productImages(html,url,id),year:yearFrom(name+' '+raw),mileage_km:lower,mileage_range,fuel_type:fuel,transmission,steering,stock_status:status,body_type:bodyType(name+' '+raw),description:raw.slice(0,1800)};
}

export async function scrapeHgmPage(page:number){
  const u=new URL('https://hongguanma.com/vehicles');if(page>1)u.searchParams.set('page',String(page));
  const html=await hgmFetchHtml(u.toString());const info=hgmPageInfo(html,u.toString());
  const results:HgmItem[]=[];for(let i=0;i<info.detailUrls.length;i+=4){const batch=info.detailUrls.slice(i,i+4);const part=await Promise.all(batch.map(async url=>{try{return parseHgmDetail(await hgmFetchHtml(url),url)}catch(e){console.error('HGM_DETAIL_FAIL',url,e);return null}}));for(const x of part)if(x)results.push(x)}
  return {...info,items:results};
}
