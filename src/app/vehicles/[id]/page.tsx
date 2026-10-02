import {notFound} from 'next/navigation';
import type {Metadata} from 'next';
import {getVehicle,getVehicleMedia,getVehicles} from '../../../lib/vehicles';
import VehicleGallery from '../../../components/VehicleGallery';
import {SITE_URL,waLink} from '../../../lib/site';
import ShippingEstimator from '../../../components/ShippingEstimator';
import VehicleGrid from '../../../components/VehicleGrid';
import {FavoriteButton,CompareButton,RecentlyViewedTracker} from '../../../components/MarketplaceTools';
export const dynamic='force-dynamic';

const titleOf=(v:any)=>`${v.model_year||''} ${v.brand||''} ${v.model||''}`.trim()||'Vehicle';

export async function generateMetadata({params}:{params:Promise<{id:string}>}):Promise<Metadata>{
 const {id}=await params;const v:any=await getVehicle(id).catch(()=>null);
 if(!v)return {title:'Vehicle not found | Sky Cars'};
 const t=titleOf(v);const price=v.price_usd?` Price $${Number(v.price_usd).toLocaleString()}.`:'';
 return {title:`${t} for sale | Sky Cars`,description:`${t} (${v.stock_no}) in ${v.location||'China'}.${price} Export support from Sky Cars.`,alternates:{canonical:`${SITE_URL}/vehicles/${v.id}`},openGraph:{title:`${t} | Sky Cars`,url:`${SITE_URL}/vehicles/${v.id}`,type:'website',images:v.cover_url?[{url:String(v.cover_url).startsWith('/')?SITE_URL+v.cover_url:v.cover_url}]:undefined}};
}

export default async function Detail({params}:{params:Promise<{id:string}>}){
 const {id}=await params;const v:any=await getVehicle(id);if(!v)notFound();
 const media=await getVehicleMedia(v.id);
 const similar=(await getVehicles({category:v.category||'car',brand:v.brand||undefined,limit:5})).filter((x:any)=>String(x.id)!==String(v.id)).slice(0,4);
 const images:string[]=media.map((m:any)=>m.url);
 const status=String(v.status||'available');const statusText=status==='pending_verification'?'check availability':status.replaceAll('_',' ');
 const title=titleOf(v);const sx=typeof v.specs==='object'&&v.specs?v.specs:(()=>{try{return JSON.parse(v.specs||'{}')}catch{return{}}})();
 const jsonLd:any={'@context':'https://schema.org','@type':'Vehicle',name:title,sku:v.stock_no,brand:v.brand?{'@type':'Brand',name:v.brand}:undefined,model:v.model||undefined,vehicleModelDate:v.model_year?String(v.model_year):undefined,mileageFromOdometer:v.mileage_km?{'@type':'QuantitativeValue',value:Number(v.mileage_km),unitCode:'KMT'}:undefined,fuelType:v.fuel_type||undefined,vehicleTransmission:v.transmission||undefined,color:v.color||undefined,url:`${SITE_URL}/vehicles/${v.id}`,image:media.length?media.slice(0,6).map((m:any)=>String(m.url).startsWith('/')?SITE_URL+m.url:m.url):undefined,offers:v.price_usd?{'@type':'Offer',price:Number(v.price_usd),priceCurrency:'USD',availability:status==='sold'?'https://schema.org/SoldOut':status==='reserved'?'https://schema.org/LimitedAvailability':'https://schema.org/InStock',url:`${SITE_URL}/vehicles/${v.id}`}:undefined};
 const lite={id:v.id,stock_no:v.stock_no,brand:v.brand,model:v.model,model_year:v.model_year,price_usd:v.price_usd,cover_url:v.cover_url};
 return <main className="wrap vehicleDetailPage"><RecentlyViewedTracker vehicle={lite}/>
  <script type="application/ld+json" dangerouslySetInnerHTML={{__html:JSON.stringify(jsonLd).replace(/</g,'\\u003c')}}/>
  <nav className="crumbs" aria-label="Breadcrumb"><a href="/">Home</a> › <a href={v.category==='motorcycle'?'/motorcycles':'/cars'}>{v.category==='motorcycle'?'Motorcycles':'Cars'}</a> › <span>{title}</span></nav>
  <div className="vehicleDetailGrid">
   <section className="vehicleGallery card">
    {images.length?<VehicleGallery images={images} alt={title}/>:<div className="detailNoPhoto"><span>SKY CARS</span><strong>Current photos available on request</strong><p>Contact us and we will send the latest vehicle photos before you decide.</p></div>}
   </section>
   <section className="card vehicleInfoPanel">
    <div className="detailTopline"><span className={'badge '+(status==='pending_verification'||status==='reserved'?'pending':status==='sold'?'sold':'')}>{statusText}</span><span>Stock No. {v.stock_no}</span></div>
    <h1>{title}</h1>
    <div className="price">{v.price_usd?'$'+Number(v.price_usd).toLocaleString():'Price on request'}</div>
    <p className="muted">Price shown is the vehicle price in China. Shipping, destination charges and documents are quoted separately.</p>
    <div className="specGrid">
      <div><small>Year</small><b>{v.model_year||'On request'}</b></div><div><small>Mileage</small><b>{sx.mileage_range|| (v.mileage_km?Number(v.mileage_km).toLocaleString()+'+ km':'On request')}</b></div>
      <div><small>Transmission</small><b>{v.transmission||'On request'}</b></div><div><small>Fuel</small><b>{v.fuel_type||'On request'}</b></div>
      <div><small>Engine</small><b>{v.engine||'On request'}</b></div><div><small>Steering</small><b>{v.steering||'On request'}</b></div>
      <div><small>Body type</small><b>{sx.body_type||'On request'}</b></div><div><small>Stock status</small><b>{sx.stock_status||statusText}</b></div><div><small>Color</small><b>{v.color||'On request'}</b></div><div><small>Location</small><b>{v.location||'China'}</b></div>
    </div>
    <div className="detailTools"><FavoriteButton vehicle={lite}/><CompareButton vehicle={lite}/></div><div className="detailActions"><a className="btn" href={'/quote?vehicle='+v.id}>Get Total Quote</a><a className="btn wa" href={waLink(`Hi Sky Cars, I am interested in ${v.stock_no} ${title} - ${SITE_URL}/vehicles/${v.id}`)} target="_blank" rel="noreferrer">Ask on WhatsApp</a></div>
   </section>
  </div>
  <ShippingEstimator vehiclePrice={v.price_usd?Number(v.price_usd):undefined}/>
  {similar.length>0&&<section className="similarVehicles"><div className="sectionHead"><div><span className="eyebrow">YOU MAY ALSO LIKE</span><h2>Similar {v.brand||''} vehicles</h2></div><a href={'/vehicles?brand='+encodeURIComponent(v.brand||'')}>See more →</a></div><VehicleGrid list={similar}/></section>}
 </main>
}
