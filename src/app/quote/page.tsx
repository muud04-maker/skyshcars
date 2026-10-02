import QuoteForm from './QuoteForm';
import {auth} from '../../auth';
export const dynamic='force-dynamic';
export default async function Quote(){const session=await auth();return <main className="wrap pageQuote"><span className="eyebrow">CONFIRMED QUOTE</span><h1>Request a Quote</h1><p className="lead">Choose the vehicle and destination. Port and recommended shipping method are filled from the Sky Cars Africa reference routes. Your name and WhatsApp stay blank for you to enter. Email is optional.</p><QuoteForm initialEmail={session?.user?.email||''}/></main>}
