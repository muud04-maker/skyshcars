'use client';
import {useEffect,useMemo,useState} from 'react';
import shipping from '../../../data/shipping_reference.json';

type Vehicle={id:any;stock_no:string;brand?:string;model?:string;model_year?:number;price_usd?:number};

export default function QuoteForm({initialEmail=''}:{initialEmail?:string}){
  const [vehicles,setVehicles]=useState<Vehicle[]>([]),[vehicle,setVehicle]=useState(''),[country,setCountry]=useState(''),[port,setPort]=useState(''),[method,setMethod]=useState('Need recommendation'),[msg,setMsg]=useState(''),[busy,setBusy]=useState(false);

  useEffect(()=>{
    fetch('/api/vehicles',{cache:'no-store'}).then(r=>r.json()).then(j=>setVehicles(j.inventory||[])).catch(()=>{});
    const q=new URLSearchParams(window.location.search);
    const v=q.get('vehicle');if(v)setVehicle(v);
    const c=q.get('country');
    if(c&&Array.from(new Set((shipping as any[]).map(x=>x.country))).includes(c))setCountry(c);
  },[]);

  const countries=useMemo(()=>Array.from(new Set((shipping as any[]).map(x=>x.country))).sort(),[]);
  const routes=useMemo(()=>(shipping as any[]).filter(x=>x.country===country),[country]);

  useEffect(()=>{
    if(!country){setPort('');return}
    const first=routes[0];
    setPort(first?.gateway||'');
    const note=String(first?.note||'').toLowerCase();
    setMethod(note.includes('roro')?'RORO':'Need recommendation');
  },[country,routes]);

  function onPort(v:string){
    setPort(v);
    const r=routes.find(x=>x.gateway===v);
    const note=String(r?.note||'').toLowerCase();
    setMethod(note.includes('roro')?'RORO':'Need recommendation');
  }

  async function send(e:any){
    e.preventDefault();
    setBusy(true);
    setMsg('Submitting…');
    try{
      const fd=new FormData(e.currentTarget);
      const r=await fetch('/api/quote',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(Object.fromEntries(fd))});
      const j=await r.json().catch(()=>({}));
      setMsg(j.reference?'Quote request '+j.reference+' received.':j.error||'Unable to submit');
    }catch{
      setMsg('Unable to submit. Please try again.');
    }finally{
      setBusy(false);
    }
  }

  const selected=vehicles.find(v=>String(v.id)===String(vehicle)||String(v.stock_no)===String(vehicle));
  return <form className="card quoteFormPanel" onSubmit={send}>
    <fieldset className="quoteGroup">
      <legend><span>01</span>Vehicle</legend>
      <label className="wide">Choose a listed vehicle or request sourcing
        <select name="vehicle" value={vehicle} onChange={e=>setVehicle(e.target.value)}><option value="">Choose a vehicle or ask for sourcing</option>{vehicles.map(v=><option key={String(v.id)} value={String(v.id)}>{v.stock_no} — {[v.model_year,v.brand,v.model].filter(Boolean).join(' ')}{v.price_usd?' — $'+Number(v.price_usd).toLocaleString():''}</option>)}</select>
      </label>
      {selected&&<div className="quoteHint">Selected from the vehicle page. You can change it here before submitting.</div>}
    </fieldset>

    <fieldset className="quoteGroup">
      <legend><span>02</span>Customer contact</legend>
      <div className="quoteFields">
        <label>Name<input name="name" required autoComplete="name" placeholder="Your name"/></label>
        <label>WhatsApp<input name="whatsapp" required autoComplete="tel" placeholder="e.g. +252…"/></label>
        <label className="wide">Email <span className="muted">(optional)</span><input name="email" type="email" defaultValue={initialEmail} autoComplete="email" placeholder="Optional"/></label>
      </div>
    </fieldset>

    <fieldset className="quoteGroup">
      <legend><span>03</span>Destination</legend>
      <div className="quoteFields">
        <label>Destination country<select name="country" required value={country} onChange={e=>setCountry(e.target.value)}><option value="">Choose country</option>{countries.map(c=><option key={c}>{c}</option>)}</select></label>
        <label>Destination port / gateway<select name="port" required value={port} onChange={e=>onPort(e.target.value)} disabled={!country}><option value="">Choose port</option>{routes.map((r:any,i:number)=><option key={r.gateway+'-'+i} value={r.gateway}>{r.gateway}{r.city?` — ${r.city}`:''}</option>)}</select></label>
      </div>
    </fieldset>

    <fieldset className="quoteGroup">
      <legend><span>04</span>Shipping method</legend>
      <label>Preferred method<select name="method" value={method} onChange={e=>setMethod(e.target.value)}><option>Need recommendation</option><option>RORO</option><option>20ft Container</option><option>40ft Container</option><option>Special / DG</option></select></label>
    </fieldset>

    <fieldset className="quoteGroup">
      <legend><span>05</span>Additional requirements</legend>
      <label>Notes<textarea name="notes" placeholder="Anything else we should know about the vehicle, destination or timing?"/></label>
    </fieldset>

    <div className="quoteSubmitRow">
      <button className="btn" disabled={busy}>{busy?'Submitting…':'Submit Quote Request'}</button>
      <p>This sends a request. A quotation is confirmed only after our team verifies the vehicle, route and charges.</p>
    </div>
    {msg&&<p className={msg.startsWith('Quote request')?'success status':'error status'} role="status" aria-live="polite"><b>{msg}</b></p>}
  </form>;
}
