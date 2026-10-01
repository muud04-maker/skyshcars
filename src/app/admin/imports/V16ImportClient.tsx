'use client';
import {useEffect,useState} from 'react';

type Item={id:number;source_message_id:string;raw_payload:any;proposed_vehicle:any;review_status:string;approved_vehicle_id?:number;created_at:string;media_count:number};
function parse(x:any){if(!x)return{};if(typeof x==='object')return x;try{return JSON.parse(x)}catch{return{}}}
export default function V16ImportClient(){
 const [msg,setMsg]=useState('');const [busy,setBusy]=useState(false);const [items,setItems]=useState<Item[]>([]);const [loading,setLoading]=useState(true);
 async function load(){setLoading(true);const r=await fetch('/api/admin/imports/group',{cache:'no-store'});const j=await r.json().catch(()=>({items:[]}));setItems(j.items||[]);setLoading(false)}
 useEffect(()=>{load()},[]);
 async function run(){setBusy(true);setMsg('Importing…');const r=await fetch('/api/admin/imports/v16-last50',{method:'POST'});const j=await r.json().catch(()=>({}));setBusy(false);setMsg(r.ok?`Done: ${j.created} added, ${j.skipped} already existed.`:j.error||'Import failed')}
 async function review(id:number,action:'approve'|'reject'){const r=await fetch('/api/admin/imports/group',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id,action})});const j=await r.json().catch(()=>({}));if(!r.ok)alert(j.error||'Review failed');await load()}
 return <>
  <div className="card" style={{marginBottom:18}}><h2>V16 — Import the last 50 vehicles</h2><p>Imports the exact 50 vehicle titles and final USD prices supplied for Sky Cars. Safe to run more than once.</p><button className="btn" onClick={run} disabled={busy}>{busy?'Working…':'Import 50 vehicles'}</button>{msg&&<p>{msg}</p>}</div>
  <div className="card"><h2>WhatsApp Group Inventory Review</h2><p>Listings received by the secure group bridge appear here first. Nothing is public until you review it.</p>
   {loading?<p>Loading…</p>:items.length===0?<p className="muted">No WhatsApp group drafts yet. Start the bridge in tools/whatsapp-group-bridge.</p>:
   <div style={{display:'grid',gap:12}}>{items.map(it=>{const raw=parse(it.raw_payload),v=parse(it.proposed_vehicle);return <div key={it.id} style={{border:'1px solid #d8e2ec',borderRadius:10,padding:14}}>
    <div style={{display:'flex',justifyContent:'space-between',gap:12,flexWrap:'wrap'}}><b>#{it.id} {v.brand||''} {v.model||''} {v.model_year||''}</b><span>{it.review_status.toUpperCase()}</span></div>
    <p style={{margin:'8px 0'}}>{raw.text||v.description||'No text'}</p>
    <p className="muted">Photos: {it.media_count||0} · Source message: {it.source_message_id}</p>
    {it.review_status==='pending'&&<div style={{display:'flex',gap:8}}><button className="btn" onClick={()=>review(it.id,'approve')}>Approve to inventory</button><button className="btn" onClick={()=>review(it.id,'reject')}>Reject</button></div>}
    {it.approved_vehicle_id&&<p>Created vehicle ID: {it.approved_vehicle_id}</p>}
   </div>})}</div>}
  </div>
 </>
}
