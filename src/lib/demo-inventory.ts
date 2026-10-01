export const demoMotorcycles = [
  {id:'demo-moto-1',stock_no:'DEMO-MOTO-001',category:'motorcycle',brand:'Demo',model:'Sport Motorcycle 01',model_year:null,price_usd:null,status:'available',mileage_km:null,transmission:'Manual',engine:'Demo specification',location:'China',source:'demo_generated',cover_url:'/demo/vehicles/moto-1.webp',description:'Demo/test listing only. Replace with verified real motorcycle data and real photos before selling.'},
  {id:'demo-moto-2',stock_no:'DEMO-MOTO-002',category:'motorcycle',brand:'Demo',model:'Sport Motorcycle 02',model_year:null,price_usd:null,status:'available',mileage_km:null,transmission:'Manual',engine:'Demo specification',location:'China',source:'demo_generated',cover_url:'/demo/vehicles/moto-2.webp',description:'Demo/test listing only. Replace with verified real motorcycle data and real photos before selling.'},
  {id:'demo-moto-3',stock_no:'DEMO-MOTO-003',category:'motorcycle',brand:'Demo',model:'Sport Motorcycle 03',model_year:null,price_usd:null,status:'available',mileage_km:null,transmission:'Manual',engine:'Demo specification',location:'China',source:'demo_generated',cover_url:'/demo/vehicles/moto-3.webp',description:'Demo/test listing only. Replace with verified real motorcycle data and real photos before selling.'},
  {id:'demo-moto-4',stock_no:'DEMO-MOTO-004',category:'motorcycle',brand:'Demo',model:'Adventure Motorcycle 04',model_year:null,price_usd:null,status:'available',mileage_km:null,transmission:'Manual',engine:'Demo specification',location:'China',source:'demo_generated',cover_url:'/demo/vehicles/moto-4.webp',description:'Demo/test listing only. Replace with verified real motorcycle data and real photos before selling.'},
  {id:'demo-moto-5',stock_no:'DEMO-MOTO-005',category:'motorcycle',brand:'Demo',model:'Street Motorcycle 05',model_year:null,price_usd:null,status:'available',mileage_km:null,transmission:'Manual',engine:'Demo specification',location:'China',source:'demo_generated',cover_url:'/demo/vehicles/moto-5.webp',description:'Demo/test listing only. Replace with verified real motorcycle data and real photos before selling.'},
  {id:'demo-moto-6',stock_no:'DEMO-MOTO-006',category:'motorcycle',brand:'Demo',model:'Cruiser Motorcycle 06',model_year:null,price_usd:null,status:'available',mileage_km:null,transmission:'Manual',engine:'Demo specification',location:'China',source:'demo_generated',cover_url:'/demo/vehicles/moto-6.webp',description:'Demo/test listing only. Replace with verified real motorcycle data and real photos before selling.'},
];

export function demoImageFor(v:any){
  if(v?.cover_url) return v.cover_url;
  const s=String(v?.stock_no||v?.id||'1');
  let h=0; for(const c of s) h=(h*31+c.charCodeAt(0))>>>0;
  const n=(h%24)+1;
  if(v?.category==='motorcycle') return `/demo/vehicles/moto-${n}.webp`;
  if(v?.category==='car') return `/demo/vehicles/car-${n}.webp`;
  return '/vehicle-placeholder-other.svg';
}

export function isDemoVehicle(v:any){return String(v?.source||'').startsWith('demo_') || String(v?.stock_no||'').startsWith('DEMO-')}
