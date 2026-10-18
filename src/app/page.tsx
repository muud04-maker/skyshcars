import {getNewArrivals} from '../lib/vehicles';
import {soldStats} from '../lib/vehicles';
import {getBusinessPolicy,shippingEstimateFor,DEFAULT_POLICY} from '../lib/business-policy';
import VehicleGrid from '../components/VehicleGrid';
import ShippingEstimator from '../components/ShippingEstimator';
import {waLink,vehicleTitle} from '../lib/site';

export const dynamic='force-dynamic';

/*
  Homepage: the brand signature. Everything shown is real inventory/settings data - the hero photo is
  the cover of an actual available arrival (never a stock marketing image), the sold figures are
  "marked Sold" inventory counts, and shipping ranges come from the admin business policy.
*/
const CATEGORIES:[string,string,string][]=[
  ['Cars','/cars','Sedans, SUVs, pickups and vans'],
  ['Motorcycles','/motorcycles','Sport, touring and commuter bikes'],
  ['Electric','/vehicles?fuel=electric','EV and hybrid inventory'],
  ['SUVs','/vehicles?body=SUV','Space and capability'],
  ['Pickups','/vehicles?body=pickup','Work-ready vehicles'],
  ['Sold Vehicles','/sold-vehicles','Previously listed units'],
];
const BRANDS=['Toyota','Honda','BYD','Volkswagen','BMW','Hyundai','Kia','Nissan','Geely','Volvo','Suzuki','Yamaha'];
const STEPS:[string,string,string][]=[
  ['01','Discover','Browse verified cars and motorcycles, filter by budget and specification, and save the options that fit.'],
  ['02','Confirm','Ask for exact photos, specifications and current availability for the unit you are considering.'],
  ['03','Quote','Confirm the vehicle, destination port, shipping route and applicable charges with our team.'],
  ['04','Export','Agree the purchase and payment steps, then follow the shipping and tracking milestones.'],
];

export default async function Home(){
  const [arrivals,sold,policy]=await Promise.all([
    getNewArrivals(12).catch(()=>[] as any[]),
    soldStats().catch(()=>({total:0,cars:0,motorcycles:0,recent_30d:0})),
    getBusinessPolicy().catch(()=>DEFAULT_POLICY),
  ]);
  const hero=arrivals[0]||null;
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
            <a className="btn alt" href="/quote" style={{borderColor:'rgba(255,255,255,.35)',color:'#fff'}}>Request a quote</a>
          </div>
          <div className="heroSearchLine">
            <a href="/vehicles?brand=Toyota">Toyota</a>
            <a href="/vehicles?fuel=electric">Electric</a>
            <a href="/vehicles?maxPrice=5000">Under $5,000</a>
            <a href="/vehicles?maxPrice=10000">Under $10,000</a>
            <a href="/shipping">Shipping to Africa</a>
          </div>
          <div className="heroTrust">
            <span><b>Real inventory</b> - current listings only</span>
            <span><b>Verified photos</b> - exact units marked</span>
            <span><b>WhatsApp</b> - direct sales support</span>
          </div>
        </div>
        <div className="heroMedia">
          {heroImage
            ? <><img src={heroImage} alt={vehicleTitle(hero)} loading="eager"/><div className="heroMediaTag"><b>{vehicleTitle(hero)}</b><small>{hero.price_usd?`$${Number(hero.price_usd).toLocaleString()} - `:''}Stock {hero.stock_no} - available</small></div></>
            : <div className="heroMediaEmpty"><b>Cars and motorcycles from China</b><span>Browse verified inventory and request exact photos from our team.</span></div>}
        </div>
      </div>
    </section>

    <section className="section section--silver"><div className="sectionInner">
      <div className="sectionHead"><div><span className="eyebrow">SHOP BY TYPE</span><h2>Find the right vehicle faster</h2></div><a href="/vehicles">See all vehicles</a></div>
      <div className="tileGrid">{CATEGORIES.map(([label,href,note])=><a className="tile" href={href} key={label}><b>{label}</b><small>{note}</small></a>)}</div>
      <div className="brandRow">{BRANDS.map(b=><a key={b} href={'/vehicles?brand='+encodeURIComponent(b)}>{b}</a>)}</div>
    </div></section>

    <section className="section"><div className="sectionInner">
      <div className="sectionHead"><div><span className="eyebrow">NEW ARRIVALS</span><h2>Recently added, available now</h2><p className="muted">Available vehicles added in the last 10 days.</p></div><a href="/vehicles">Explore the marketplace</a></div>
      {arrivals.length
        ? <VehicleGrid list={arrivals}/>
        : <div className="emptyState"><b>No new vehicles added in the last 10 days.</b><span>New listings appear here as soon as they are added.</span><a className="btn" href="/vehicles">Browse all vehicles</a></div>}
    </div></section>

    <section className="section section--dark"><div className="sectionInner">
      <div className="sectionHead"><div><span className="eyebrow" style={{color:'var(--sc-gold)'}}>HOW IT WORKS</span><h2>One team from search to shipment</h2><p className="muted">A practical process built around real inventory and confirmed details.</p></div></div>
      <div className="stepGrid">{STEPS.map(([no,title,body])=><article className="stepCard" key={no}><span className="stepNo">{no}</span><h3>{title}</h3><p>{body}</p></article>)}</div>
    </div></section>

    <section className="section"><div className="sectionInner">
      <div style={{display:'grid',gridTemplateColumns:'minmax(0,1.1fr) minmax(0,.9fr)',gap:'28px',alignItems:'start'}}>
        <div>
          <span className="eyebrow">SHIPPING ASSISTANCE</span>
          <h2>Shipping guidance you can plan around</h2>
          <p className="lead">{carRange}</p>
          <p className="lead">{motoRange}</p>
          <p className="muted">{policy.shipping.regional_note}</p>
          <p className="muted">{policy.shipping.partners_note}</p>
          <div className="pager" style={{justifyContent:'flex-start'}}><a className="btn" href="/shipping">Shipping estimates</a><a className="btn alt" href="/destinations">Destinations and ports</a></div>
        </div>
        <ShippingEstimator/>
      </div>
    </div></section>

    <section className="section section--silver"><div className="sectionInner">
      <div className="soldStrip">
        <div>
          <span className="eyebrow">SOLD INVENTORY</span>
          <h2>{sold.total} vehicle{sold.total===1?'':'s'} marked Sold</h2>
          <p>{sold.cars} cars and {sold.motorcycles} motorcycles previously listed by Sky Cars. A Sold label is an inventory status, not proof of a completed transaction. Ask our team for a similar available unit.</p>
        </div>
        <div className="pager" style={{margin:0,justifyContent:'flex-end'}}><a className="btn" href="/sold-vehicles">View Sold Vehicles</a></div>
      </div>
    </div></section>

    <section className="section"><div className="sectionInner">
      <div className="ctaBand">
        <div><span className="eyebrow" style={{color:'var(--sc-gold)'}}>TALK TO THE TEAM</span><h2>Tell us the vehicle you need</h2><p>Share the brand, model, year, budget and destination. We will check current inventory, confirm the details and explain the next step.</p></div>
        <div className="pager" style={{margin:0,justifyContent:'flex-end'}}>
          <a className="btn" href={waLink('Hello Sky Cars, I would like help finding a vehicle.')} target="_blank" rel="noreferrer">WhatsApp our team</a>
          <a className="btn alt" href="/quote" style={{borderColor:'rgba(255,255,255,.35)',color:'#fff'}}>Request a quote</a>
        </div>
      </div>
    </div></section>
  </>;
}