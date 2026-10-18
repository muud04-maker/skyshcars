import {getNewArrivals,getVehicles,getSoldVehicles,soldStats} from '../lib/vehicles';
import {getBusinessPolicy,shippingEstimateFor,DEFAULT_POLICY} from '../lib/business-policy';
import VehicleGrid from '../components/VehicleGrid';
import ShippingEstimator from '../components/ShippingEstimator';
import {waLink,vehicleTitle} from '../lib/site';

export const dynamic='force-dynamic';

/*
  Homepage. New Arrivals stays strictly Available + created in the last 10 days. The hero may use the
  latest Available unit when that recent-arrivals list is empty, so the first screen still shows real
  inventory without weakening the New Arrivals rule. Sold values are inventory status, not sales proof.
*/
const CATEGORIES:[string,string,string,string][]=[
  ['Cars','/cars','Sedans, SUVs, pickups and vans','CAR'],
  ['Motorcycles','/motorcycles','Sport, touring and commuter bikes','MOTO'],
  ['Electric','/vehicles?fuel=electric','EV and hybrid inventory','EV'],
  ['SUVs','/vehicles?body=SUV','Space and capability','SUV'],
  ['Pickups','/vehicles?body=pickup','Work-ready vehicles','4X4'],
  ['Sold Vehicles','/sold-vehicles','Previously listed units','SOLD'],
];
const BRANDS=['Toyota','Honda','BYD','Volkswagen','BMW','Hyundai','Kia','Nissan','Geely','Volvo','Suzuki','Yamaha'];
const STEPS:[string,string,string][]=[
  ['01','Discover','Browse verified cars and motorcycles, filter by budget and specification, and save the options that fit.'],
  ['02','Confirm','Ask for exact photos, specifications and current availability for the unit you are considering.'],
  ['03','Quote','Confirm the vehicle, destination port, shipping route and applicable charges with our team.'],
  ['04','Export','Agree the purchase and payment steps, then follow the shipping and tracking milestones.'],
];

export default async function Home(){
  const [arrivals,latest,soldList,sold,policy]=await Promise.all([
    getNewArrivals(12).catch(()=>[] as any[]),
    getVehicles({limit:8,onlyAvailable:true,sort:'created_desc'}).catch(()=>[] as any[]),
    getSoldVehicles({limit:4,sort:'created_desc'}).catch(()=>[] as any[]),
    soldStats().catch(()=>({total:0,cars:0,motorcycles:0,recent_30d:0})),
    getBusinessPolicy().catch(()=>DEFAULT_POLICY),
  ]);
  const exactImage=(v:any)=>!!v?.cover_url&&v.photo_kind!=='representative'&&!String(v.cover_url).includes('/api/model-photo/');
  const hero=[...arrivals,...latest].find(exactImage)||arrivals[0]||latest[0]||null;
  const heroImage=hero?.cover_url||null;
  const carRange=shippingEstimateFor(policy,'car');
  const motoRange=shippingEstimateFor(policy,'motorcycle');
  return <>
    <section className="heroSection">
      <div className="heroGrid">
        <div className="heroCopy">
          <div className="eyebrow">SKY CARS &amp; MOTORCYCLES</div>
          <h1 className="heroTitle">Your next vehicle.<br/><span>Connected to the world.</span></h1>
          <p className="heroLead">Explore cars and motorcycles in China, with sourcing assistance and international shipping coordination from Sky Cars.</p>
          <div className="heroActions">
            <a className="btn" href="/vehicles">Explore vehicles</a>
            <a className="btn alt heroAlt" href="/quote">Request a quote</a>
          </div>
          <div className="heroSearchLine">
            <a href="/vehicles?brand=Toyota">Toyota</a>
            <a href="/vehicles?fuel=electric">Electric</a>
            <a href="/vehicles?maxPrice=5000">Under $5,000</a>
            <a href="/vehicles?maxPrice=10000">Under $10,000</a>
            <a href="/shipping">Shipping to Africa</a>
          </div>
          <div className="heroTrust">
            <span><b>Real inventory</b> current listings only</span>
            <span><b>Verified photos</b> exact units marked</span>
            <span><b>WhatsApp</b> direct sales support</span>
          </div>
        </div>
        <div className="heroMedia">
          {heroImage
            ? <><img src={heroImage} alt={vehicleTitle(hero)} loading="eager"/><div className="heroMediaBadge">Available now</div><div className="heroMediaTag"><b>{vehicleTitle(hero)}</b><small>{hero.price_usd?`$${Number(hero.price_usd).toLocaleString()} · `:''}Stock {hero.stock_no}</small></div></>
            : <div className="heroMediaEmpty"><b>Cars and motorcycles from China</b><span>Browse verified inventory and request exact photos from our team.</span><a className="btn" href="/vehicles">Browse inventory</a></div>}
        </div>
      </div>
    </section>

    <section className="section section--categories"><div className="sectionInner">
      <div className="sectionHead"><div><span className="eyebrow">SHOP BY TYPE</span><h2>Find the right vehicle faster</h2><p className="muted">Start with the body style or category that fits the job.</p></div><a href="/vehicles">See all vehicles</a></div>
      <div className="categoryGrid">{CATEGORIES.map(([label,href,note,mark])=><a className="categoryTile" href={href} key={label}><span className="categoryMark">{mark}</span><b>{label}</b><small>{note}</small><span className="categoryArrow" aria-hidden="true">→</span></a>)}</div>
      <div className="brandRow brandRowDark">{BRANDS.map(b=><a key={b} href={'/vehicles?brand='+encodeURIComponent(b)}>{b}</a>)}</div>
    </div></section>

    <section className="section section--arrivals"><div className="sectionInner">
      <div className="sectionHead"><div><span className="eyebrow">NEW ARRIVALS</span><h2>Recently added, available now</h2><p className="muted">Available vehicles added in the last 10 days.</p></div><a href="/vehicles">Explore the marketplace</a></div>
      {arrivals.length
        ? <VehicleGrid list={arrivals}/>
        : <div className="emptyState arrivalsEmpty"><b>No new vehicles added in the last 10 days.</b><span>New listings appear here as soon as they are added.</span><a className="btn" href="/vehicles">Browse all vehicles</a></div>}
    </div></section>

    <section className="section section--dark"><div className="sectionInner">
      <div className="sectionHead"><div><span className="eyebrow" style={{color:'var(--sc-gold)'}}>HOW IT WORKS</span><h2>One team from search to shipment</h2><p className="muted">A practical process built around real inventory and confirmed details.</p></div></div>
      <div className="stepGrid">{STEPS.map(([no,title,body])=><article className="stepCard" key={no}><span className="stepNo">{no}</span><h3>{title}</h3><p>{body}</p></article>)}</div>
    </div></section>

    <section className="section section--blue shippingSection"><div className="sectionInner shippingGrid">
      <div className="shippingCopy">
        <span className="eyebrow">SHIPPING ASSISTANCE</span>
        <h2>Shipping guidance you can plan around</h2>
        <p className="lead">{carRange}</p>
        <p className="lead">{motoRange}</p>
        <p className="muted">{policy.shipping.regional_note}</p>
        <p className="muted">{policy.shipping.partners_note}</p>
        <div className="pager" style={{justifyContent:'flex-start'}}><a className="btn" href="/shipping">Shipping estimates</a><a className="btn alt heroAlt" href="/destinations">Destinations and ports</a></div>
      </div>
      <ShippingEstimator ranges={policy.shipping}/>
    </div></section>

    <section className="sourcingBand" style={heroImage?{backgroundImage:`linear-gradient(90deg,rgba(5,18,31,.96),rgba(5,18,31,.62)),url(${heroImage})`}:undefined}>
      <div className="sourcingInner">
        <span className="eyebrow">SOURCING THAT STARTS WITH THE UNIT</span>
        <h2>Tell us the vehicle. We check what is actually available.</h2>
        <p>Share the brand, model, year, budget and destination. Our team checks current inventory, confirms the exact unit and explains the next step before any payment.</p>
        <div className="pager" style={{justifyContent:'flex-start'}}><a className="btn" href="/quote">Request a vehicle</a><a className="btn alt heroAlt" href={waLink('Hello Sky Cars, I would like help finding a vehicle.')} target="_blank" rel="noreferrer">WhatsApp our team</a></div>
      </div>
    </section>

    <section className="section section--sold"><div className="sectionInner">
      <div className="sectionHead"><div><span className="eyebrow">SOLD INVENTORY</span><h2>Previously listed vehicles</h2><p className="muted">A Sold label is an inventory status, not proof of a completed or paid transaction.</p></div><a href="/sold-vehicles">View all sold vehicles</a></div>
      <div className="soldStatsRow">
        <div><b>{sold.total}</b><span>Vehicles marked Sold</span></div>
        <div><b>{sold.cars}</b><span>Cars</span></div>
        <div><b>{sold.motorcycles}</b><span>Motorcycles</span></div>
        <div><b>{sold.recent_30d}</b><span>Marked Sold in 30 days</span></div>
      </div>
      {soldList.length
        ? <VehicleGrid list={soldList}/>
        : <div className="soldEmpty"><b>No vehicles are currently marked Sold.</b><span>When a unit is marked Sold it will appear here with its last listed price and a clear SOLD badge.</span><a className="btn" href="/vehicles">Browse available vehicles</a></div>}
    </div></section>

    <section className="section section--trust"><div className="sectionInner">
      <div className="ctaBand">
        <div><span className="eyebrow" style={{color:'var(--sc-gold)'}}>TALK TO THE TEAM</span><h2>Tell us the vehicle you need</h2><p>Share the brand, model, year, budget and destination. We will check current inventory, confirm the details and explain the next step.</p></div>
        <div className="pager" style={{margin:0,justifyContent:'flex-end'}}>
          <a className="btn" href={waLink('Hello Sky Cars, I would like help finding a vehicle.')} target="_blank" rel="noreferrer">WhatsApp our team</a>
          <a className="btn alt heroAlt" href="/quote">Request a quote</a>
        </div>
      </div>
    </div></section>
  </>;
}
