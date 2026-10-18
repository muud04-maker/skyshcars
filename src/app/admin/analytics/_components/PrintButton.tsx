'use client';

export default function PrintButton(){
  return <button className="btn-primary analyticsPrintButton" type="button" onClick={()=>window.print()}>Print this report / Save as PDF</button>;
}
