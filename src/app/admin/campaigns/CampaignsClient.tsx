'use client';
import { useEffect, useMemo, useState } from 'react';

function obj(x:any){if(!x)return{};if(typeof x==='object')return x;try{return JSON.parse(x)}catch{return{}}}

export default function CampaignsClient(){
  const [items,setItems]=useState<any[]>([]);
  const [ads,setAds]=useState<any[]>([]);
  const [vehicles,setVehicles]=useState<any[]>([]);
  const [busy,setBusy]=useState(0);
  const [q,setQ]=useState('');
  const [ad,setAd]=useState<any>({vehicle_id:'',facebook_ref:'',notes:'',starts_at:'',ends_at:'',status:'active',featured:false});
  const [message,setMessage]=useState('');

  async function load(){
    const r=await fetch('/api/admin/campaigns',{cache:'no-store'});
    const j=await r.json().catch(()=>({}));
    setItems(j.campaigns||[]);setAds(j.adCampaigns||[]);setVehicles(j.vehicles||[]);
  }
  useEffect(()=>{void load()},[]);
  async function act(id:number,action:string){
    setBusy(id);
    if(action==='send')await fetch('/api/admin/campaigns',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id,action})});
    else await fetch('/api/admin/campaigns',{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({id,status:action})});
    setBusy(0);await load();
  }
  async function saveAd(){
    setMessage('');
    const r=await fetch('/api/admin/campaigns',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'save_ad',campaign:ad})});
    const j=await r.json().catch(()=>({}));
    if(!r.ok)return setMessage(j.error||'Could not save advertisement');
    setMessage('Advertisement campaign saved.');
    setAd({vehicle_id:'',facebook_ref:'',notes:'',starts_at:'',ends_at:'',status:'active',featured:false});
    await load();
  }
  async function setAdStatus(row:any,status:string){
    setBusy(Number(row.id));
    const r=await fetch('/api/admin/campaigns',{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({...row,id:row.id,ad_campaign:true,status})});
    const j=await r.json().catch(()=>({}));
    setBusy(0);setMessage(r.ok?'Advertisement status updated.':j.error||'Could not update advertisement');await load();
  }
  const choices=useMemo(()=>{
    const needle=q.trim().toLowerCase();
    return vehicles.filter(v=>!needle||[v.stock_no,v.brand,v.model,v.model_year,v.price_usd].some(x=>String(x||'').toLowerCase().includes(needle))).slice(0,80);
  },[vehicles,q]);
  const selected=vehicles.find(v=>String(v.id)===String(ad.vehicle_id));

  return <div style={{display:'grid',gap:18}}>
    <section className="card">
      <div className="sectionHead"><div><h2>Today&apos;s Advertisements</h2><p className="muted">Give the AI a verified ad reference for a specific available vehicle. An active campaign never overrides an explicit customer choice.</p></div><span className="badge">{ads.filter(a=>a.status==='active').length} active</span></div>
      <div className="formGrid">
        <label>Search inventory<input value={q} onChange={e=>setQ(e.target.value)} placeholder="Stock, make, model, year or price" /></label>
        <label>Vehicle<select value={ad.vehicle_id} onChange={e=>setAd({...ad,vehicle_id:e.target.value})}><option value="">Choose available vehicle</option>{choices.map(v=><option key={v.id} value={v.id}>{v.stock_no} - {v.model_year||''} {v.brand||''} {v.model||''} - ${Number(v.price_usd||0).toLocaleString()}</option>)}</select></label>
        <label>Facebook post or ad reference<input value={ad.facebook_ref} onChange={e=>setAd({...ad,facebook_ref:e.target.value})} placeholder="Post ID or ad reference" /></label>
        <label>Start date<input type="datetime-local" value={ad.starts_at} onChange={e=>setAd({...ad,starts_at:e.target.value})} /></label>
        <label>End date<input type="datetime-local" value={ad.ends_at} onChange={e=>setAd({...ad,ends_at:e.target.value})} /></label>
        <label>Status<select value={ad.status} onChange={e=>setAd({...ad,status:e.target.value})}><option value="active">Active</option><option value="paused">Paused</option><option value="ended">Ended</option></select></label>
        <label style={{display:'flex',alignItems:'center',gap:8}}><input type="checkbox" checked={!!ad.featured} onChange={e=>setAd({...ad,featured:e.target.checked})} />Featured advertisement</label>
      </div>
      <label>Campaign notes<textarea rows={3} value={ad.notes} onChange={e=>setAd({...ad,notes:e.target.value})} placeholder="Optional sales guidance. Inventory price and availability remain authoritative." /></label>
      {selected&&<p className="muted"><b>AI will receive:</b> {selected.model_year||''} {selected.brand||''} {selected.model||''} ({selected.stock_no}) at the current verified inventory price. The campaign is only used when the customer or referral supports this vehicle.</p>}
      <button className="btn" disabled={!ad.vehicle_id} onClick={saveAd}>Save advertisement campaign</button>
      {message&&<p><b>{message}</b></p>}
      <div style={{display:'grid',gap:8,marginTop:14}}>{ads.length?ads.map(row=><div className="contextBlock" key={row.id}><b>{row.model_year} {row.brand} {row.model}</b> <span className="muted">| {row.stock_no} | {row.status} | ${Number(row.price_usd||0).toLocaleString()}</span><p className="muted">{row.facebook_ref?`Ad reference: ${row.facebook_ref}`:'No ad reference'} {row.starts_at?`| Starts ${String(row.starts_at).slice(0,16)}`:''} {row.ends_at?`| Ends ${String(row.ends_at).slice(0,16)}`:''}</p>{row.notes&&<p>{row.notes}</p>}<button className="miniBtn" disabled={busy===Number(row.id)} onClick={()=>setAdStatus(row,row.status==='active'?'paused':'active')}>{row.status==='active'?'Pause':'Activate'}</button> <button className="miniBtn" disabled={busy===Number(row.id)} onClick={()=>setAdStatus(row,'ended')}>End</button></div>):<p className="muted">No advertised vehicles configured.</p>}</div>
    </section>

    <section><h2>Vehicle publishing campaigns</h2><div style={{display:'grid',gap:12}}>{items.length===0?<div className="card"><p>No publishing campaigns yet.</p></div>:items.map(x=>{const ch=obj(x.channels);return <div className="card" key={x.id}><div style={{display:'flex',justifyContent:'space-between',gap:12,flexWrap:'wrap'}}><div><h3 style={{margin:0}}>{x.title}</h3><p className="muted">{x.stock_no||''} | {x.status} | {x.reason}</p></div><div>{ch.facebook?'Facebook ':''}{ch.whatsapp?'WhatsApp':''}</div></div>{x.last_error&&<p style={{color:'#a00'}}>{x.last_error}</p>}<div style={{display:'flex',gap:8,flexWrap:'wrap'}}>{x.status==='draft'&&<button className="btn" onClick={()=>act(x.id,'approved')}>Approve</button>}{['draft','approved','failed'].includes(x.status)&&<button className="btn" disabled={busy===x.id} onClick={()=>act(x.id,'send')}>{busy===x.id?'Sending...':'Send now'}</button>}{!['sent','cancelled'].includes(x.status)&&<button className="btn" onClick={()=>act(x.id,'cancelled')}>Cancel</button>}</div></div>})}</div></section>
  </div>;
}
