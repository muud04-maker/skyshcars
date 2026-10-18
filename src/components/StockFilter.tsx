/*
  Available / Sold / All stock filter for the public catalogue (brief section 5). It only changes the
  query parameter; the SQL side restricts statuses and never exposes hidden or private inventory.
*/
export default function StockFilter({action,sp}:{action:string;sp:any}){
  const link=(stock?:string)=>{const p=new URLSearchParams();for(const [k,v] of Object.entries(sp||{})){if(!v||k==='page'||k==='stock')continue;p.set(k,String(v));}if(stock)p.set('stock',stock);const q=p.toString();return action+(q?'?'+q:'');};
  const cur=String(sp?.stock||'available');
  const cls=(s:string)=>'btn small'+(cur===s?'':' alt');
  return <div className="stockFilterBar" role="group" aria-label="Stock filter">
    <a className={cls('available')} href={link(undefined)}>Available</a>
    <a className={cls('sold')} href={link('sold')}>Sold</a>
    <a className={cls('all')} href={link('all')}>All</a>
    <a className="btn small alt" href="/sold-vehicles">Sold vehicles showcase</a>
  </div>;
}