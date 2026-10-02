import {getVehicles,getVehicleFilterOptions} from '../../lib/vehicles';
import CatalogPage from '../../components/CatalogPage';
export const dynamic='force-dynamic';
export const metadata={title:'Motorcycles for Sale from China | Sky Cars',description:'Motorcycles sourced from China with export support from Sky Cars.'};
type SP={q?:string;brand?:string;steering?:string;fuel?:string;body?:string;minPrice?:string;maxPrice?:string;minYear?:string;maxYear?:string;minMileage?:string;maxMileage?:string;stock?:string;sort?:string;page?:string};
export default async function Page({searchParams}:{searchParams:Promise<SP>}){
 const sp=await searchParams;
 const q={category:'motorcycle',search:sp.q||'',brand:sp.brand||'',steering:sp.steering||'',fuel:sp.fuel||'',bodyType:sp.body||'',minPrice:sp.minPrice?Number(sp.minPrice):undefined,maxPrice:sp.maxPrice?Number(sp.maxPrice):undefined,minYear:sp.minYear?Number(sp.minYear):undefined,maxYear:sp.maxYear?Number(sp.maxYear):undefined,minMileage:sp.minMileage?Number(sp.minMileage):undefined,maxMileage:sp.maxMileage?Number(sp.maxMileage):undefined,stock:sp.stock||'',sort:sp.sort||'newest'};
 const [list,options]=await Promise.all([getVehicles(q),getVehicleFilterOptions('motorcycle')]);
 if(!list.length)return <main className="wrap motorcyclePublicEmpty"><h1>Motorcycles</h1><p>Our motorcycle stock is being updated.</p><p>Tell us the brand, model and budget you need and our team will source options for you from China.</p><div className="emptyActions"><a className="btn" href="/quote">Request a motorcycle</a><a className="btn alt" href="/contact">Contact Sky Cars</a></div></main>;
 return <CatalogPage title="Motorcycles" action="/motorcycles" list={list} options={options} sp={sp}/>;
}
