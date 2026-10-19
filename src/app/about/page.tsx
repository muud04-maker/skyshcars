import type {Metadata} from 'next';

export const metadata:Metadata={title:'About Sky Cars | Vehicle Sourcing and Export',description:'Sky Cars & Motorcycles helps international customers source vehicles in China and coordinate export shipping.'};

export default function About(){
  return <main className="wrap pageAbout theme-editorial">
    <section className="editorialHero">
      <span className="eyebrow">ABOUT SKY CARS</span>
      <h1>Sourcing and export support, built around the actual vehicle.</h1>
      <p>Sky Cars &amp; Motorcycles helps international customers source cars and motorcycles in China and coordinate the shipping steps that follow. The website is the public inventory and enquiry layer; the team confirms the exact unit, route and charges before any payment.</p>
    </section>
    <div className="editorialGrid">
      <article className="card"><span className="editorialMark">01</span><h2>What we do</h2><p>We publish current vehicle listings with the specifications available in the inventory record, then help customers ask for exact photos, confirm availability and request a shipping quote for a destination.</p></article>
      <article className="card"><span className="editorialMark">02</span><h2>How we work</h2><ul className="editorialList"><li>Start from a listed vehicle or a sourcing request.</li><li>Confirm the exact unit and current availability with the team.</li><li>Agree the destination, port and shipping method.</li><li>Receive a confirmed quotation before payment.</li></ul></article>
      <article className="card"><span className="editorialMark">03</span><h2>Clear information</h2><p>Representative model photos are labelled and are never presented as exact stock-unit photos. Shipping ranges are estimates until the team confirms the route, sailing and applicable charges.</p></article>
      <article className="card"><span className="editorialMark">04</span><h2>Start with a vehicle</h2><p>Browse the marketplace, send a quote request or message the team on WhatsApp. Our team can also source a vehicle that is not currently listed.</p><div className="emptyActions"><a className="btn" href="/vehicles">Browse vehicles</a><a className="btn alt" href="/quote">Request a quote</a></div></article>
    </div>
  </main>;
}
