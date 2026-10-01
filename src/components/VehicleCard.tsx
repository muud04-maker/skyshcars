import {demoImageFor,isDemoVehicle} from '../lib/demo-inventory';
export default function VehicleCard({ v }: { v: any }) {
  const title = `${v.model_year || ''} ${v.brand || ''} ${v.model || ''}`.trim() || 'Vehicle';
  const image=demoImageFor(v);
  const reference=!v.cover_url;
  const sample=isDemoVehicle(v);
  return (
    <a className="card vehicleCard" href={'/vehicles/' + v.id}>
      <div className="vehicleImageWrap"><img className="vehiclePhoto" src={image} alt={title} />{reference&&<span className="referenceBadge">Reference image</span>}{sample&&<span className="sampleBadge">Sample listing</span>}</div>
      <div className="vehicleBody">
        <span className={'badge ' + (v.status === 'reserved' ? 'pending' : '')}>{String(v.status || 'available').replaceAll('_', ' ')}</span>
        <h3>{title}</h3>
        <p>{v.transmission || 'Specification on request'} · {v.mileage_km ? Number(v.mileage_km).toLocaleString() + ' km' : 'Mileage on request'}</p>
        <div className="price">{v.price_usd ? '$' + Number(v.price_usd).toLocaleString() : 'Price on request'}</div>
        <p className="muted">{v.stock_no}</p>
      </div>
    </a>
  );
}
