import VehicleGrid from './VehicleGrid';
import StockFilter from './StockFilter';
import CatalogFilters from './CatalogFilters';
import Pager,{pageOf} from './Pager';

type SP={q?:string;brand?:string;steering?:string;fuel?:string;body?:string;minPrice?:string;maxPrice?:string;minYear?:string;maxYear?:string;minMileage?:string;maxMileage?:string;stock?:string;sort?:string;page?:string};

const COPY:Record<string,string>={
  Vehicles:'Browse available cars and motorcycles from China. Filter by budget, body style, steering and fuel, then request exact photos and a shipping quote.',
  Cars:'Cars, SUVs, pickups and vans from the current Sky Cars inventory.',
  Motorcycles:'Sport, touring and commuter motorcycles from the current Sky Cars inventory.',
};

export default function CatalogPage({title,action,list,options,sp}:{title:string;action:string;list:any[];options:any;sp:SP}){
  const p=pageOf(list,sp.page,24);
  const params:any={...sp};delete params.page;
  return <main className="catalogPage">
    <section className="catalogHero"><div className="catalogHeroInner">
      <div><span className="eyebrow">SKY CARS INVENTORY</span><h1>{title}</h1><p>{COPY[title]||COPY.Vehicles}</p></div>
      <div className="catalogHeroMeta"><b>{list.length.toLocaleString()}</b><span>matching vehicles</span></div>
    </div></section>
    <div className="catalogShell">
      <aside className="catalogSidebar"><CatalogFilters action={action} sp={sp} options={options}/></aside>
      <section className="catalogResults">
        <details className="mobileFilterDrawer">
          <summary>Filters &amp; sort</summary>
          <CatalogFilters action={action} sp={sp} options={options}/>
        </details>
        <div className="catalogToolbar">
          <form className="catalogInlineSearch" action={action}>
            <input name="q" defaultValue={sp.q||''} placeholder="Search by brand, model or stock number"/>
            {Object.entries(sp).filter(([k,v])=>k!=='q'&&k!=='page'&&v).map(([k,v])=><input key={k} type="hidden" name={k} value={String(v)}/>)}
            <button type="submit">Search</button>
          </form>
          <form action={action} className="sortForm">
            {Object.entries(sp).filter(([k,v])=>k!=='sort'&&k!=='page'&&v).map(([k,v])=><input key={k} type="hidden" name={k} value={String(v)}/>)}
            <select name="sort" defaultValue={sp.sort||'newest'}><option value="newest">Newest</option><option value="price_asc">Price: low to high</option><option value="price_desc">Price: high to low</option><option value="year_desc">Year: newest</option><option value="mileage_asc">Mileage: lowest</option></select>
            <button type="submit" className="sortApply">Apply</button>
          </form>
        </div>
        <StockFilter action={action} sp={sp}/>
        <div className="catalogCount"><h2>{title}</h2><b>Showing {p.items.length} of {list.length} vehicles</b></div>
        <VehicleGrid list={p.items} emptyTitle={`No matching ${title.toLowerCase()} found`}/>
        <Pager base={action} params={params} {...p}/>
      </section>
    </div>
  </main>;
}
