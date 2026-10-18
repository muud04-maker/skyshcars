import './globals.css';
import './inbox.css';
import type {Metadata,Viewport} from 'next';
import {SITE_URL,waLink} from '../lib/site';
import {MiniMarketBar} from '../components/MarketplaceTools';
import AuthStatus from '../components/AuthStatus';
import SiteChrome from '../components/SiteChrome';
import WhatsAppGroupBanner from '../components/WhatsAppGroupBanner';
import WhySkyCars from '../components/WhySkyCars';
export const viewport:Viewport={width:'device-width',initialScale:1,themeColor:'#07182a'};
export const metadata:Metadata={metadataBase:new URL(SITE_URL),title:{default:'Sky Cars & Motorcycles | Vehicle Marketplace from China',template:'%s'},description:'Browse real vehicle inventory, compare cars, estimate China-to-Africa shipping, request quotes and get export support.',openGraph:{type:'website',siteName:'Sky Cars & Motorcycles',title:'Sky Cars & Motorcycles | Vehicle Marketplace',description:'Cars, motorcycles, sourcing, shipping and export support from China.',url:SITE_URL},alternates:{canonical:SITE_URL}};
export default function RootLayout({children}:{children:React.ReactNode}){
 const before=<><div className="topMarketBar"><span>Vehicle marketplace from China</span><div><a href="/shipping">Shipping estimates</a><a href="/tracking">Track shipment</a><a href="/faq">Help</a></div></div><header><a className="logo" href="/"><span>SKY</span> CARS <em>& MOTORCYCLES</em></a><form className="headerSearch" action="/vehicles" role="search"><input name="q" placeholder="Search Toyota, BYD, SUV, stock number…" aria-label="Search vehicles"/><button aria-label="Search">Search</button></form><div className="headerTools"><MiniMarketBar/><AuthStatus/></div><nav className="nav"><a href="/vehicles">All Vehicles</a><a href="/sold-vehicles">Sold Vehicles</a><a href="/cars">Cars</a><a href="/motorcycles">Motorcycles</a><a href="/vehicles?fuel=electric">EV</a><a href="/shipping">Shipping</a><a href="/destinations">Destinations</a><a href="/quote">Get Quote</a><a href="/account">My Sky Cars</a></nav></header></>;
 const after=<><a className="whatsapp" href={waLink()} target="_blank" rel="noreferrer">WhatsApp Sales</a><footer><div className="footerBrand"><b>Sky Cars & Motorcycles</b><p>Vehicle marketplace, sourcing and export support from China.</p></div><div><b>Shop</b><a href="/vehicles">All vehicles</a><a href="/sold-vehicles">Sold vehicles</a><a href="/cars">Cars</a><a href="/motorcycles">Motorcycles</a><a href="/compare">Compare</a></div><div><b>Shipping</b><a href="/shipping">Estimate shipping</a><a href="/destinations">Destinations</a><a href="/tracking">Tracking</a></div><div><b>Support</b><a href="/about">About</a><a href="/contact">Contact</a><a href="/faq">FAQ</a><a href="/privacy">Privacy</a><a href="/terms">Terms</a></div><small>© {new Date().getFullYear()} Sky Cars & Motorcycles. Vehicle and shipping availability must be confirmed before payment. Reference shipping ranges are estimates, not guaranteed freight quotations.</small></footer></>;
 return <html lang="en"><body><SiteChrome before={before} after={<><WhySkyCars/>{after}</>} banner={<WhatsAppGroupBanner/>}>{children}</SiteChrome></body></html>;
}
