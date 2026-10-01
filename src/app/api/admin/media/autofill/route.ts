import {isAdmin} from '../../../../../lib/admin';
import {db,rows} from '../../../../../lib/db';
export const dynamic='force-dynamic';

type CommonsPage={title?:string;imageinfo?:Array<{thumburl?:string;url?:string;extmetadata?:Record<string,{value?:string}>}>};
function stripHtml(x:string){return x.replace(/<[^>]*>/g,'').replace(/&quot;/g,'"').replace(/&#39;/g,"'").replace(/&amp;/g,'&').trim()}
async function commonsImages(query:string,need:number){
 const p=new URLSearchParams({action:'query',format:'json',origin:'*',generator:'search',gsrsearch:query,gsrnamespace:'6',gsrlimit:String(Math.min(10,need+5)),prop:'imageinfo',iiprop:'url|extmetadata',iiurlwidth:'1200'});
 const r=await fetch('https://commons.wikimedia.org/w/api.php?'+p.toString(),{headers:{'user-agent':'SkyCars/1.0 vehicle model photo finder'},cache:'no-store'});
 if(!r.ok) return [];
 const j:any=await r.json();const pages:Object= j?.query?.pages||{};const out:any[]=[];
 for(const pg of Object.values(pages) as CommonsPage[]){const ii=pg.imageinfo?.[0];const u=ii?.thumburl||ii?.url;if(!u||!/^https:\/\//i.test(u))continue;const md=ii.extmetadata||{};const license=stripHtml(md.LicenseShortName?.value||'Wikimedia Commons');const artist=stripHtml(md.Artist?.value||'');out.push({url:u,title:String(pg.title||'').replace(/^File:/,''),license,artist});if(out.length>=need)break}
 return out;
}
export async function POST(req:Request){
 if(!(await isAdmin()))return Response.json({error:'Unauthorized'},{status:401});
 const b=await req.json().catch(()=>({}));const after=Math.max(0,Number(b.after_id||0));const batch=Math.max(1,Math.min(15,Number(b.batch||8)));
 const vehicles=await rows<any>(`SELECT v.id,v.stock_no,v.brand,v.model,v.model_year,(SELECT COUNT(*) FROM vehicle_media m WHERE m.vehicle_id=v.id AND m.media_type='image' AND m.review_status='approved') photo_count FROM vehicles v WHERE v.id>? AND v.status<>'hidden' ORDER BY v.id LIMIT ${batch}`,[after]);
 let added=0,checked=0,last=after;const results:any[]=[];
 for(const v of vehicles){last=Number(v.id);checked++;const have=Number(v.photo_count||0);if(have>=3){results.push({id:v.id,stock_no:v.stock_no,added:0,reason:'already has 3+'});continue}const need=3-have;const q=`${v.model_year||''} ${v.brand||''} ${v.model||''} automobile`.trim();let imgs:any[]=[];try{imgs=await commonsImages(q,need)}catch(e){console.error('COMMONS_SEARCH',v.id,e)}
   let n=0;for(const img of imgs){try{const [r]:any=await db().execute(`INSERT INTO vehicle_media(vehicle_id,media_type,url,caption,source,is_cover,sort_order,review_status) SELECT ?,'image',?,?,'other',?,?, 'approved' FROM DUAL WHERE NOT EXISTS(SELECT 1 FROM vehicle_media WHERE vehicle_id=? AND url=?)`,[v.id,img.url,`MODEL PHOTO • Wikimedia Commons • ${img.title} • ${img.license}${img.artist?' • '+img.artist:''}`.slice(0,255),have===0&&n===0?1:0,have+n,v.id,img.url]);if(r.affectedRows){n++;added++}}catch(e){console.error('COMMONS_INSERT',v.id,e)}}results.push({id:v.id,stock_no:v.stock_no,added:n,query:q});
 }
 return Response.json({ok:true,checked,added,after_id:last,done:vehicles.length<batch,results});
}
