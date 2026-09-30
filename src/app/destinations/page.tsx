import markets from "../../../data/africa_markets.json";
export default function Page(){
 const priority=markets.filter(x=>x.priority_market), other=markets.filter(x=>!x.priority_market);
 const Cards=({items}:{items:any[]})=><div className="grid">{items.map((x:any)=><div className="card" key={x.country}>
  <span className="badge">{x.preferred_steering} market</span><h3>{x.country}</h3>
  <p>Traffic: {x.traffic_side==="right"?"drives on the right":"drives on the left"}</p>
  <p>{x.landlocked?"Landlocked — gateway port required":x.ports.length?`Reference ports: ${x.ports.join(", ")}`:"Port/gateway confirmation required"}</p>
  <small>Shipping: quote & route confirmation required</small>
 </div>)}</div>;
 return <main className="wrap pageDestinations"><h1>Africa Destinations</h1>
 <p>Sky Cars primarily highlights right-driving markets compatible with typical LHD China-market vehicles. Shipping availability, import eligibility, route, price and transit time are confirmed per quote.</p>
 <h2>Priority LHD Markets</h2><Cards items={priority}/><h2>Other African Markets</h2>
 <p>Kept in the system for enquiries, but steering/import requirements must be checked.</p><Cards items={other}/></main>
}