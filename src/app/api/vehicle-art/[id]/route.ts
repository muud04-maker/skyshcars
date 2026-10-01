import {getVehicle} from '../../../../lib/vehicles';
export const dynamic='force-dynamic';
function esc(s:string){return s.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]||c))}
export async function GET(_req:Request,{params}:{params:Promise<{id:string}>}){
 const {id}=await params;const v:any=await getVehicle(id);if(!v)return new Response('not found',{status:404});
 const title=esc(`${v.model_year||''} ${v.brand||''} ${v.model||''}`.trim());
 let h=0;for(const c of String(v.stock_no||id))h=(h*31+c.charCodeAt(0))>>>0;const hue=h%360;const hue2=(hue+42)%360;
 const isBike=v.category==='motorcycle';
 const art=isBike?`<g transform="translate(180 145)" fill="none" stroke="white" stroke-width="16" stroke-linecap="round" stroke-linejoin="round"><circle cx="40" cy="100" r="46"/><circle cx="310" cy="100" r="46"/><path d="M40 100L130 35l75 65H40m165 0 52-90 53 90M130 35h75m-33 0-35-55"/></g>`:`<g transform="translate(120 115)"><path d="M80 120h480c35 0 63 25 67 58l5 37H22l7-53c5-25 25-42 51-42z" fill="rgba(255,255,255,.95)"/><path d="M180 120l65-85h190l100 85" fill="none" stroke="rgba(255,255,255,.95)" stroke-width="30" stroke-linejoin="round"/><circle cx="150" cy="220" r="55" fill="#10283e" stroke="white" stroke-width="14"/><circle cx="510" cy="220" r="55" fill="#10283e" stroke="white" stroke-width="14"/></g>`;
 const svg=`<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="675" viewBox="0 0 1200 675"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop stop-color="hsl(${hue} 55% 27%)"/><stop offset="1" stop-color="hsl(${hue2} 60% 14%)"/></linearGradient></defs><rect width="1200" height="675" fill="url(#g)"/><circle cx="1020" cy="80" r="260" fill="rgba(255,255,255,.06)"/><circle cx="80" cy="620" r="320" fill="rgba(255,255,255,.04)"/>${art}<text x="60" y="590" fill="white" font-size="42" font-family="Arial,sans-serif" font-weight="700">${title}</text><text x="60" y="635" fill="rgba(255,255,255,.72)" font-size="24" font-family="Arial,sans-serif">${esc(String(v.stock_no||''))}</text></svg>`;
 return new Response(svg,{headers:{'content-type':'image/svg+xml; charset=utf-8','cache-control':'public, max-age=86400'}})
}
