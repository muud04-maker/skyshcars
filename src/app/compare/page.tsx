import type {Metadata} from 'next';
import {CompareTable} from '../../components/MarketplaceTools';

export const metadata:Metadata={title:'Compare Vehicles | Sky Cars',description:'Compare up to four saved Sky Cars vehicles side by side by price, year, fuel, transmission, mileage and stock number.'};

export default function Compare(){
  return <main className="wrap comparePage theme-compare">
    <div className="compareHero">
      <span className="eyebrow">SHOPPING TOOLS</span>
      <h1>Compare vehicles</h1>
      <p className="lead">Compare up to four saved vehicles side by side before requesting a quote. Only details stored with each listing are shown; missing values remain blank.</p>
    </div>
    <CompareTable/>
  </main>;
}
