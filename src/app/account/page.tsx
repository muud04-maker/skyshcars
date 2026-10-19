import type {Metadata} from 'next';
import {LocalCollection} from '../../components/MarketplaceTools';
import {customerSession} from '../../lib/session';
import {customerAccountsEnabled} from '../../lib/auth-providers';

export const dynamic='force-dynamic';
export const metadata:Metadata={title:'My Sky Cars | Saved Vehicles',description:'Your Sky Cars shopping workspace for saved vehicles, recently viewed listings, quotes and shipment tracking.'};

export default async function Account(){
  const session = await customerSession();
  const accounts = customerAccountsEnabled();
  return <main className="wrap accountPage theme-account">
    <div className="workspaceHero">
      <div>
        <span className="eyebrow">MY SKY CARS</span>
        <h1>{session?.user ? `Welcome${session.user.name ? `, ${session.user.name}` : ''}` : 'Your shopping workspace'}</h1>
        <p className="lead">{session?.user ? 'Your account is active. Saved vehicles and recently viewed vehicles are available below, and quote/shipment records remain handled by the Sky Cars sales system.' : accounts ? 'Create an account or sign in to unlock a smoother customer journey. Saved and recently viewed vehicles are still available in this browser even before you log in.' : 'Your saved and recently viewed vehicles are kept in this browser.'}</p>
        {!session?.user && accounts && <div className="accountLoginCta"><a className="btn" href="/login">Login</a><a className="btn alt" href="/signup">Create account</a></div>}
      </div>
      {session?.user && <div className="accountIdentity card"><div>{session.user.image?<img src={session.user.image} alt="" className="profileAvatar"/>:<span className="profileAvatar placeholder">{(session.user.name||session.user.email||'U').slice(0,1).toUpperCase()}</span>}</div><div><h2>{session.user.name||'Sky Cars customer'}</h2><p>{session.user.email}</p><small>Signed in securely to your Sky Cars account.</small></div></div>}
    </div>

    <section id="favorites" className="accountSection">
      <div className="sectionHead"><div><span className="eyebrow">SHORTLIST</span><h2>Saved vehicles</h2></div><a href="/compare">Compare saved choices →</a></div>
      <LocalCollection mode="favorites"/>
    </section>

    <section className="accountSection">
      <div className="sectionHead"><div><span className="eyebrow">RECENT ACTIVITY</span><h2>Recently viewed</h2></div><a href="/vehicles">Continue shopping →</a></div>
      <LocalCollection mode="recent"/>
    </section>

    <section className="accountSection">
      <div className="sectionHead"><div><span className="eyebrow">WORKSPACE</span><h2>Quotes, tracking and support</h2></div></div>
      <div className="grid accountActions">
        <a className="card" href="/quote"><span className="accountActionMark">Q</span><h3>Quotes</h3><p>Request a confirmed vehicle and shipping quotation.</p></a>
        <a className="card" href="/tracking"><span className="accountActionMark">T</span><h3>Track shipment</h3><p>Open the existing tracking workflow.</p></a>
        <a className="card" href="/contact"><span className="accountActionMark">S</span><h3>Customer support</h3><p>Contact Sky Cars when you need help.</p></a>
      </div>
    </section>
  </main>;
}
