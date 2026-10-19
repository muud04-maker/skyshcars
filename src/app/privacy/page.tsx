import type {Metadata} from 'next';

export const metadata:Metadata={title:'Privacy | Sky Cars',description:'Sky Cars privacy information.'};

export default function Privacy(){
  return <main className="wrap pagePrivacy theme-editorial">
    <section className="editorialHero"><span className="eyebrow">LEGAL</span><h1>Privacy</h1><p>This page is reserved for the company-approved privacy policy.</p></section>
    <article className="card legalNote"><p>Privacy policy placeholder. Replace with the final company-approved policy before public launch.</p></article>
  </main>;
}
