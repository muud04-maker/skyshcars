import VehicleCard from './VehicleCard';
export default function VehicleGrid({ list, emptyTitle }: { list: any[]; emptyTitle?: string }) {
  if (!list.length) return (
    <div className="card emptyCollection emptyGrid">
      <h3>{emptyTitle || 'No vehicles listed right now'}</h3>
      <p>Our sales team can source the vehicle you need. <a href="/quote">Send us a request</a>.</p>
      <div className="emptyActions"><a className="btn" href="/vehicles">Browse all vehicles</a><a className="btn alt" href="/quote">Request sourcing</a></div>
    </div>
  );
  return <div className="grid">{list.map(v => <VehicleCard v={v} key={v.id} />)}</div>;
}
