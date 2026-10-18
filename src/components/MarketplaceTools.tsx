'use client';
import {useEffect,useMemo,useState} from 'react';
import {vehicleDisplayTitle} from '../lib/display-title';

type VehicleLite={id:string|number;stock_no?:string;brand?:string;model?:string;model_year?:number;price_usd?:number;cover_url?:string|null};
const FAV='sky_favorites_v1',RECENT='sky_recent_v1',COMPARE='sky_compare_v1';
function read(key:string){try{return JSON.parse(localStorage.getItem(key)||'[]')}catch{return[]}}
function write(key:string,v:any){localStorage.setItem(key,JSON.stringify(v));window.dispatchEvent(new CustomEvent('sky-storage',{detail:{key}}))}
export function FavoriteButton({vehicle,compact=false}:{vehicle:VehicleLite;compact?:boolean}){
 const [on,setOn]=useState(false);useEffect(()=>{setOn(read(FAV).some((x:any)=>String(x.id)===String(vehicle.id)))},[vehicle.id]);
 function toggle(){const a=read(FAV);const next=on?a.filter((x:any)=>String(x.id)!==String(vehicle.id)):[vehicle,...a].slice(0,80);write(FAV,next);setOn(!on)}
 return <button className={'iconAction '+(on?'active':'')} onClick={toggle} type="button" aria-label={on?'Remove from favorites':'Add to favorites'}>{on?'♥':'♡'}{compact?'':<span>{on?'Saved':'Save'}</span>}</button>
}
export function CompareButton({vehicle,compact=false}:{vehicle:VehicleLite;compact?:boolean}){
 const [on,setOn]=useState(false);useEffect(()=>{setOn(read(COMPARE).some((x:any)=>String(x.id)===String(vehicle.id)))},[vehicle.id]);
 function toggle(){const a=read(COMPARE);let next;if(on)next=a.filter((x:any)=>String(x.id)!==String(vehicle.id));else next=[...a,vehicle].slice(-4);write(COMPARE,next);setOn(!on)}
 return <button className={'iconAction '+(on?'active':'')} onClick={toggle} type="button" aria-label={on?'Remove from compare':'Add to compare'}>⇄{compact?'':<span>{on?'Comparing':'Compare'}</span>}</button>
}
export function RecentlyViewedTracker({vehicle}:{vehicle:VehicleLite}){useEffect(()=>{const a=read(RECENT).filter((x:any)=>String(x.id)!==String(vehicle.id));write(RECENT,[vehicle,...a].slice(0,20))},[vehicle.id]);return null}
export function MiniMarketBar(){
 const [fav,setFav]=useState(0),[cmp,setCmp]=useState(0);useEffect(()=>{const sync=()=>{setFav(read(FAV).length);setCmp(read(COMPARE).length)};sync();window.addEventListener('sky-storage',sync as any);window.addEventListener('storage',sync);return()=>{window.removeEventListener('sky-storage',sync as any);window.removeEventListener('storage',sync)}},[]);
 return <div className="marketMini"><a href="/account#favorites">♡ <b>{fav}</b><span>Saved</span></a><a href="/compare">⇄ <b>{cmp}</b><span>Compare</span></a><a href="/tracking">⌖<span>Track</span></a></div>
}
export function LocalCollection({mode}:{mode:'favorites'|'recent'}){
 const key=mode==='favorites'?FAV:RECENT;const [items,setItems]=useState<any[]>([]);useEffect(()=>setItems(read(key)),[key]);
 if(!items.length)return <div className="card emptyCollection"><h3>{mode==='favorites'?'No saved vehicles yet':'No recently viewed vehicles yet'}</h3><p>Browse the marketplace and vehicles will appear here.</p><a className="btn" href="/vehicles">Browse vehicles</a></div>;
 return <div className="miniVehicleGrid">{items.map(v=><a className="miniVehicle" key={v.id} href={'/vehicles/'+v.id}>{v.cover_url?<img src={v.cover_url} alt=""/>:<div className="miniNoPhoto">SKY</div>}<div><b>{vehicleDisplayTitle(v)}</b><span>{v.price_usd?'$'+Number(v.price_usd).toLocaleString():'Price on request'}</span><small>{v.stock_no||''}</small></div></a>)}</div>
}
export function CompareTable(){
 const [items,setItems]=useState<any[]>([]);useEffect(()=>setItems(read(COMPARE)),[]);const fields=useMemo(()=>[['Price',(v:any)=>v.price_usd?'$'+Number(v.price_usd).toLocaleString():'On request'],['Year',(v:any)=>v.model_year||'—'],['Stock',(v:any)=>v.stock_no||'—']],[]);
 if(!items.length)return <div className="card emptyCollection"><h2>No vehicles selected</h2><p>Add up to four vehicles to compare them here.</p><a className="btn" href="/vehicles">Find vehicles</a></div>;
 return <div className="compareTableWrap"><table className="compareTable"><thead><tr><th>Compare</th>{items.map(v=><th key={v.id}>{v.cover_url?<img src={v.cover_url} alt=""/>:null}<a href={'/vehicles/'+v.id}>{vehicleDisplayTitle(v)}</a></th>)}</tr></thead><tbody>{fields.map(([label,fn]:any)=><tr key={label}><th>{label}</th>{items.map(v=><td key={v.id}>{fn(v)}</td>)}</tr>)}</tbody></table></div>
}
