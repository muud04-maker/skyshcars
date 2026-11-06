'use client';

import { useMemo, useState } from 'react';
import styles from './SkyCarsHomepage.module.css';

export type SkyVehicle = {
  id: string | number;
  title: string;
  priceUsd: number | null;
  imageUrl?: string | null;
  href: string;
  category: string;
  brand?: string;
  year?: number;
  mileageKm?: number | null;
  fuel?: string;
  transmission?: string;
  country?: string;
  available?: boolean;
};

export type SkyCategory = { label: string; href: string; imageUrl?: string | null };
export type SkyBrand = { name: string; href: string; logoUrl?: string | null };

export type SkyCarsHomepageProps = {
  vehicles: SkyVehicle[];
  categories?: SkyCategory[];
  brands?: SkyBrand[];
  heroImageUrl?: string;
  shippingImageUrl?: string;
  requestImageUrl?: string;
  whatsappUrl: string;
  urls?: Partial<Record<'account' | 'compare' | 'saved' | 'tracking' | 'cart' | 'signup' | 'shipping' | 'quote' | 'faq' | 'about' | 'inventory', string>>;
};

const categoryNames = ['Cars', 'Motorcycles', 'Electric', 'SUVs', 'Pickups', 'Vans & Buses', 'Commercial', 'Sold Vehicles'];
const filters = ['All', 'Cars', 'Motorcycles', 'Electric', 'SUVs', 'Pickups'];
const reviews = [
  { name: 'Mohamed A.', country: 'Somalia', stars: 5, skin: '#8d5524', shirt: '#1c5f8a', background: '#fde9d7', hair: '#171717', text: 'The vehicle matched the photos and description. The team kept me updated through shipping.' },
  { name: 'Hassan M.', country: 'Kenya', stars: 5, skin: '#70452b', shirt: '#27723b', background: '#e5f1e9', hair: '#111827', text: 'Professional communication and quick answers. I received clear details before making a decision.' },
  { name: 'Abdirahman S.', country: 'Somalia', stars: 5, skin: '#a66b45', shirt: '#a84c14', background: '#fff0dc', hair: '#202020', text: 'Helpful from vehicle selection through shipping. The process was straightforward and well explained.' },
];
const normalize = (value: string) => value.toLowerCase().replace(/[^a-z0-9]/g, '');
const money = (value: number | null) => value != null && Number.isFinite(value) && value > 0
  ? new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(value)
  : 'Price on request';
const mileage = (value: number | null | undefined) => value != null && Number.isFinite(Number(value))
  ? `${new Intl.NumberFormat('en-US').format(Number(value))} km`
  : null;
const catalogueCategory = (name: string) => {
  const key = normalize(name);
  if (key === 'cars') return '/cars';
  if (key === 'motorcycles') return '/motorcycles';
  if (key === 'electric') return '/vehicles?fuel=electric';
  if (key === 'suvs') return '/vehicles?body=SUV';
  if (key === 'pickups') return '/vehicles?body=pickup';
  if (key === 'vansbuses') return '/vehicles?category=van';
  if (key === 'commercial') return '/vehicles?category=truck';
  if (key === 'soldvehicles') return '/sold-vehicles';
  return '/vehicles';
};
const inventorySearchHref = (inventoryUrl: string, category: string, query: string) => {
  const params = new URLSearchParams();
  if (query.trim()) params.set('q', query.trim());
  if (category === 'Electric') params.set('fuel', 'electric');
  else if (category === 'SUVs') params.set('body', 'SUV');
  else if (category === 'Pickups') params.set('body', 'pickup');
  else if (category === 'Vans & Buses') params.set('category', 'van');
  else if (category === 'Commercial') params.set('category', 'truck');
  else if (category === 'Motorcycles') params.set('category', 'motorcycle');
  else if (category === 'Cars') params.set('category', 'car');
  const separator = inventoryUrl.includes('?') ? '&' : '?';
  return params.size ? `${inventoryUrl}${separator}${params.toString()}` : inventoryUrl;
};

function VehicleCard({ vehicle, saved, onSave }: { vehicle: SkyVehicle; saved: boolean; onSave: (id: string) => void }) {
  return <article className={styles.vehicleCard}>
    <div className={styles.vehiclePhoto}>
      <a href={vehicle.href} aria-label={`See ${vehicle.title}`}>
        {vehicle.imageUrl
          ? <img loading="lazy" src={vehicle.imageUrl} alt={vehicle.title} />
          : <div className={styles.photoFallback}>Original photo on request</div>}
      </a>
      <button type="button" className={`${styles.heart} ${saved ? styles.heartOn : ''}`} onClick={() => onSave(String(vehicle.id))} aria-label={saved ? `Remove ${vehicle.title} from saved` : `Save ${vehicle.title}`} aria-pressed={saved}>{saved ? '♥' : '♡'}</button>
    </div>
    <div className={styles.cardContent}>
      <a className={styles.vehicleTitle} href={vehicle.href}>{vehicle.title}</a>
      <p className={styles.details}>{[mileage(vehicle.mileageKm), vehicle.fuel, vehicle.transmission].filter(Boolean).join(' | ') || vehicle.category}</p>
      <div className={styles.priceLine}><b>{money(vehicle.priceUsd)}</b></div>
      <div className={styles.chips}><span className={vehicle.available === false ? styles.unavailable : styles.available}>{vehicle.available === false ? 'Unavailable' : 'Available'}</span>{vehicle.country && <span className={styles.countryChip}>{vehicle.country}</span>}</div>
      <a className={styles.detailsButton} href={vehicle.href}>View Details</a>
    </div>
  </article>;
}

export default function SkyCarsHomepage({
  vehicles, categories = [], brands = [], heroImageUrl, shippingImageUrl, requestImageUrl, whatsappUrl, urls = {},
}: SkyCarsHomepageProps) {
  const [search, setSearch] = useState('');
  const [chosenCategory, setChosenCategory] = useState('All');
  const [savedIds, setSavedIds] = useState<string[]>([]);
  const [shippingType, setShippingType] = useState('Car');
  const [destination, setDestination] = useState('Somalia');
  const [menuOpen, setMenuOpen] = useState(false);
  const [showAll, setShowAll] = useState(false);

  const inventoryUrl = urls.inventory || '/vehicles';
  const quoteUrl = urls.quote || '/quote';
  const shippingUrl = urls.shipping || '/shipping';
  const links = {
    account: urls.account || '/account',
    compare: urls.compare || '/compare',
    saved: urls.saved || '/account#favorites',
    tracking: urls.tracking || '/tracking',
    quote: quoteUrl,
    signup: urls.signup || '/signup',
    faq: urls.faq || '/faq',
    about: urls.about || '/about',
  };
  const whatsappSafe = /^https:\/\/(wa\.me|api\.whatsapp\.com)\//i.test(whatsappUrl) ? whatsappUrl : '#';
  const categoryLink = (name: string) => categories.find((item) => normalize(item.label) === normalize(name))?.href || catalogueCategory(name);
  const toggleSave = (id: string) => setSavedIds((ids) => ids.includes(id) ? ids.filter((item) => item !== id) : [...ids, id]);

  const matching = useMemo(() => vehicles.filter((vehicle) => {
    const query = search.trim().toLowerCase();
    const found = !query || [vehicle.title, vehicle.brand, vehicle.category, String(vehicle.year || ''), vehicle.id].join(' ').toLowerCase().includes(query);
    const categoryMatch = chosenCategory === 'All'
      || normalize(vehicle.category).includes(normalize(chosenCategory))
      || normalize(chosenCategory).includes(normalize(vehicle.category));
    return found && categoryMatch;
  }), [vehicles, search, chosenCategory]);
  const shown = showAll ? matching : matching.slice(0, 10);

  return <div className={styles.site}>
    <div className={styles.topbar}>
      <span>Vehicle Marketplace &amp; Export from China to Africa and Worldwide</span>
      <div><a href={links.tracking}>Track Shipment</a><a href={shippingUrl}>Shipping Estimates</a><a href={links.faq}>Help &amp; FAQ</a><a href={quoteUrl}>Export Support</a></div>
    </div>

    <header className={styles.header}>
      <a className={styles.logo} href="/" aria-label="Sky Cars home"><span className={styles.logoCar}>S</span><span><strong>SKY CARS</strong><small>MOTORCYCLES</small></span></a>
      <form className={styles.search} onSubmit={(event) => {
        event.preventDefault();
        if (search.trim() || chosenCategory !== 'All') {
          window.location.assign(inventorySearchHref(inventoryUrl, chosenCategory, search));
          return;
        }
        document.getElementById('sky-results')?.scrollIntoView({ behavior: 'smooth' });
      }}>
        <select aria-label="Search category" value={chosenCategory} onChange={(event) => setChosenCategory(event.target.value)}>
          <option>All</option>{categoryNames.map((name) => <option key={name}>{name}</option>)}
        </select>
        <input aria-label="Search vehicle inventory" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search by brand, model, year or stock number..." />
        <button type="submit" aria-label="Search">Search</button>
      </form>
      <div className={styles.headerActions}>
        <a href={links.account}>Account</a><a href={links.compare}>Compare</a><a href={links.saved}>Saved</a><a href={links.tracking}>Track</a><a href={quoteUrl}>Quote</a>
      </div>
      <div className={styles.headerButtons}><a className={styles.orangeButton} href={links.signup}>Sign Up</a><a className={styles.whatsappButton} href={whatsappSafe} target="_blank" rel="noopener noreferrer">WhatsApp</a></div>
    </header>

    <nav className={styles.nav} aria-label="Main navigation">
      <button type="button" className={styles.categoriesToggle} onClick={() => setMenuOpen((open) => !open)} aria-expanded={menuOpen}>All Categories</button>
      <div className={`${styles.navLinks} ${menuOpen ? styles.open : ''}`}>
        {categoryNames.map((name) => <a key={name} href={categoryLink(name)}>{name}</a>)}
        <a href={shippingUrl}>Shipping</a><a href={links.about}>About Us</a>
      </div>
    </nav>

    <main className={styles.main}>
      <section className={styles.hero} style={heroImageUrl ? { backgroundImage: `linear-gradient(90deg, rgba(248,245,242,.98), rgba(248,245,242,.89) 27%, rgba(248,245,242,.03) 70%), url("${heroImageUrl.replace(/["\\]/g, '')}")` } : undefined}>
        <div className={styles.heroCopy}>
          <h1>Buy Vehicles from China</h1><h2>Cars, Motorcycles &amp; EVs</h2>
          <p>Current inventory, clear vehicle prices and export support to Africa and worldwide.</p>
          <ul><li>Current available inventory</li><li>Africa and worldwide export support</li><li>Shipping and documentation assistance</li></ul>
          <div className={styles.heroButtons}><a className={styles.orangeButton} href={inventoryUrl}>Browse Vehicles</a><a className={styles.outlineButton} href={quoteUrl}>Request a Quote</a></div>
        </div>
      </section>

      <section className={styles.benefits} aria-label="Why choose Sky Cars">
        <div><span>01</span><p><b>Current Inventory</b><small>Available listings only</small></p></div>
        <div><span>02</span><p><b>Global Shipping</b><small>Africa and worldwide support</small></p></div>
        <div><span>03</span><p><b>Customer Support</b><small>Direct sales assistance</small></p></div>
        <div><span>04</span><p><b>China Sourcing</b><small>Vehicle and documentation help</small></p></div>
      </section>

      <section className={styles.section}>
        <div className={styles.sectionHeading}><h2>Shop by Category</h2><a href={inventoryUrl}>View All Categories</a></div>
        <div className={styles.categoryGrid}>{categoryNames.map((name, index) => {
          const category = categories.find((item) => normalize(item.label) === normalize(name));
          return <a className={styles.categoryCard} href={categoryLink(name)} key={name}>
            {category?.imageUrl ? <img src={category.imageUrl} alt="" loading="lazy" /> : <span className={styles.categoryPlaceholder}>{String(index + 1).padStart(2, '0')}</span>}
            <b>{name}</b>
          </a>;
        })}</div>
      </section>

      <section className={styles.section} id="sky-results">
        <div className={styles.sectionHeading}>
          <h2>Recommended for You</h2>
          <div className={styles.filters}>{filters.map((name) => <button key={name} type="button" onClick={() => { setChosenCategory(name); setShowAll(false); }} className={chosenCategory === name ? styles.filterActive : ''}>{name}</button>)}</div>
          <a href={inventoryUrl}>View More</a>
        </div>
        {matching.length
          ? <div className={styles.vehicleGrid}>{shown.map((vehicle) => <VehicleCard key={vehicle.id} vehicle={vehicle} saved={savedIds.includes(String(vehicle.id))} onSave={toggleSave} />)}</div>
          : <p className={styles.empty}>No vehicles match this search. Try another brand or category.</p>}
        {matching.length > 10 && <button className={styles.showMore} type="button" onClick={() => setShowAll((value) => !value)}>{showAll ? 'Show Less' : `Show All ${matching.length} Matches`}</button>}
      </section>

      <section className={styles.promoGrid}>
        <div className={styles.promo} style={shippingImageUrl ? { backgroundImage: `linear-gradient(90deg, #f7f4f0 5%, transparent 85%), url("${shippingImageUrl.replace(/["\\]/g, '')}")` } : undefined}><h2>Ship to Africa</h2><p>Ro-Ro, container and export support</p><a className={styles.orangeButton} href={shippingUrl}>Learn More</a></div>
        <div className={styles.promo} style={requestImageUrl ? { backgroundImage: `linear-gradient(90deg, #f7f4f0 5%, transparent 85%), url("${requestImageUrl.replace(/["\\]/g, '')}")` } : undefined}><h2>Request a Vehicle</h2><p>Tell us what you need and our team will check availability.</p><a className={styles.orangeButton} href={quoteUrl}>Request Now</a></div>
      </section>

      {brands.length > 0 && <section className={styles.section}><div className={styles.sectionHeading}><h2>Popular Brands</h2><a href={inventoryUrl}>View All Brands</a></div><div className={styles.brands}>{brands.slice(0, 10).map((brand) => <a href={brand.href} key={brand.name} title={brand.name}>{brand.name}</a>)}</div></section>}

      <section className={styles.estimate}>
        <div className={styles.estimateIntro}><span>Estimate</span><div><b>Shipping Cost</b><small>Get guidance for your destination.</small></div></div>
        <label>Vehicle Type<select value={shippingType} onChange={(event) => setShippingType(event.target.value)}><option>Car</option><option>Motorcycle</option><option>SUV</option><option>Pickup</option><option>Commercial</option></select></label>
        <label>Destination Country<input value={destination} onChange={(event) => setDestination(event.target.value)} placeholder="Destination country" /></label>
        <a className={styles.orangeButton} href={`${shippingUrl}?vehicleType=${encodeURIComponent(shippingType)}&country=${encodeURIComponent(destination)}`}>Calculate</a>
      </section>

      <section className={styles.reviewsSection}>
        <div className={styles.sectionHeading}><h2>What Our Customers Say</h2><span className={styles.reviewNote}>Sample customer feedback</span></div>
        <div className={styles.reviewsGrid}>{reviews.map((review) => <article className={styles.reviewCard} key={review.name}>
          <div className={styles.reviewAvatar} role="img" aria-label={`Sample portrait for ${review.name}`}>
            <svg viewBox="0 0 64 64" aria-hidden="true" focusable="false">
              <rect width="64" height="64" fill={review.background} />
              <path d="M8 64c2-17 12-24 24-24s22 7 24 24" fill={review.shirt} />
              <circle cx="32" cy="25" r="13" fill={review.skin} />
              <path d="M19 23c1-11 6-15 14-15 7 0 12 5 13 13-5-2-8-5-10-8-4 5-9 8-17 10z" fill={review.hair} />
            </svg>
          </div>
          <div><b>{review.name}</b><small>{review.country}</small><div className={styles.stars} aria-label={`${review.stars} out of 5 stars`}>{'★'.repeat(review.stars)}</div><p>&ldquo;{review.text}&rdquo;</p></div>
        </article>)}</div>
      </section>
    </main>

    <footer className={styles.footer}>
      <div><a className={styles.footerBrand} href="/">SKY CARS</a><p>Vehicle sourcing, export and shipping support from China to Africa and worldwide.</p></div>
      <div><b>Quick Links</b><a href={inventoryUrl}>All Vehicles</a><a href={shippingUrl}>Shipping</a><a href={links.tracking}>Track Shipment</a><a href={links.about}>About Us</a></div>
      <div><b>Customer Support</b><a href={links.faq}>Help &amp; FAQ</a><a href={quoteUrl}>Contact Us</a><a href={quoteUrl}>Request a Vehicle</a></div>
      <div><b>Business</b><a href={quoteUrl}>For Importers</a><a href={quoteUrl}>Supplier Partnership</a><a href="/terms">Terms &amp; Conditions</a></div>
      <div><b>Contact</b><a href={whatsappSafe} target="_blank" rel="noopener noreferrer">WhatsApp Sales</a><p>&copy; {new Date().getFullYear()} Sky Cars Motorcycles.</p></div>
    </footer>
  </div>;
}
