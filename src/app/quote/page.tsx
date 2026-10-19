import type {Metadata} from 'next';
import QuoteForm from './QuoteForm';
import {customerSession} from '../../lib/session';

export const dynamic='force-dynamic';
export const metadata:Metadata={
  title:'Request a Vehicle Quote | Sky Cars',
  description:'Request a confirmed vehicle and shipping quote from Sky Cars. Choose a listed vehicle, destination country and gateway port.',
};

export default async function Quote(){
  const session=await customerSession();
  return <main className="wrap pageQuote">
    <div className="quotePageHeader">
      <div>
        <span className="eyebrow">CONFIRMED QUOTE</span>
        <h1>Request a Quote</h1>
        <p className="lead">Choose the vehicle and destination. Port and recommended shipping method are filled from the Sky Cars Africa reference routes. Your name and WhatsApp stay blank for you to enter. Email is optional.</p>
      </div>
      <div className="quoteSteps" aria-label="Quote request steps">
        <span><b>1</b>Vehicle</span>
        <span><b>2</b>Destination</span>
        <span><b>3</b>Team review</span>
      </div>
    </div>
    <QuoteForm initialEmail={session?.user?.email||''}/>
  </main>;
}
