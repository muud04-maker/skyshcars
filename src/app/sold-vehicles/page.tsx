import type {Metadata} from 'next';
import {getSoldVehicles,soldStats,getVehicleFilterOptions} from '../../lib/vehicles';
import VehicleGrid from '../../components/VehicleGrid';
import Pager,{pageOf} from '../../components/Pager';
import {SITE_URL} from '../../lib/site';

/*
  Dedicated Sold Vehicles showcase. Same inventory table and public visibility rules; statistics are
  labelled "vehicles marked Sold" - inventory state, not proof of a paid sale.
*/
export const dynamic='force-dynamic';
export const metadata:Metadata={title:'Sold Vehicles | Sky Cars',description:'Previously listed Sky Cars vehicles now marked Sold. Browse them and ask our team for a similar available vehicle.',alternates:{canonical:`${SITE_URL}/sold-vehicles`},robots:{index:true,follow:true}};

type SP={q?:string;category?:string;brand?:string;minPrice?:string;maxPrice?:string;minYear?:string;maxYear?:string;sort?:string;page?:string};

export default async function SoldVehicles({searchParams}:{searchParams:Promise<SP>}){
  const sp=await searchParams;
  const category=sp.category==='motorcycle'?'motorcycle':sp.category==='car'?'car':undefined;
  const [list,stats,heroList,carOpts,motoOpts]=await Promise.all([
    getSoldVehicles({
      category, search:sp.q||'', brand:sp.brand||'', sort:sp.sort||'created_desc',
      minPrice:sp.minPrice?Number(sp.minPrice):undefined, maxPrice:sp.maxPrice?Number(sp.maxPrice):undefined,
      minYear:sp.minYear?Number(sp.minYear):undefined, maxYear:sp.maxYear?Number(sp.maxYear):undefined,
      limit:1200,
    }).catch(()=>[]),
    soldStats().catch(()=>({total:0,cars:0,motorcycles:0,recent_30d:0})),
    getSoldVehicles({limit:1,sort:'created_desc'}).catch(()=>[]),
    getVehicleFilterOptions('car').catch(()=>({brands:[]})),
    getVehicleFilterOptions('motorcycle').catch(()=>({brands:[]})),
  ]);
  const brands=[...new Set([...(carOpts?.brands||[]),...(motoOpts?.brands||[])].map((b:any)=>String(b.brand||b)).filter(Boolean))].sort();
  const p=pageOf(list,sp.page,24);
  const params:any={...sp}; delete params.page;
  const qs=(patch:any)=>{const x=new URLSearchParams();for(const [k,v] of Object.entries({...sp,...patch})) if(v) x.set(k,String(v)); return '/sold-vehicles'+(x.toString()?'?'+x.toString():'');};
  const heroImage=heroList[0]?.cover_url||'';
  return <main className="wrap soldPage theme-sold">
    <section className="soldHero" style={heroImage?{backgroundImage:`linear-gradient(100deg,rgba(9,13,17,.97),rgba(17,23,29,.86) 58%,rgba(29,26,20,.72)),url(${heroImage})`}:undefined}>
      <div className="soldHeroInner">
        <span className="eyebrow">SOLD INVENTORY</span>
        <h1>Sold Vehicles</h1>
        <p>Vehicles previously listed by Sky Cars that are now marked Sold. A Sold label is an inventory status - it is not proof of a completed or paid transaction. Ask our team for a similar available unit.</p>
        <div className="soldStats">
          <div><b>{stats.total}</b><span>Vehicles marked Sold</span></div>
          <div><b>{stats.cars}</b><span>Sold cars</span></div>
          <div><b>{stats.motorcycles}</b><span>Sold motorcycles</span></div>
          <div><b>{stats.recent_30d}</b><span>Marked Sold (last 30 days)</span></div>
        </div>
      </div>
    </section>
    <form className="soldFilter card" method="get">
      <div className="soldFilterGrid">
        <label className="wide">Search<input name="q" placeholder="Brand, model or stock number" defaultValue={sp.q||''}/></label>
        <label>Category<select name="category" defaultValue={sp.category||''}><option value="">All vehicles</option><option value="car">Cars</option><option value="motorcycle">Motorcycles</option></select></label>
        <label>Brand<select name="brand" defaultValue={sp.brand||''}><option value="">Any brand</option>{brands.map((b:string)=><option key={b} value={b}>{b}</option>)}</select></label>
        <label>From year<input name="minYear" placeholder="2011" defaultValue={sp.minYear||''}/></label>
        <label>To year<input name="maxYear" placeholder="2026" defaultValue={sp.maxYear||''}/></label>
        <label>Min price<input name="minPrice" placeholder="USD" defaultValue={sp.minPrice||''}/></label>
        <label>Max price<input name="maxPrice" placeholder="USD" defaultValue={sp.maxPrice||''}/></label>
        <label>Sort<select name="sort" defaultValue={sp.sort||'created_desc'}><option value="created_desc">Newest</option><option value="price_asc">Price: low to high</option><option value="price_desc">Price: high to low</option><option value="year_desc">Year: newest</option></select></label>
      </div>
      <div className="soldFilterActions"><button className="btn" type="submit">Apply filters</button><a className="btn alt" href={qs({category:'',brand:'',q:'',minPrice:'',maxPrice:'',minYear:'',maxYear:'',sort:''})}>Clear</a><a className="btn dark" href="/vehicles?stock=available">Browse available vehicles</a></div>
    </form>
    <section className="catalogResults">
      <div className="catalogCount"><h2>{p.items.length ? `${p.items.length} sold vehicle${p.items.length===1?'':'s'} on this page` : 'No sold vehicles match these filters'}</h2><a href="/vehicles?stock=available">See available inventory</a></div>
      <VehicleGrid list={p.items} emptyTitle="No vehicles in this archive view"/>
      <Pager base="/sold-vehicles" params={params} {...p}/>
    </section>
  </main>;
}
