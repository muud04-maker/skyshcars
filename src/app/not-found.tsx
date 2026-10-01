export const metadata = { title: 'Page not found | Sky Cars' };
export default function NotFound() {
  return <main className="wrap statePage"><span className="eyebrow">ERROR 404</span><h1>We could not find that page</h1><p>The vehicle may have been sold or the link may be old. Search our current stock or ask our team.</p><div className="heroActions"><a className="btn" href="/vehicles">Browse vehicles</a><a className="btn alt" href="/quote">Request a quote</a></div></main>;
}
