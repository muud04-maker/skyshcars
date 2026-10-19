'use client';
import {useState} from 'react';

const fmt=(d:any)=>{
  if(!d)return '';
  const value=new Date(d);
  return isNaN(value.getTime())?String(d):value.toLocaleDateString();
};

export default function Tracking(){
  const [ref,setRef]=useState('');
  const [result,setResult]:any=useState(null);
  const [busy,setBusy]=useState(false);

  async function go(e?:any){
    e?.preventDefault();
    if(!ref.trim())return;
    setBusy(true);
    try{
      const response=await fetch('/api/tracking/'+encodeURIComponent(ref.trim()));
      const json=await response.json().catch(()=>({error:'Tracking is temporarily unavailable. Please try again shortly.'}));
      setResult(json);
    }catch{
      setResult({error:'Tracking is temporarily unavailable. Please try again shortly.'});
    }finally{
      setBusy(false);
    }
  }

  return <main className="wrap pageTracking theme-tracking">
    <section className="trackingHero">
      <span className="eyebrow">SHIPMENT TRACKING</span>
      <h1>Track a shipment</h1>
      <p>Enter the reference provided by Sky Cars. Only information stored with the shipment record is shown.</p>
    </section>
    <form className="card trackingForm" onSubmit={go}>
      <label>Tracking reference<input value={ref} onChange={e=>setRef(e.target.value)} placeholder="e.g. SC-2026-001" required/></label>
      <button className="btn" disabled={busy}>{busy?'Checking…':'Track shipment'}</button>
    </form>
    <div aria-live="polite">
      {result&&(result.error
        ? <div className="card trackingResult"><h2>Unable to load tracking</h2><p>{result.error}</p><p className="muted">Check the reference and try again, or contact the team on WhatsApp.</p></div>
        : <div className="card trackingResult"><span className="eyebrow">CURRENT STATUS</span><h2>{String(result.current_status||'In progress').replaceAll('_',' ')}</h2>{result.vessel_name&&<p>Vessel: {result.vessel_name}</p>}{result.eta&&<p>Estimated arrival: {fmt(result.eta)}</p>}{result.public_note&&<p>{result.public_note}</p>}{Array.isArray(result.events)&&result.events.length>0&&<ul className="trackingEvents">{result.events.map((event:any,i:number)=><li key={i}><b>{event.title||event.status}</b><span>{fmt(event.event_time)}</span>{event.public_description?<small>{event.public_description}</small>:null}</li>)}</ul>}</div>)}
    </div>
    <p className="trackingHelp">Need help? <a href="/contact">Contact Sky Cars</a> or open the <a href="/shipping">shipping guidance</a>.</p>
  </main>;
}
