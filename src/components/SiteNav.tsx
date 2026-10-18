'use client';
import {usePathname} from 'next/navigation';

/*
  Public navigation (one source of truth for the desktop bar and the mobile menu). Marks the current
  section; routes and query behaviour are unchanged.
*/
export const PUBLIC_LINKS: [string,string][] = [
  ['/vehicles','All Vehicles'],
  ['/cars','Cars'],
  ['/motorcycles','Motorcycles'],
  ['/sold-vehicles','Sold Vehicles'],
  ['/vehicles?fuel=electric','Electric'],
  ['/shipping','Shipping'],
  ['/destinations','Destinations'],
  ['/quote','Get Quote'],
  ['/account','My Sky Cars'],
];

export default function SiteNav({mobile=false}:{mobile?:boolean}){
  const path=usePathname()||'/';
  const isActive=(href:string)=>{
    const base=href.split('?')[0];
    if(base==='/') return path==='/';
    if(base==='/vehicles') return path==='/vehicles';
    return path===base||path.startsWith(base+'/');
  };
  return <>{PUBLIC_LINKS.map(([href,label])=><a key={href} href={href} className={isActive(href)?'isActive':''} aria-current={isActive(href)?'page':undefined}>{label}</a>)}</>;
}