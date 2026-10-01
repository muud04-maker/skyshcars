import {notFound} from 'next/navigation';
import {getVehicle,getVehicleMedia} from '../../../lib/vehicles';
import {demoImageFor,isDemoVehicle} from '../../../lib/demo-inventory';
export const dynamic='force-dynamic';
export default async function Detail({params}:{params:Promise<{id:string}>}){
 const {id}=await params;const v:any=await getVehicle(id);if(!v)notFound();
 const media=await getVehicleMedia(v.id);const fallback=demoImageFor(v);const demo=isDemoVehicle(v);
 const images=media.length?media.map((m:any)=>m.url):[fallback];
 return <main className="wrap vehicleDetailPage">
  <div className="vehicleDetailGrid">
   <section className="vehicleGallery card">
    <div className="galleryMain"><img src={images[0]} alt={`${v.brand||''} ${v.model||''}`}/>{!media.length&&<span className="referenceBadge">Photo pending</span>}</div>
    <div className="galleryThumbs">{images.slice(0,8).map((src:string,i:number)=><a href={src} target="_blank" rel="noreferrer" key={src+i}><img src={src} alt={`Vehicle photo ${i+1}`}/></a>)}</div>
    <p className="galleryHint">Click any photo to open it full size. Sky Cars aims to publish at least 3 verified photos for each live vehicle.</p>
   </section>
   <section className="card vehicleInfoPanel">
    <div className="detailTopline"><span className="badge">{String(v.status||'available').replaceAll('_',' ')}</span><span>{v.stock_no}</span></div>
    <h1>{v.model_year||''} {v.brand||''} {v.model||''}</h1>
    <div className="price">{v.price_usd?'$'+Number(v.price_usd).toLocaleString():'Price on request'}</div>
    <div className="specGrid">
      <div><small>Year</small><b>{v.model_year||'On request'}</b></div><div><small>Mileage</small><b>{v.mileage_km?Number(v.mileage_km).toLocaleString()+' km':'On request'}</b></div>
      <div><small>Transmission</small><b>{v.transmission||'On request'}</b></div><div><small>Fuel</small><b>{v.fuel_type||'On request'}</b></div>
      <div><small>Engine</small><b>{v.engine||'On request'}</b></div><div><small>Steering</small><b>{v.steering||'On request'}</b></div>
      <div><small>Color</small><b>{v.color||'On request'}</b></div><div><small>Location</small><b>{v.location||'China'}</b></div>
    </div>
    {demo&&<p className="muted">This sample record is for website testing only.</p>}
    {!demo&&media.length<3&&<p className="muted"><b>Photos:</b> more verified photos can be requested from the sales team.</p>}
    <div className="detailActions"><a className="btn" href={'/quote?vehicle='+v.id}>Get Total Quote</a><a className="btn alt" href={`https://wa.me/?text=${encodeURIComponent(`Hi Sky Cars, I am interested in ${v.stock_no} ${v.model_year||''} ${v.brand||''} ${v.model||''} - https://skyshcars.com/vehicles/${v.id}`)}`}>Ask on WhatsApp</a></div>
   </section>
  </div>
 </main>
}
