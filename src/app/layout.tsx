import './globals.css';
import './design.css';
import './inbox.css';
import type {Metadata,Viewport} from 'next';
import {Space_Grotesk,Inter} from 'next/font/google';
import {SITE_URL,waLink} from '../lib/site';
import {MiniMarketBar} from '../components/MarketplaceTools';
import AuthStatus from '../components/AuthStatus';
import SiteChrome from '../components/SiteChrome';
import SiteNav,{PUBLIC_LINKS} from '../components/SiteNav';
import WhatsAppGroupBanner from '../components/WhatsAppGroupBanner';
import WhySkyCars from '../components/WhySkyCars';

const display=Space_Grotesk({subsets:['latin'],display:'swap',variable:'--font-space-grotesk'});
const body=Inter({subsets:['latin'],display:'swap',variable:'--font-inter'});

export const viewport:Viewport={width:'device-width',initialScale:1,themeColor:'#091827'};
export const metadata:Metadata={
  metadataBase:new URL(SITE_URL),
  title:{default:'Sky Cars & Motorcycles | Vehicle Marketplace from China',template:'%s'},
  description:'Explore verified cars and motorcycles in China, compare vehicles, estimate shipping to Africa and request a quote from Sky Cars.',
  openGraph:{type:'website',siteName:'Sky Cars & Motorcycles',title:'Sky Cars & Motorcycles | Vehicle Marketplace',description:'Cars, motorcycles, sourcing, shipping and export support from China.',url:SITE_URL},
  alternates:{canonical:SITE_URL},
};

/*
  Public chrome only. /admin and /lab render their own shells (SiteChrome), so this header/footer never
  affects the operational admin. All existing routes, auth and search behaviour are preserved.
*/
export default function RootLayout({children}:{children:React.ReactNode}){
  const before=<>
    <div className="siteTopbar"><div><span>Vehicle marketplace and export support from China</span><div><a href="/shipping">Shipping estimates</a><a href="/tracking">Track shipment</a><a href="/faq">Help</a></div></div></div>
    <header className="siteHeader">
      <div className="siteHeaderInner">
        <a className="siteLogo" href="/" aria-label="Sky Cars and Motorcycles home"><span className="siteLogoMark" aria-hidden="true">SC</span><span>SKY CARS<em>MOTORCYCLES</em></span></a>
        <form className="siteSearch" action="/vehicles" role="search">
          <input name="q" placeholder="Search brand, model or stock" aria-label="Search vehicles"/>
          <button type="submit" aria-label="Search vehicles">Search</button>
        </form>
        <div className="siteTools"><MiniMarketBar/><AuthStatus/><a href={waLink()} target="_blank" rel="noreferrer" className="siteWa">WhatsApp</a></div>
        <details className="mobileMenu">
          <summary aria-label="Open menu">Menu</summary>
          <div className="mobileMenuPanel">
            <form className="mobileSearch" action="/vehicles" role="search"><input name="q" placeholder="Search brand, model or stock" aria-label="Search vehicles"/><button type="submit">Search</button></form>
            <SiteNav mobile/><a href="/account#favorites">Saved vehicles</a><a href="/compare">Compare</a><a href="/tracking">Track shipment</a><a href={waLink('Hello Sky Cars, I would like help choosing a vehicle.')} target="_blank" rel="noreferrer">WhatsApp support</a>
          </div>
        </details>
      </div>
      <nav className="siteNav" aria-label="Main navigation"><div className="siteNavInner"><SiteNav/></div></nav>
    </header>
  </>;
  const after=<>
    <WhySkyCars/>
    <footer className="siteFooter">
      <div className="siteFooterInner">
        <div className="siteFooterBrand">
          <b>SKY CARS &amp; MOTORCYCLES</b>
          <p>Vehicle marketplace, sourcing and export support from China. We help you find the right car or motorcycle and coordinate international shipping.</p>
          <div className="footerBadges"><span>Verified stock photos</span><span>WhatsApp support</span><span>Shipping guidance</span></div>
        </div>
        <div><h4>Shop</h4><a href="/vehicles">Available vehicles</a><a href="/sold-vehicles">Sold vehicles</a><a href="/cars">Cars</a><a href="/motorcycles">Motorcycles</a><a href="/compare">Compare</a></div>
        <div><h4>Shipping</h4><a href="/shipping">Shipping estimates</a><a href="/destinations">Destinations</a><a href="/tracking">Track shipment</a><a href="/quote">Request a quote</a></div>
        <div><h4>Company</h4><a href="/about">About Sky Cars</a><a href="/contact">Contact</a><a href="/faq">FAQ</a><a href="/privacy">Privacy</a><a href="/terms">Terms</a></div>
      </div>
      <div className="siteFooterBottom"><span>&copy; {new Date().getFullYear()} Sky Cars &amp; Motorcycles. Vehicle availability and shipping must be confirmed before payment; ranges are estimates, not guaranteed quotations.</span><span><a href={waLink()} target="_blank" rel="noreferrer">WhatsApp sales</a></span></div>
    </footer>
  </>;
  return <html lang="en" className={`${display.variable} ${body.variable}`}><body><SiteChrome before={before} after={after} banner={<WhatsAppGroupBanner/>}>{children}</SiteChrome></body></html>;
}
