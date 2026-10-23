'use client';

import {useCallback,useEffect,useRef,useState} from 'react';

export type VehiclePhotoStatus='missing'|'loading'|'loaded'|'error';

type Props={
  src?:string|null;
  alt:string;
  className?:string;
  eager?:boolean;
  fallbackTag?:'div'|'span';
  fallbackClassName?:string;
  fallbackTitle?:string;
  fallbackDetail?:string;
  compact?:boolean;
  onStatusChange?:(status:VehiclePhotoStatus)=>void;
};

/*
  One source-aware photo lifecycle for every public vehicle image.
  A request is never declared failed by elapsed time: only the current URL's
  real error event or a completed image with zero natural width becomes a fallback.
  This also handles cached images that finish before React attaches onLoad.
*/
export default function VehiclePhoto({
  src,
  alt,
  className='vehiclePhoto',
  eager=false,
  fallbackTag='div',
  fallbackClassName='',
  fallbackTitle,
  fallbackDetail,
  compact=false,
  onStatusChange,
}:Props){
  const currentSrc=src?String(src):'';
  const [state,setState]=useState<{src:string;status:VehiclePhotoStatus}>({
    src:currentSrc,
    status:currentSrc?'loading':'missing',
  });
  const imgRef=useRef<HTMLImageElement|null>(null);
  const callbackRef=useRef(onStatusChange);

  useEffect(()=>{callbackRef.current=onStatusChange},[onStatusChange]);

  const status=state.src===currentSrc?state.status:(currentSrc?'loading':'missing');

  useEffect(()=>{
    callbackRef.current?.(status);
  },[status]);

  const mark=useCallback((next:'loaded'|'error',source:string)=>{
    if(source!==currentSrc)return;
    setState(prev=>(prev.src===currentSrc&&prev.status===next?prev:{src:currentSrc,status:next}));
  },[currentSrc]);

  const inspect=useCallback(()=>{
    const img=imgRef.current;
    if(!img)return;
    const source=img.getAttribute('src')||'';
    if(source!==currentSrc)return;
    if(img.complete){
      mark(img.naturalWidth>0?'loaded':'error',source);
    }
  },[currentSrc,mark]);

  useEffect(()=>{
    setState(prev=>prev.src===currentSrc&&prev.status==='loading'?prev:{src:currentSrc,status:currentSrc?'loading':'missing'});
    if(!currentSrc)return;
    const frame=requestAnimationFrame(inspect);
    return ()=>cancelAnimationFrame(frame);
  },[currentSrc,inspect]);

  const attachImage=useCallback((node:HTMLImageElement|null)=>{
    imgRef.current=node;
    if(node)requestAnimationFrame(inspect);
  },[inspect]);

  if(!currentSrc||status==='error'){
    const missing=!currentSrc;
    const title=fallbackTitle||(compact?(missing?'No photo':'Unavailable'):(missing?'Photo on request':'Photo temporarily unavailable'));
    const detail=compact?'':(fallbackDetail||(missing
      ?'Ask our team for the latest stock photos.'
      :'The current photo did not load. Reload the page or ask our team.'));
    const Tag:any=fallbackTag;
    return <Tag
      className={'vehiclePhotoFallback '+(missing?'isMissing':'isError')+(compact?' isCompact':'')+' '+(fallbackClassName||'')}
      role="img"
      aria-label={`${alt}: ${title}`}
      data-photo-status={missing?'missing':'error'}
    >
      <span>SKY CARS</span>
      <strong>{title}</strong>
      {detail?<small>{detail}</small>:null}
    </Tag>;
  }

  return <img
    ref={attachImage}
    className={className}
    src={currentSrc}
    alt={alt}
    loading={eager?'eager':'lazy'}
    decoding="async"
    data-photo-status={status}
    data-photo-src={currentSrc}
    onLoad={event=>mark('loaded',event.currentTarget.getAttribute('src')||'')}
    onError={event=>mark('error',event.currentTarget.getAttribute('src')||'')}
  />;
}
