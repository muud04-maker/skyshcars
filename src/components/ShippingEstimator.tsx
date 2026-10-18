'use client';
import {useMemo,useState} from 'react';
import rates from '../../data/shipping_reference.json';
import {DEFAULT_SHIPPING_RANGES,shippingChoice,type ShippingRanges} from '../lib/shipping-estimate';

/*
  Reference estimator. Route values are owner-supplied car references, not live carrier rates.
  Motorcycles use the approved general guidance because the route table is car freight.
*/
export default function ShippingEstimator({vehiclePrice,category='car',ranges=DEFAULT_SHIPPING_RANGES}:{vehiclePrice?:number;category?:string;ranges?:ShippingRanges}){
  const countries=useMemo(()=>Array.from(new Set((rates as any[]).map(x=>x.country))),[]);
  const [country,setCountry]=useState(countries[0]||'');
  const options=(rates as any[]).filter(x=>x.country===country);
  const [gateway,setGateway]=useState('');
  const selected=options.find(x=>x.gateway===gateway)||options[0];
  const motorcycle=String(category).toLowerCase()==='motorcycle';
  const choice=shippingChoice({category,route:motorcycle?null:selected,ranges});
  return <section className="shippingEstimator card" data-testid="shipping-estimator">
    <div className="sectionHead compact"><div><span className="eyebrow">REFERENCE SHIPPING</span><h2>Estimate delivery range</h2></div><span className="estimateTag">China → Africa</span></div>
    <div className="estimateInputs">
      <label>Country<select value={country} onChange={e=>{setCountry(e.target.value);setGateway('')}}>{countries.map(c=><option key={c}>{c}</option>)}</select></label>
      {!motorcycle&&<label>Gateway / route<select value={selected?.gateway||''} onChange={e=>setGateway(e.target.value)}>{options.map(x=><option value={x.gateway} key={x.gateway+x.city}>{x.gateway} — {x.city}</option>)}</select></label>}
    </div>
    <div className="estimateResult" data-testid="shipping-estimate-result">
      <small>{choice.label}</small>
      <strong>{choice.rangeText}</strong>
      <span>{choice.note}</span>
      {choice.aboveGeneralGuidance&&<div className="estimateFlag"><b>Above the general car guidance</b><span>This destination-specific route reference is retained for accuracy, but it is above the general car range. A confirmed quotation is required.</span></div>}
      {vehiclePrice?<div className="landedEstimate"><span>Vehicle + reference shipping</span><b>${Number(vehiclePrice+choice.min).toLocaleString()}–${Number(vehiclePrice+choice.max).toLocaleString()}</b></div>:null}
    </div>
    <p className="estimateDisclaimer">Reference estimate only. Final freight, inland transport, port, document, insurance, customs and destination charges must be confirmed by Sky Cars before payment.</p>
    <div className="estimateFooter"><span>General guidance: {choice.generalGuidance}</span><a className="btn" href="/quote">Get confirmed quote</a></div>
  </section>;
}
