'use client';
export default function ErrorPage({ reset }: { error: Error; reset: () => void }) {
  return <main className="wrap statePage"><span className="eyebrow">TEMPORARY PROBLEM</span><h1>Something went wrong</h1><p>Please try again. If it continues, contact Sky Cars on WhatsApp and we will help right away.</p><div className="heroActions"><button className="btn" onClick={() => reset()}>Try again</button><a className="btn alt" href="/">Home</a></div></main>;
}
