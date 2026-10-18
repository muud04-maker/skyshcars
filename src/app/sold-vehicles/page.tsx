import type {Metadata} from 'next';
import {getSoldVehicles,soldStats,getVehicleFilterOptions} from '../../lib/vehicles';
import VehicleGrid from '../../components/VehicleGrid';
import Pager,{pageOf} from '../../components/Pager';
import {SITE_URL} from '../../lib/site';

/*
  Dedicated Sold Vehicles showcase (brief section 3/4). Same inventory table, public visibility rules
  only. Statistics are labelled "vehicles marked Sold" - inventory state, not proof of a paid sale.
*/
export const dynamic='force-dynamic';
export const metadata:Metadata={title:'Sold Vehicles | Sky Cars',description:'Previously listed Sky Cars vehicles now marked Sold. Browse them and ask our team for a similar available vehicle.',alternates:{canonical:`${SITE_URL}/sold-vehicles`},robots:{index:true,follow:true}};

type SP={q?:string;category?:string;brand?:string;minPrice?:string;maxPrice?:string;minYear?:string;maxYear?:string;sort?:string;page?:string};

export default async function SoldVehicles({searchParams}:{searchParams:Promise<SP>}){
  const sp=await searchParams;
  const category=sp.category==='motorcycle'?'motorcycle':sp.category==='car'?'car':undefined;
  const [list,stats,carOpts,motoOpts]=await Promise.all([
    getSoldVehicles({
      category, search:sp.q||'', brand:sp.brand||'', sort:sp.sort||'',
      minPrice:sp.minPrice?Number(sp.minPrice):undefined, maxPrice:sp.maxPrice?Number(sp.maxPrice):undefined,
      minYear:sp.minYear?Number(sp.minYear):undefined, maxYear:sp.maxYear?Number(sp.maxYear):undefined,
      limit:1200,
    }).catch(()=>[]),
    soldStats().catch(()=>({total:0,cars:0,motorcycles:0,recent_30d:0})),
    getVehicleFilterOptions('car').catch(()=>({brands:[]})),
    getVehicleFilterOptions('motorcycle').catch(()=>({brands:[]})),
  ]);
  const brands=[...new Set([...(carOpts?.brands||[]),...(motoOpts?.brands||[])].map((b:any)=>String(b.brand||b)).filter(Boolean))].sort();
  const p=pageOf(list,sp.page,24);
  const params:any={...sp}; delete params.page;
  const qs=(patch:any)=>{const x=new URLSearchParams();for(const [k,v] of Object.entries({...sp,...patch})) if(v) x.set(k,String(v)); return '/sold-vehicles'+(x.toString()?'?'+x.toString():'');};
  return <main className="wrap catalogPage">
    <section className="soldHero">
      <span className="eyebrow">SOLD INVENTORY</span>
      <h1>Sold Vehicles</h1>
      <p className="muted">Vehicles previously listed by Sky Cars that are now marked Sold. A Sold label is an inventory status - it is not proof of a completed or paid transaction. Ask our team for a similar available unit.</p>
      <div className="stats" style={{marginTop:14}}>
        <div className="stat"><b>{stats.total}</b><span>Vehicles marked Sold</span></div>
        <div className="stat"><b>{stats.cars}</b><span>Sold cars</span></div>
        <div className="stat"><b>{stats.motorcycles}</b><span>Sold motorcycles</span></div>
        <div className="stat"><b>{stats.recent_30d}</b><span>Marked Sold (last 30 days)</span></div>
      </div>
    </section>
    <form className="card form" method="get" style={{marginTop:16,display:'flex',gap:8,flexWrap:'wrap',alignItems:'center'}}>
      <input name="q" placeholder="Search brand, model or stock number" defaultValue={sp.q||''} style={{flex:1,minWidth:220}}/>
      <select name="category" defaultValue={sp.category||''}><option value="">All vehicles</option><option value="car">Cars</option><option value="motorcycle">Motorcycles</option></select>
      <select name="brand" defaultValue={sp.brand||''}><option value="">Any brand</option>{brands.map((b:string)=><option key={b} value={b}>{b}</option>)}</select>
      <input name="minYear" placeholder="From year" defaultValue={sp.minYear||''} style={{maxWidth:110}}/>
      <input name="maxYear" placeholder="To year" defaultValue={sp.maxYear||''} style={{maxWidth:110}}/>
      <input name="minPrice" placeholder="Min $" defaultValue={sp.minPrice||''} style={{maxWidth:100}}/>
      <input name="maxPrice" placeholder="Max $" defaultValue={sp.maxPrice||''} style={{maxWidth:100}}/>
      <select name="sort" defaultValue={sp.sort||''}><option value="">Newest</option><option value="price_asc">Price: low to high</option><option value="price_desc">Price: high to low</option><option value="year_desc">Year: newest</option></select>
      <button className="btn" type="submit">Filter</button>
      <a className="btn alt" href={qs({category:'',brand:'',q:'',minPrice:'',maxPrice:'',minYear:'',maxYear:'',sort:''})}>Clear</a>
      <a className="btn" href="/vehicles?stock=available">Browse available vehicles</a>
    </form>
    <section className="catalogResults">
      <div className="catalogCount"><h2>{list.length} sold vehicle(s)</h2><a href="/vehicles?stock=available">See available inventory</a></div>
      <VehicleGrid list={p.items} emptyTitle="No sold vehicles match these filters"/>
      <Pager base="/sold-vehicles" params={params} {...p}/>
    </section>
  </main>;
}