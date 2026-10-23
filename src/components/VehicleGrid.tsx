import VehicleCard from './VehicleCard';

/*
  Only public card fields cross the server/client boundary. Internal timestamps,
  source and supplier/import fields never reach the browser through a card component.
*/
function publicCard(v:any){
  const raw=typeof v?.specs==='object'&&v.specs?v.specs:(()=>{try{return JSON.parse(v?.specs||'{}')}catch{return{}}})();
  const specs={
    mileage_range:raw?.mileage_range,
    engine:raw?.engine,
    range_km:raw?.range_km,
    range:raw?.range,
    driving_range:raw?.driving_range,
    body_type:raw?.body_type,
  };
  return {
    id:v?.id,stock_no:v?.stock_no,category:v?.category,brand:v?.brand,model:v?.model,trim_name:v?.trim_name,
    model_year:v?.model_year,price_usd:v?.price_usd,status:v?.status,mileage_km:v?.mileage_km,
    transmission:v?.transmission,fuel_type:v?.fuel_type,steering:v?.steering,engine:v?.engine,
    location:v?.location,cover_url:v?.cover_url,photo_kind:v?.photo_kind,specs,
  };
}

export default function VehicleGrid({ list, emptyTitle }: { list: any[]; emptyTitle?: string }) {
  if (!list.length) return (
    <div className="card emptyCollection emptyGrid">
      <h3>{emptyTitle || 'No vehicles listed right now'}</h3>
      <p>Our sales team can source the vehicle you need. <a href="/quote">Send us a request</a>.</p>
      <div className="emptyActions"><a className="btn" href="/vehicles">Browse all vehicles</a><a className="btn alt" href="/quote">Request sourcing</a></div>
    </div>
  );
  return <div className="grid">{list.map(v => <VehicleCard v={publicCard(v)} key={v.id} />)}</div>;
}
