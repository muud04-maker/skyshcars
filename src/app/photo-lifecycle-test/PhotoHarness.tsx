'use client';
import {useState} from 'react';
import VehiclePhoto from '../../components/VehiclePhoto';

const A='/demo/vehicles/car-1.webp';
const B='/demo/vehicles/moto-1.webp';

export default function PhotoHarness(){
  const [src,setSrc]=useState(A);
  return <div data-testid="photo-harness">
    <div>
      <button type="button" onClick={()=>setSrc(A)}>Show vehicle A</button>
      <button type="button" onClick={()=>setSrc(B)}>Show vehicle B</button>
    </div>
    <div style={{width:360,marginTop:16,aspectRatio:'16/10',background:'#0b1b2c'}}>
      <VehiclePhoto src={src} alt="Photo lifecycle test vehicle" eager />
    </div>
  </div>;
}
