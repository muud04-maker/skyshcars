import { waLink } from '../lib/site';

/*
  Public trust + support strip (why Sky Cars, how buying works, talk to us).
  Rendered on public pages only (the site chrome hides it inside /admin and /lab).
*/
const POINTS: [string, string][] = [
  ['Real stock only', 'Every listing is a real unit with its own photos - no generic model photos sold as exact stock.'],
  ['Verified before you pay', 'Availability, price and shipping are confirmed by our team before any payment.'],
  ['Shipping to Africa', 'We support RORO and container shipping to African ports with export documents.'],
  ['Talk to a human', 'Message us on WhatsApp any time - a real salesperson answers, with AI help for quick questions.'],
];

export default function WhySkyCars() {
  return <section className="whySkyCars">
    <div className="whyInner">
      <div className="whyHead"><span className="eyebrow">WHY SKY CARS</span><h2>Buying from China, made simple and safe</h2></div>
      <div className="whyGrid">{POINTS.map(([title, text]) => <div className="whyCard" key={title}><b>{title}</b><p>{text}</p></div>)}</div>
      <div className="whyCta">
        <div><b>Ready to start?</b><p>Tell us the vehicle and your destination country and we will send options, photos and a total quote.</p></div>
        <div className="whyActions">
          <a className="btn" href="/vehicles">Browse vehicles</a>
          <a className="btn alt" href="/quote">Request a quote</a>
          <a className="btn dark" href={waLink('Hello Sky Cars, I would like help choosing a vehicle.')} target="_blank" rel="noreferrer">Chat on WhatsApp</a>
          <a className="miniBtn" href="/contact">Contact support</a>
        </div>
      </div>
    </div>
  </section>;
}
