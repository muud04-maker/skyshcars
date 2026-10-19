import type {Metadata} from 'next';
import marketsData from '../../../data/africa_markets.json';
import ratesData from '../../../data/shipping_reference.json';

export const metadata:Metadata={
  title:'Destinations & Ports | Sky Cars',
  description:'Browse reference destinations, gateway ports and owner-supplied car shipping ranges for African markets.',
};

type Rate={country:string;gateway:string;city:string;min_usd:number;max_usd:number;note?:string};
type Market={country:string;traffic_side?:string;preferred_steering?:string;priority_market?:boolean;landlocked?:boolean;ports?:string[];note?:string};

const rates=ratesData as Rate[];
const markets=marketsData as Market[];
const byCountry=new Map(markets.map(m=>[m.country,m]));
const countries=[...new Set(rates.map(x=>x.country))].sort();

export default async function Page({searchParams}:{searchParams:Promise<{country?:string;q?:string}>}){
  const sp=await searchParams;
  const selected=sp.country&&countries.includes(sp.country)?sp.country:'';
  const q=String(sp.q||'').trim().toLowerCase();

  const groups=new Map<string,Rate[]>();
  for(const rate of rates){
    if(selected&&rate.country!==selected) continue;
    const market=byCountry.get(rate.country);
    const haystack=`${rate.country} ${rate.gateway} ${rate.city} ${rate.note||''} ${(market?.ports||[]).join(' ')}`.toLowerCase();
    if(q&&!haystack.includes(q)) continue;
    const list=groups.get(rate.country)||[];
    list.push(rate);
    groups.set(rate.country,list);
  }

  const directory=[...groups.entries()]
    .map(([country,list])=>{
      const market=byCountry.get(country);
      return {country,routes:list,market,min:Math.min(...list.map(x=>Number(x.min_usd))),max:Math.max(...list.map(x=>Number(x.max_usd)))};
    })
    .sort((a,b)=>Number(!!b.market?.priority_market)-Number(!!a.market?.priority_market)||a.country.localeCompare(b.country));
  const routeCount=directory.reduce((sum,x)=>sum+x.routes.length,0);
  const priorityCount=markets.filter(x=>x.priority_market).length;

  return <main className="wrap pageDestinations">
    <section className="destinationsHero">
      <div>
        <span className="eyebrow">GLOBAL TRADE DIRECTORY</span>
        <h1>China → Africa destinations and ports</h1>
        <p>Browse reference markets, gateway ports and owner-supplied shipping ranges. Every route, sailing and final charge is confirmed for the exact vehicle before payment.</p>
      </div>
      <div className="destinationsStats" aria-label="Directory summary">
        <div><b>{countries.length}</b><span>markets in guide</span></div>
        <div><b>{rates.length}</b><span>gateway references</span></div>
        <div><b>{priorityCount}</b><span>priority markets</span></div>
      </div>
    </section>

    <form className="destinationFilter card" action="/destinations" method="get" role="search">
      <label>Search a country, gateway or port<input name="q" defaultValue={sp.q||''} placeholder="e.g. Mombasa, Lagos, Dar es Salaam"/></label>
      <label>Choose a market<select name="country" defaultValue={selected}><option value="">All reference markets</option>{countries.map(c=><option key={c} value={c}>{c}</option>)}</select></label>
      <div className="destinationFilterActions"><button className="btn" type="submit">Show routes</button>{(q||selected)&&<a className="btn alt" href="/destinations">Clear</a>}</div>
    </form>

    <section className="destinationDirectory" aria-label="Destination directory">
      <div className="directoryHead">
        <div><span className="eyebrow">DESTINATION DIRECTORY</span><h2>{q||selected?'Matching markets':'All reference markets'}</h2></div>
        <p><b>{directory.length}</b> markets · <b>{routeCount}</b> gateway references</p>
      </div>
      {directory.length===0
        ? <div className="card emptyCollection"><h3>No destinations match that search</h3><p>Try a country name, port or gateway city, or reset the directory.</p><a className="btn" href="/destinations">Reset directory</a></div>
        : <div className="countryDirectory">{directory.map(({country,routes:list,market,min,max})=>{
            const open=selected===country||!!q;
            return <details className="countryRecord" key={country} open={open}>
              <summary>
                <span className="countryRecordTitle"><b>{country}</b><small>{market?.preferred_steering?`${market.preferred_steering} market`:'Steering guidance on request'}{market?.landlocked?' · landlocked':''}</small></span>
                <span className="countryRecordMeta"><span>{list.length} route{list.length===1?'':'s'}</span><strong>${Number(min).toLocaleString()}–${Number(max).toLocaleString()}</strong></span>
              </summary>
              <div className="countryRecordBody">
                <div className="countryMarketFacts">
                  <span><small>Steering</small><b>{market?.preferred_steering||'Confirm for vehicle'}</b></span>
                  <span><small>Traffic</small><b>{market?.traffic_side==='right'?'Drives on the right':market?.traffic_side==='left'?'Drives on the left':'Confirm for market'}</b></span>
                  <span><small>Access</small><b>{market?.landlocked?'Gateway port + inland route':'Reference gateway route'}</b></span>
                  <span><small>Reference ports</small><b>{market?.ports?.length?market.ports.join(', '):'Route confirmation required'}</b></span>
                </div>
                <div className="countryRoutes" role="table" aria-label={`${country} reference routes`}>
                  <div className="routeRow routeHead" role="row"><span role="columnheader">Gateway / route</span><span role="columnheader">City served</span><span role="columnheader">Car reference</span></div>
                  {list.map((route,i)=><div className="routeRow" role="row" key={route.gateway+route.city+i}>
                    <span role="cell"><b>{route.gateway}</b>{route.note?<small>{route.note}</small>:null}</span>
                    <span role="cell">{route.city}</span>
                    <span role="cell"><strong>${Number(route.min_usd).toLocaleString()}–${Number(route.max_usd).toLocaleString()}</strong></span>
                  </div>)}
                </div>
                {market?.note&&<p className="countryNote">{market.note}</p>}
                <div className="countryRecordActions"><a className="btn small" href={'/quote?country='+encodeURIComponent(country)}>Request a quote for {country}</a><a className="btn small alt" href={'/shipping?country='+encodeURIComponent(country)}>Shipping guidance</a></div>
              </div>
            </details>;
          })}</div>}
    </section>

    <p className="estimateDisclaimer">These are planning references, not live carrier rates or customs quotations. Vehicle dimensions, RoRo/container availability, inland transport, port costs, documents, insurance, customs and destination fees can change the final amount. Transit times are not published in this directory because they must be confirmed for the sailing.</p>

    <section className="destinationsCta card">
      <div><span className="eyebrow">NEXT STEP</span><h2>Have the vehicle and destination?</h2><p>Send the stock number and destination port. Our team confirms the route and applicable charges with the vehicle details.</p></div>
      <div className="pager"><a className="btn" href="/quote">Request a quote</a><a className="btn alt" href="/vehicles">Browse vehicles</a></div>
    </section>
  </main>;
}
