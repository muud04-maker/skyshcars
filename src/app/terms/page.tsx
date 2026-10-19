import type {Metadata} from 'next';

export const metadata:Metadata={title:'Terms | Sky Cars',description:'Sky Cars terms and conditions information.'};

export default function Terms(){
  return <main className="wrap pageTerms theme-editorial">
    <section className="editorialHero"><span className="eyebrow">LEGAL</span><h1>Terms &amp; Conditions</h1><p>This page is reserved for the company-approved commercial and legal terms.</p></section>
    <article className="card legalNote"><p>Terms placeholder. Replace with the final company-approved commercial and legal terms before public launch.</p></article>
  </main>;
}
