import {vehicleTitle,vehicleWhatsAppLink} from '../lib/site';
import {FavoriteButton,CompareButton} from './MarketplaceTools';

function specsOf(v:any){if(!v?.specs)return{};if(typeof v.specs==='object')return v.specs;try{return JSON.parse(v.specs)}catch{return{}}}

/*
  One public vehicle card. Available units keep their purchase actions; a SOLD unit keeps its photo,
  stock, specs and last listed price but offers "Find similar" / "Ask our team" instead of a quote, and
  carries a prominent SOLD badge so it can never read as in stock.
*/
export default function VehicleCard({v}:{v:any}){
 const title=vehicleTitle(v);
 const image=v.cover_url||null;
 const representative=v.photo_kind==='representative'||String(image||'').includes('/api/model-photo/')||String(image||'').includes('/api/representative-photo/');
 const status=String(v.status||'available');
 const sold=status==='sold';
 const statusText=sold?'Sold':status==='pending_verification'?'Check availability':status==='available'?'In stock':status.replaceAll('_',' ');
 const s=specsOf(v);
 const mileage=s.mileage_range||(v.mileage_km?Number(String(v.mileage_km).replace(/[^\d.]/g,'')||0).toLocaleString()+' km':null);
 const fuel=v.fuel_type?String(v.fuel_type).toLowerCase():null;
 const trans=v.transmission?String(v.transmission).toLowerCase():null;
 const lite={id:v.id,stock_no:v.stock_no,brand:v.brand,model:v.model,model_year:v.model_year,price_usd:v.price_usd,cover_url:image};
 const wa=vehicleWhatsAppLink(v);
 return <article className={'vehicleCard stockCard'+(sold?' isSold':'')}>
   <div className="cardMediaActions"><FavoriteButton vehicle={lite} compact/><CompareButton vehicle={lite} compact/></div>
   <a className="vehicleImageWrap" href={'/vehicles/'+v.id} aria-label={`View ${title}`}>
     {image
      ? <>
          <img className="vehiclePhoto" src={image} alt={title} loading="lazy"/>
          {representative && <span className="repPhotoTag">Representative image</span>}
          {!representative && <span className="repPhotoTag" style={{background:'#0b7a3b'}}>Exact stock photo</span>}
        </>
      : <div className="vehicleNoPhoto"><span>SKY CARS</span><strong>Photo coming soon</strong><small>Ask us for current vehicle photos</small></div>}
     {v.steering&&v.steering!=='unknown'&&<span className="steeringTag">{v.steering}</span>}
     {sold&&<span className="soldBadge" aria-label="Sold">SOLD</span>}
   </a>
   <div className="vehicleBody">
     <h3><a href={'/vehicles/'+v.id}>{title}</a></h3>
     <p className="vehicleFacts">{[mileage,fuel,trans].filter(Boolean).join(' / ')||'Specification on request'}</p>
     <div className="price">{v.price_usd?'$'+Number(v.price_usd).toLocaleString():'Price on request'}</div>
     {sold&&<small className="muted">Last listed price</small>}
     <div className="stockMeta"><span>Vehicle in China</span><i className={status==='available'?'dotOn':'dotWait'}/>{statusText}</div>
     <p className="stockNo">Stock {v.stock_no}</p>
     <div className="cardActions">
       <a className="btn small cardPrimary" href={'/vehicles/'+v.id}>View details</a>
       {sold
         ? <a className="btn small cardSecondary" href={'/vehicles?stock=available&brand='+encodeURIComponent(String(v.brand||''))}>Find similar</a>
         : <a className="btn small cardSecondary" href={'/quote?vehicle='+encodeURIComponent(String(v.id))}>Get quote</a>}
       <a className="cardWa" href={wa} target="_blank" rel="noreferrer" aria-label={sold?`Ask about a similar vehicle to ${title}`:`WhatsApp about ${title}`}><span className="waGlyph" aria-hidden="true">WA</span> WhatsApp</a>
     </div>
   </div>
 </article>;
}
