import type {Metadata} from 'next';
import ShippingEstimator from '../../components/ShippingEstimator';
import rates from '../../../data/shipping_reference.json';
import {getBusinessPolicy} from '../../lib/business-policy';
import {waLink} from '../../lib/site';

export const dynamic='force-dynamic';
export const metadata:Metadata={
  title:'Vehicle Shipping from China | Sky Cars',
  description:'Reference car and motorcycle shipping guidance from China to African markets, destination gateways, shipping methods, quote requests and shipment tracking.',
};

const METHODS:[string,string][]=[
  ['RORO','Cost-effective vehicle shipping on supported routes.'],
  ['20ft Container','Container option for selected vehicles and destinations.'],
  ['40ft Container','Useful for multiple units or suitable combined loads.'],
  ['Special / DG','For EV battery, oversized or route-specific requirements when applicable.'],
];

export default async function Shipping(){
  const policy=await getBusinessPolicy();
  const countries=Array.from(new Set((rates as any[]).map(x=>x.country)));
  return <main className="wrap pageShipping">
    <section className="shippingHero">
      <div className="shippingHeroCopy">
        <span className="eyebrow">CHINA → AFRICA</span>
        <h1>Vehicle shipping made easier to understand.</h1>
        <p>Explore reference shipping ranges by country and gateway, then request a confirmed Sky Cars quote for the exact vehicle and destination.</p>
      </div>
      <div className="shippingHeroFacts">
        <span><b>Cars</b>${policy.shipping.car_min.toLocaleString()}–${policy.shipping.car_max.toLocaleString()} general guidance</span>
        <span><b>Motorcycles</b>${policy.shipping.motorcycle_min.toLocaleString()}–${policy.shipping.motorcycle_max.toLocaleString()} general guidance</span>
        <span><b>Route</b>confirmed per vehicle</span>
      </div>
    </section>

    <section className="shippingEstimatorSection">
      <ShippingEstimator ranges={policy.shipping}/>
    </section>

    <section className="shippingBlock">
      <div className="sectionHead"><div><span className="eyebrow">DELIVERY OPTIONS</span><h2>Shipping methods</h2><p className="muted">Availability is confirmed for each vehicle, route and sailing.</p></div></div>
      <div className="grid shippingMethods">{METHODS.map(([name,note])=><div className="card" key={name}><h3>{name}</h3><p>{note}</p></div>)}</div>
    </section>

    <section className="shippingBlock">
      <div className="sectionHead"><div><span className="eyebrow">NETWORK</span><h2>{countries.length} African markets in the reference guide</h2></div><a href="/destinations">Explore destinations</a></div>
      <div className="marketCountryCloud">{countries.map(c=><a href={'/destinations?country='+encodeURIComponent(c)} key={c}>{c}</a>)}</div>
    </section>

    <section className="shippingBlock">
      <div className="sectionHead"><div><span className="eyebrow">PROCESS</span><h2>From vehicle to destination</h2></div></div>
      <div className="processRail">{['Vehicle confirmed','Collection & inspection','Export documents','Port & loading','Ocean / inland transport','Destination arrival'].map((x,i)=><div key={x}><b>{i+1}</b><span>{x}</span></div>)}</div>
    </section>

    <section className="shippingQuoteBand card">
      <div><span className="eyebrow">QUOTE REQUEST</span><h2>Turn a reference range into a confirmed quotation</h2><p>Share the exact vehicle, destination country, port or gateway and preferred shipping method. Our team confirms the route and applicable charges before any payment.</p></div>
      <div className="shippingQuoteActions"><a className="btn" href="/quote">Request a quote</a><a className="btn alt" href={waLink('Hello Sky Cars, I would like help with vehicle shipping.')} target="_blank" rel="noreferrer">WhatsApp the team</a></div>
    </section>

    <section className="shippingSupportGrid">
      <div className="card shippingTrackCard"><span className="eyebrow">SHIPMENT TRACKING</span><h2>Already shipping a vehicle?</h2><p>Open the existing tracking workflow and enter the reference provided by our team.</p><a className="btn" href="/tracking">Track shipment</a></div>
      <div className="card shippingTrackCard"><span className="eyebrow">DESTINATION DETAILS</span><h2>Check gateways and ports</h2><p>Browse reference markets, gateway ports and owner-supplied shipping ranges before requesting a confirmed quote.</p><a className="btn alt" href="/destinations">Open destinations</a></div>
    </section>

    <section className="shippingFaq">
      <div className="sectionHead"><div><span className="eyebrow">SHIPPING FAQ</span><h2>What the reference figures mean</h2></div></div>
      <details open><summary>Are these shipping prices guaranteed?</summary><p>No. They are planning references, not live carrier rates or customs quotations. Final freight, inland transport, port, document, insurance, customs and destination charges are confirmed for the exact vehicle and shipment.</p></details>
      <details><summary>Why do cars and motorcycles have different guidance?</summary><p>{policy.shipping.regional_note} {policy.shipping.partners_note}</p></details>
      <details><summary>What information do you need for a quote?</summary><p>The vehicle stock number or sourcing request, your name and WhatsApp number, destination country, port or gateway, preferred shipping method and any additional requirements.</p></details>
      <p className="estimateDisclaimer">Sky Cars coordinates shipping with partners. A partner is named only after coverage for the destination is verified.</p>
    </section>
  </main>;
}
