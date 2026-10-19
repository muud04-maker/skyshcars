import VehicleGrid from './VehicleGrid';
import StockFilter from './StockFilter';
import CatalogFilters from './CatalogFilters';
import Pager,{pageOf} from './Pager';

type SP={q?:string;brand?:string;steering?:string;fuel?:string;body?:string;transmission?:string;engine?:string;minPrice?:string;maxPrice?:string;minYear?:string;maxYear?:string;minMileage?:string;maxMileage?:string;stock?:string;sort?:string;page?:string};
type CatalogTheme='vehicles'|'cars'|'motorcycles'|'electric';

const COPY:Record<string,string>={
  Vehicles:'Browse available cars and motorcycles from China. Filter by budget, body style, steering and fuel, then request exact photos and a shipping quote.',
  Cars:'Cars, SUVs, pickups and vans from the current Sky Cars inventory.',
  Motorcycles:'Sport, touring and commuter motorcycles from the current Sky Cars inventory.',
  'Electric & Hybrid':'Battery-electric and hybrid vehicles from the current Sky Cars inventory. Specifications are shown only where the record provides them.',
};

const HERO:Record<CatalogTheme,{eyebrow:string;chips:[string,Record<string,string>?][]}>={
  vehicles:{eyebrow:'SKY CARS INVENTORY',chips:[['Toyota',{brand:'Toyota'}],['SUVs',{body:'SUV'}],['Under $10,000',{maxPrice:'10000'}],['Electric',{fuel:'electric'}]]},
  cars:{eyebrow:'CAR MARKETPLACE',chips:[['SUVs',{body:'SUV'}],['Pickups',{body:'pickup'}],['Sedans',{body:'sedan'}],['Under $10,000',{maxPrice:'10000'}]]},
  motorcycles:{eyebrow:'MOTORCYCLE MARKETPLACE',chips:[['Under $5,000',{maxPrice:'5000'}],['Sport bikes',{q:'sport'}],['Commuters',{q:'commuter'}],['All motorcycles']]},
  electric:{eyebrow:'ELECTRIC & HYBRID',chips:[['Battery electric',{fuel:'electric'}],['Under $10,000',{fuel:'electric',maxPrice:'10000'}],['2022 and newer',{fuel:'electric',minYear:'2022'}],['All vehicles']]},
};

const FILTER_LABELS:Record<string,string>={
  q:'Search',brand:'Brand',body:'Body',fuel:'Fuel',steering:'Steering',transmission:'Transmission',engine:'Engine',
  minPrice:'Min price',maxPrice:'Max price',minYear:'From year',maxYear:'To year',minMileage:'Min mileage',maxMileage:'Max mileage',
};
const COUNT_LABEL:Record<CatalogTheme,string>={
  vehicles:'All inventory',
  cars:'Car inventory',
  motorcycles:'Motorcycle inventory',
  electric:'Electric inventory',
};

function themeHref(action:string,patch?:Record<string,string>){
  const p=new URLSearchParams(patch||{});
  return action+(p.toString()?'?'+p.toString():'');
}

export default function CatalogPage({title,action,list,options,sp,theme='vehicles'}:{title:string;action:string;list:any[];options:any;sp:SP;theme?:CatalogTheme}){
  const p=pageOf(list,sp.page,24);
  const params:any={...sp};delete params.page;
  const hero=HERO[theme];
  const active=Object.entries(sp).filter(([k,v])=>!!v&&!['page','sort','stock'].includes(k)) as [string,string][];
  const removeHref=(key:string)=>{
    const next:any={...sp};delete next.page;delete next[key];
    const p=new URLSearchParams();
    for(const [k,v] of Object.entries(next)) if(v) p.set(k,String(v));
    return action+(p.toString()?'?'+p.toString():'');
  };
  return <main className={'catalogPage theme-'+theme} data-theme={theme}>
    <section className="catalogHero"><div className="catalogHeroInner">
      <div><span className="eyebrow">{hero.eyebrow}</span><h1>{title}</h1><p>{COPY[title]||COPY.Vehicles}</p>
        <div className="catalogHeroChips">{hero.chips.map(([label,patch])=><a key={label} href={themeHref(action,patch)}>{label}</a>)}</div>
      </div>
      <div className="catalogHeroMeta"><b>{list.length.toLocaleString()}</b><span>matching vehicles</span><small>Current public inventory</small></div>
    </div></section>
    <div className="catalogShell">
      <aside className="catalogSidebar"><CatalogFilters action={action} sp={sp} options={options} theme={theme}/></aside>
      <section className="catalogResults">
        <details className="mobileFilterDrawer">
          <summary>Filters &amp; sort</summary>
          <CatalogFilters action={action} sp={sp} options={options} theme={theme}/>
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
        {active.length>0&&<div className="activeFilters" aria-label="Active filters">
          <span className="activeFiltersLabel">Active filters</span>
          {active.map(([k,v])=><a className="filterChip" key={k} href={removeHref(k)} title={`Remove ${FILTER_LABELS[k]||k}`}>
            {FILTER_LABELS[k]||k}: {k==='q'?v:String(v).replaceAll('_',' ')} <b aria-hidden="true">×</b>
          </a>)}
          <a className="filterChip clear" href={action}>Clear all</a>
        </div>}
        <div className="catalogCount"><h2>{COUNT_LABEL[theme]}</h2><b>Showing {p.items.length} of {list.length} vehicles</b></div>
        <VehicleGrid list={p.items} emptyTitle={`No matching ${title.toLowerCase()} found`}/>
        <Pager base={action} params={params} {...p}/>
      </section>
    </div>
  </main>;
}
