import { waLink } from '../lib/site';

export default function VehicleCard({ v }: { v: any }) {
  const title = `${v.model_year || ''} ${v.brand || ''} ${v.model || ''}`.trim() || 'Vehicle';
  const image = v.cover_url || `/api/model-photo/${encodeURIComponent(String(v.id))}/0`;
  const status = String(v.status || 'available');
  const statusText = status === 'pending_verification' ? 'check availability' : status.replaceAll('_', ' ');
  const fuel = v.fuel_type ? String(v.fuel_type).replace(/^./, (c: string) => c.toUpperCase()) : null;
  const facts = [v.model_year, v.mileage_km ? Number(v.mileage_km).toLocaleString() + ' km' : null, fuel, v.transmission].filter(Boolean);
  const msg = `Hi Sky Cars, I am interested in ${v.stock_no} ${title}. https://skyshcars.com/vehicles/${v.id}`;
  return (
    <article className="card vehicleCard">
      <a className="vehicleImageWrap" href={'/vehicles/' + v.id} aria-label={`View ${title}`}>
        <img className="vehiclePhoto" src={image} alt={title} loading="lazy" />
      </a>
      <div className="vehicleBody">
        <span className={'badge ' + (status === 'reserved' || status === 'pending_verification' ? 'pending' : status === 'sold' ? 'sold' : '')}>{statusText}</span>
        <h3><a href={'/vehicles/' + v.id}>{title}</a></h3>
        <p className="vehicleFacts">{facts.length ? facts.join(' · ') : 'Specification on request'}</p>
        <div className="price">{v.price_usd ? '$' + Number(v.price_usd).toLocaleString() : 'Price on request'}</div>
        <p className="muted">{v.stock_no}</p>
        <div className="cardActions">
          <a className="btn small" href={'/vehicles/' + v.id}>View details</a>
          <a className="btn small alt" href={'/quote?vehicle=' + v.id}>Get quote</a>
          <a className="btn small wa" href={waLink(msg)} target="_blank" rel="noreferrer" aria-label={`WhatsApp about ${title}`}>WhatsApp</a>
        </div>
      </div>
    </article>
  );
}
