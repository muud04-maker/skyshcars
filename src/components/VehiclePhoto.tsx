'use client';

import {useEffect,useState} from 'react';

/*
  A listing photo always owns its own frame. If the URL fails, this renders a neutral
  Sky Cars fallback in place of the image - never an overlay on top of a different photo.
*/
export default function VehiclePhoto({
  src,
  alt,
  className='vehiclePhoto',
  eager=false,
}:{src?:string|null;alt:string;className?:string;eager?:boolean}){
  const [failed,setFailed]=useState(false);
  const [loaded,setLoaded]=useState(false);

  useEffect(()=>{
    if(!src||loaded) return;
    // A slow or broken upstream photo must not leave an empty frame forever.
    const timer=setTimeout(()=>setFailed(true),6500);
    return ()=>clearTimeout(timer);
  },[src,loaded]);

  if(!src||failed){
    return <div className={'vehiclePhotoFallback '+(className||'')} role="img" aria-label={`${alt} photo unavailable`}>
      <span>SKY CARS</span>
      <strong>Photo on request</strong>
      <small>Ask our team for the latest stock photos</small>
    </div>;
  }

  return <img
    className={className}
    src={src}
    alt={alt}
    loading={eager?'eager':'lazy'}
    decoding="async"
    onLoad={()=>setLoaded(true)}
    onError={()=>setFailed(true)}
  />;
}
