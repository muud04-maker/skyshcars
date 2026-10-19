import type {Metadata} from 'next';
import {getBusinessPolicy} from '../../lib/business-policy';

export const dynamic='force-dynamic';
export const metadata:Metadata={title:'FAQ | Sky Cars',description:'Answers about Sky Cars vehicle availability, photos, pricing, shipping estimates, quotes and shipment tracking.'};

export default async function FAQ(){
  const policy=await getBusinessPolicy();
  return <main className="wrap pageFaq theme-editorial">
    <section className="editorialHero">
      <span className="eyebrow">HELP CENTRE</span>
      <h1>Frequently asked questions</h1>
      <p>Clear answers about the inventory, photos, shipping guidance and the steps that require confirmation from the Sky Cars team.</p>
    </section>
    <section className="editorialFaq">
      <details open><summary>How do I know a vehicle is available?</summary><p>Each listing shows its current inventory status. Availability, price and shipping are confirmed by our team before payment. A listing marked Sold is an archive entry and is not a current offer.</p><div className="emptyActions"><a className="btn small" href="/vehicles">Browse available vehicles</a><a className="btn small alt" href="/sold-vehicles">View sold archive</a></div></details>
      <details><summary>Are the photos exact stock-unit photos?</summary><p>Exact stock photos are labelled in the card body. Where only representative model images are available, they are labelled as representative and are not presented as photos of the exact unit. Ask our team for the latest stock-unit photos before deciding.</p></details>
      <details><summary>Is the listed price the final price?</summary><p>The listed price is the vehicle price in China. Shipping, destination charges and documents are quoted separately. A confirmed quotation is issued only after the vehicle, destination and route are checked.</p></details>
      <details><summary>How much does shipping cost?</summary><p>General planning guidance is ${policy.shipping.car_min.toLocaleString()}–${policy.shipping.car_max.toLocaleString()} for cars and ${policy.shipping.motorcycle_min.toLocaleString()}–${policy.shipping.motorcycle_max.toLocaleString()} for motorcycles, with regional variation. These are estimates, not guaranteed rates. Use the <a href="/shipping">shipping page</a> for route references and a quote request.</p></details>
      <details><summary>What happens after I request a quote?</summary><p>Our team reviews the vehicle, destination country, port or gateway and preferred shipping method. The quotation is confirmed only after the applicable charges are checked. You can <a href="/quote">start a quote request here</a>.</p></details>
      <details><summary>Can I track a shipment?</summary><p>Yes. Use the existing <a href="/tracking">shipment tracking page</a> with the reference provided by our team. Tracking information is only shown when it exists in the shipment record.</p></details>
    </section>
  </main>;
}
