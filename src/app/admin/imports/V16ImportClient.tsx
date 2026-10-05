'use client';
import {useEffect,useState} from 'react';

type Item={id:number;source_message_id:string;raw_payload:any;proposed_vehicle:any;review_status:string;approved_vehicle_id?:number;vehicle_id?:number;stock_no?:string;vehicle_status?:string;created_at:string;media_count:number;media_urls?:string|null};
function parse(x:any){if(!x)return{};if(typeof x==='object')return x;try{return JSON.parse(x)}catch{return{}}}
const CATS=['car','motorcycle','truck','van','bus','machinery','other'];

function ReviewForm({it,onDone}:{it:Item;onDone:()=>void}){
 const v=parse(it.proposed_vehicle);
 const [f,setF]=useState<any>({category:v.category||'car',brand:v.brand||'',model:v.model||'',trim_name:v.trim_name||'',model_year:v.model_year||'',mileage_km:v.mileage_km||'',fuel_type:v.fuel_type||'',transmission:v.transmission||'',color:v.color||'',price_usd:'',description:'',ai_enabled:true});
 const [busy,setBusy]=useState(false),[err,setErr]=useState('');
 const set=(k:string)=>(e:any)=>setF({...f,[k]:e.target.value});
 async function review(action:'approve'|'reject'){
  if(action==='reject'&&!confirm('Reject this supplier post? The pending vehicle will be hidden.'))return;
  setBusy(true);setErr('');
  const r=await fetch('/api/admin/imports/group',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:it.id,action,vehicle:f})});
  const j=await r.json().catch(()=>({}));setBusy(false);
  if(!r.ok){setErr(j.error||'Review failed');return}
  onDone();
 }
 const field=(k:string,label:string,type='text')=><label style={{display:'grid',gap:4,fontSize:13}}>{label}<input type={type} value={f[k]} onChange={set(k)}/></label>;
 return <div style={{display:'grid',gap:10,marginTop:10}}>
  <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(160px,1fr))',gap:10}}>
   <label style={{display:'grid',gap:4,fontSize:13}}>Category<select value={f.category} onChange={set('category')}>{CATS.map(c=><option key={c} value={c}>{c}</option>)}</select></label>
   {field('brand','Make *')}{field('model','Model *')}{field('trim_name','Trim')}{field('model_year','Year','number')}{field('mileage_km','Mileage (km)','number')}{field('fuel_type','Fuel')}{field('transmission','Transmission')}{field('color','Color')}
   <label style={{display:'grid',gap:4,fontSize:13}}>Selling price (USD)<input type="number" min="0" placeholder="Empty = Price on request" value={f.price_usd} onChange={set('price_usd')}/></label>
  </div>
  {(v.price_usd||v.specs)&&<p className="muted" style={{margin:0}}>Supplier reference (internal, never published): {v.price_usd?`$${v.price_usd}`:''} {typeof v.specs==='object'?Object.entries(v.specs).filter(([k])=>/price|cost/i.test(k)).map(([k,x])=>`${k}: ${x}`).join(' · '):''}</p>}
  <label style={{display:'grid',gap:4,fontSize:13}}>Public description (optional — phone numbers, links and supplier contacts are removed automatically)<textarea rows={3} value={f.description} onChange={set('description')}/></label>
  {err&&<p style={{color:'#b3261e',margin:0}}>{err}</p>}
  <label style={{display:'flex',gap:6,alignItems:'center',fontSize:14}}><input type="checkbox" checked={f.ai_enabled!==false} onChange={e=>setF((x:any)=>({...x,ai_enabled:e.target.checked}))}/>Let the AI sell this car</label>
  <div style={{display:'flex',gap:8}}><button className="btn" disabled={busy} onClick={()=>review('approve')}>{busy?'Working…':'Approve → Available'}</button><button className="btn" disabled={busy} onClick={()=>review('reject')}>Reject</button></div>
 </div>
}

export default function V16ImportClient(){
 const [msg,setMsg]=useState('');const [busy,setBusy]=useState(false);const [items,setItems]=useState<Item[]>([]);const [loading,setLoading]=useState(true);
 async function load(){setLoading(true);const r=await fetch('/api/admin/imports/group',{cache:'no-store'});const j=await r.json().catch(()=>({items:[]}));setItems(j.items||[]);setLoading(false)}
 useEffect(()=>{load()},[]);
 async function run(){setBusy(true);setMsg('Importing…');const r=await fetch('/api/admin/imports/v16-last50',{method:'POST'});const j=await r.json().catch(()=>({}));setBusy(false);setMsg(r.ok?`Done: ${j.created} added, ${j.skipped} already existed.`:j.error||'Import failed')}
 return <>
  <div className="card" style={{marginBottom:18}}><h2>V16 — Import the last 50 vehicles</h2><p>Imports the exact 50 vehicle titles and final USD prices supplied for Sky Cars. Safe to run more than once.</p><button className="btn" onClick={run} disabled={busy}>{busy?'Working…':'Import 50 vehicles'}</button>{msg&&<p>{msg}</p>}</div>
  <div className="card"><h2>WhatsApp Group Inventory Review</h2><p>Each supplier post becomes one <b>Pending</b> vehicle with all of its photos. Pending vehicles are never public. Approving turns the same vehicle into <b>Available</b>; rejecting hides it.</p>
   {loading?<p>Loading…</p>:items.length===0?<p className="muted">No WhatsApp group drafts yet. Start the bridge in tools/whatsapp-group-bridge.</p>:
   <div style={{display:'grid',gap:12}}>{items.map(it=>{const raw=parse(it.raw_payload),v=parse(it.proposed_vehicle);const urls=String(it.media_urls||'').split('\n').filter(Boolean);return <div key={it.id} style={{border:'1px solid #d8e2ec',borderRadius:10,padding:14}}>
    <div style={{display:'flex',justifyContent:'space-between',gap:12,flexWrap:'wrap'}}><b>#{it.id} {v.category==='motorcycle'?'🏍 ':''}{v.brand||''} {v.model||''} {v.model_year||''}</b><span>{it.review_status.toUpperCase()}{it.stock_no?` · ${it.stock_no}`:''}{it.vehicle_status?` · vehicle ${it.vehicle_status.replaceAll('_',' ')}`:''}</span></div>
    <p style={{margin:'8px 0',whiteSpace:'pre-wrap'}}>{raw.text||'No text (photos only)'}</p>
    {urls.length>0&&<div style={{display:'flex',gap:6,flexWrap:'wrap'}}>{urls.slice(0,12).map(u=><a key={u} href={u} target="_blank" rel="noreferrer"><img src={u} alt="" style={{width:84,height:64,objectFit:'cover',borderRadius:6,border:'1px solid #d8e2ec'}}/></a>)}</div>}
    <p className="muted">Photos: {it.media_count||0}{Array.isArray(raw.mergedMessageIds)&&raw.mergedMessageIds.length>1?` · merged from ${raw.mergedMessageIds.length} messages`:''}</p>
    {it.review_status==='pending'&&<ReviewForm it={it} onDone={load}/>}
    {it.approved_vehicle_id&&<p>Vehicle: <a href={`/vehicles/${it.approved_vehicle_id}`} target="_blank" rel="noreferrer">#{it.approved_vehicle_id}</a></p>}
   </div>})}</div>}
  </div>
 </>
}
