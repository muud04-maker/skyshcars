import {
  BadgeCheck,
  Camera,
  ChevronDown,
  FileText,
  Heart,
  MapPin,
  MessageCircle,
  Package,
  Search,
  Ship,
  ShoppingCart,
  UserRound,
} from 'lucide-react';
import styles from './SkyCarsHomepage.module.css';

export type SkyVehicle = {
  id: string | number;
  title: string;
  priceUsd: number;
  imageUrl: string;
  href: string;
  summary: string;
  category: 'Cars' | 'Motorcycles';
};

export type ApprovedCustomerReview = {
  id: string | number;
  name: string;
  country: string;
  countryCode?: string;
  rating: number;
  text: string;
  portraitUrl: string;
};

export type SkyCollection = { title: string; href: string; link: string; items: SkyVehicle[] };

export type SkyCarsHomepageProps = {
  vehicles: SkyVehicle[];
  /** Amazon-style cards: 2x2 real photos per collection (built from available inventory only). */
  collections?: SkyCollection[];
  reviews?: ApprovedCustomerReview[];
  heroImageUrl?: string;
  heroVehicleTitle?: string;
  shippingImageUrl?: string;
  whatsappUrl: string;
  whatsappNumber: string;
  urls?: Partial<Record<'account' | 'saved' | 'cart' | 'shipping' | 'quote' | 'faq' | 'about' | 'inventory' | 'tracking' | 'contact', string>>;
};

const money = (value: number) => new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  maximumFractionDigits: 0,
}).format(value);

const logo = <span className={styles.logo}>
  <span className={styles.logoMark} aria-hidden="true"><i /><i /></span>
  <span className={styles.logoWords}><strong>SKY CARS</strong><small>MOTORCYCLES</small></span>
</span>;

function VehicleCard({ vehicle }: { vehicle: SkyVehicle }) {
  return <article className={styles.vehicleCard}>
    <a className={styles.vehicleImage} href={vehicle.href} aria-label={`View ${vehicle.title}`}>
      <img src={vehicle.imageUrl} alt={vehicle.title} loading="eager" decoding="async" />
    </a>
    <div className={styles.vehicleBody}>
      <h3><a href={vehicle.href}>{vehicle.title}</a></h3>
      <p>{vehicle.summary}</p>
      <strong>{money(vehicle.priceUsd)}</strong>
      <a className={styles.detailsButton} href={vehicle.href}>View Details</a>
    </div>
  </article>;
}

function CollectionCard({ c }: { c: SkyCollection }) {
  return <article className={styles.collection}>
    <h3>{c.title}</h3>
    <div className={styles.collectionGrid}>
      {c.items.slice(0, 4).map((v) => <a key={v.id} href={v.href} className={styles.collectionItem}>
        <img src={v.imageUrl} alt={v.title} loading="lazy" decoding="async" />
        <span>{v.title}</span>
        <b>{money(v.priceUsd)}</b>
      </a>)}
    </div>
    <a className={styles.collectionLink} href={c.href}>{c.link}</a>
  </article>;
}

function VehicleRow({ title, href, items }: { title: string; href: string; items: SkyVehicle[] }) {
  if (!items.length) return null;
  return <div className={styles.rowBlock}>
    <div className={styles.rowHead}><h3>{title}</h3><a href={href}>See all <span aria-hidden="true">&rarr;</span></a></div>
    <div className={styles.vehicleRow}>{items.map((vehicle) => <VehicleCard key={vehicle.id} vehicle={vehicle} />)}</div>
  </div>;
}

export default function SkyCarsHomepage({
  vehicles,
  collections = [],
  reviews = [],
  heroImageUrl,
  heroVehicleTitle = 'the current Sky Cars inventory',
  shippingImageUrl = '/home-shipping-africa.jpg',
  whatsappUrl,
  whatsappNumber,
  urls = {},
}: SkyCarsHomepageProps) {
  const accountUrl = urls.account || '/account';
  const savedUrl = urls.saved || '/account#favorites';
  const cartUrl = urls.cart || '/account#favorites';
  const shippingUrl = urls.shipping || '/shipping';
  const quoteUrl = urls.quote || '/quote';
  const faqUrl = urls.faq || '/faq';
  const aboutUrl = urls.about || '/about';
  const inventoryUrl = urls.inventory || '/vehicles';
  const trackingUrl = urls.tracking || '/tracking';
  const contactUrl = urls.contact || '/contact';
  const safeWhatsApp = /^https:\/\/(wa\.me|api\.whatsapp\.com)\//i.test(whatsappUrl) ? whatsappUrl : '#';

  return <div className={styles.site}>
    <div className={styles.headerWrap}>
      <header className={styles.header}>
        <a className={styles.homeLogo} href="/" aria-label="Sky Cars Motorcycles home">{logo}</a>
        <form className={styles.search} action={inventoryUrl} role="search">
          <select name="category" aria-label="Department" defaultValue="car" className={styles.searchDept}>
            <option value="car">Cars</option>
            <option value="motorcycle">Motorcycles</option>
          </select>
          <input name="q" aria-label="Search vehicles" placeholder="Search brand, model, year or stock number" />
          <button type="submit" aria-label="Search"><Search size={23} strokeWidth={2.2} /></button>
        </form>
        <div className={styles.actions}>
          <a href={accountUrl}><UserRound /><span>Account</span></a>
          <a href={savedUrl}><Heart /><span>Saved</span></a>
          <a href={cartUrl} aria-label="Cart and saved vehicle shortlist"><span className={styles.cartIcon}><ShoppingCart /><b>0</b></span><span>Cart</span></a>
          <a className={styles.whatsapp} href={safeWhatsApp} target="_blank" rel="noopener noreferrer"><MessageCircle />WhatsApp</a>
        </div>
      </header>

      <nav className={styles.nav} aria-label="Main navigation">
        <a href="/cars">Cars <ChevronDown /></a>
        <a href="/motorcycles">Motorcycles <ChevronDown /></a>
        <a href="/vehicles?body=SUV">SUVs <ChevronDown /></a>
        <a href="/vehicles?body=pickup">Pickups <ChevronDown /></a>
        <a href={shippingUrl}>Shipping</a>
        <a href={aboutUrl}>About Us</a>
      </nav>
    </div>

    <main className={styles.main}>
      <section className={styles.hero}>
        {heroImageUrl && <img src={heroImageUrl} alt={heroVehicleTitle} fetchPriority="high" />}
        <div className={styles.heroText}>
          <h1>Buy Cars &amp; Motorcycles<br /><span>from China</span></h1>
          <p>Verified vehicles, competitive prices, and full export support to Africa and worldwide.</p>
          <div className={styles.heroButtons}>
            <a className={styles.primaryButton} href={inventoryUrl}>Browse Vehicles <span aria-hidden="true">&rarr;</span></a>
            <a className={styles.outlineButton} href={quoteUrl}>Request a Quote</a>
          </div>
        </div>
      </section>

      <section className={styles.trust} aria-label="Why buy from Sky Cars">
        <div><Camera /><span><b>Real photos</b>of the exact unit for sale</span></div>
        <div><BadgeCheck /><span><b>Clear USD prices</b>shipping quoted separately</span></div>
        <div><Ship /><span><b>Export to Africa</b>and worldwide ports</span></div>
        <a href={safeWhatsApp} target="_blank" rel="noopener noreferrer"><MessageCircle /><span><b>Ask on WhatsApp</b>photos, price and shipping</span></a>
      </section>

      {collections.length ? <section className={styles.collections} aria-label="Browse the inventory">
        {collections.slice(0, 4).map((c) => <CollectionCard key={c.title} c={c} />)}
      </section> : null}

      <section className={styles.featured}>
        <div className={styles.sectionHeading}>
          <h2>Featured Vehicles</h2>
          <a href={inventoryUrl}>View All Vehicles <span aria-hidden="true">&rarr;</span></a>
        </div>
        {vehicles.length
          ? <>
            <VehicleRow title="Motorcycles" href="/motorcycles" items={vehicles.filter((v) => v.category === 'Motorcycles')} />
            <VehicleRow title="Cars" href="/cars" items={vehicles.filter((v) => v.category === 'Cars')} />
          </>
          : <p className={styles.empty}>No available vehicles with a verified photo and selling price are currently listed.</p>}
      </section>

      <section className={styles.shipping}>
        <div className={styles.shippingImage}>
          <img src={shippingImageUrl} alt="Vehicle export containers at an international shipping port" loading="eager" />
        </div>
        <div className={styles.shippingCopy}>
          <h2>Shipping to Africa</h2>
          <p>Reliable container shipping, Ro-Ro (roll-on/roll-off), and full documentation support for a smooth import process to Africa.</p>
          <div className={styles.services}>
            <div><Package /><span>Container<br />Shipping</span></div>
            <div><Ship /><span>Ro-Ro<br />Shipping</span></div>
            <div><FileText /><span>Documentation<br />Support</span></div>
          </div>
          <a className={styles.primaryButton} href={shippingUrl}>Estimate Shipping <span aria-hidden="true">&rarr;</span></a>
        </div>
      </section>

      <section className={styles.reviews}>
        <div className={styles.sectionHeading}><h2>What Our Customers Say</h2></div>
        {reviews.length
          ? <div className={styles.reviewGrid}>{reviews.slice(0, 3).map((review) => <article className={styles.reviewCard} key={review.id}>
            <img src={review.portraitUrl} alt={`${review.name} portrait`} />
            <div>
              <div className={styles.reviewTop}><b>{review.name}</b><span aria-label={`${review.rating} out of 5 stars`}>{'★'.repeat(Math.max(0, Math.min(5, review.rating)))}</span></div>
              <small>{review.countryCode ? `${review.countryCode} ` : ''}{review.country}</small>
              <p>&ldquo;{review.text}&rdquo;</p>
            </div>
          </article>)}</div>
          : <p className={styles.reviewPending}>Verified customer reviews will appear here after approval.</p>}
      </section>
    </main>

    <footer className={styles.footer}>
      <div className={styles.footerBrand}>
        <a href="/" aria-label="Sky Cars Motorcycles home">{logo}</a>
        <p>Your trusted partner for exporting vehicles from China to Africa and worldwide.</p>
      </div>
      <div><h3>Quick Links</h3><a href="/cars">Cars</a><a href="/motorcycles">Motorcycles</a><a href="/vehicles?body=SUV">SUVs</a><a href="/vehicles?body=pickup">Pickups</a><a href={shippingUrl}>Shipping</a><a href={aboutUrl}>About Us</a></div>
      <div><h3>Customer Support</h3><a href={faqUrl}>Help &amp; FAQ</a><a href={quoteUrl}>Request a Quote</a><a href={shippingUrl}>Shipping Information</a><a href={trackingUrl}>Track Shipment</a><a href={contactUrl}>Contact Us</a></div>
      <div><h3>Contact Us</h3><a href={safeWhatsApp} target="_blank" rel="noopener noreferrer"><MessageCircle />+{whatsappNumber}</a><a href={contactUrl}><FileText />Contact form</a><span><MapPin />China export office</span></div>
      <div className={styles.footerLegal}><span>&copy; {new Date().getFullYear()} Sky Cars Motorcycles.</span><a href="/privacy">Privacy</a><a href="/terms">Terms</a></div>
    </footer>
  </div>;
}
