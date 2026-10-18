// SOLD VEHICLES + "SEND THIS VEHICLE TO WHATSAPP" (brief sections 1-9).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const load = require('./lib.cjs');
const { vehicleWhatsAppMessage, vehicleWhatsAppLink, canonicalVehicleUrl, vehicleSeoMetadata, vehicleOgDescription, vehicleTitle } = load('site.js');
const { publicStatusCondition } = load('bulk-vehicles.js');
const { soldVehicleReply } = load('ai-rules/vehicle-answer.js');

const root = path.join(__dirname, '..', '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');

const AVAILABLE = { id: 42, stock_no: '873', brand: 'GAC', model: 'Trumpchi GS4', model_year: 2016, price_usd: 3167, status: 'available' };
const SOLD = { id: 43, stock_no: '859', brand: 'Honda', model: 'CBR1000', model_year: 2011, price_usd: 3214, status: 'sold' };

test('available vehicle message: exact stock, listed price, status, canonical link', () => {
  const msg = vehicleWhatsAppMessage(AVAILABLE);
  assert.ok(msg.includes("I'm interested in this vehicle"), 'available wording');
  assert.ok(msg.includes('Vehicle: 2016 GAC Trumpchi GS4'));
  assert.ok(msg.includes('Stock number: 873'));
  assert.ok(msg.includes('Listed price: $3,167'));
  assert.ok(msg.includes('Status: Available'));
  assert.ok(msg.includes('Vehicle link: https://skyshcars.com/vehicles/42'), 'canonical absolute URL');
  assert.ok(msg.includes('exact vehicle'), 'asks about the exact unit');
  assert.ok(!/SOLD/i.test(msg), 'an available unit is never called sold');
});

test('sold vehicle message: different wording, last listed price, never an offer', () => {
  const msg = vehicleWhatsAppMessage(SOLD);
  assert.ok(msg.includes('I saw this vehicle on your website'), 'sold wording');
  assert.ok(msg.includes('Status: SOLD'));
  assert.ok(msg.includes('Last listed price: $3,214'), 'labelled as the last price');
  assert.ok(!/Listed price:/i.test(msg.replace('Last listed price:', '')), 'not presented as a current price');
  assert.ok(msg.includes('similar vehicle'), 'asks for a similar vehicle');
  assert.ok(!/available for purchase/i.test(msg));
  const noPrice = vehicleWhatsAppMessage({ ...SOLD, price_usd: null });
  assert.ok(!/price/i.test(noPrice), 'no invented price when the record has none');
});

test('link is wa.me with an encoded message and no credentials', () => {
  const link = vehicleWhatsAppLink(AVAILABLE);
  assert.ok(/^https:\/\/wa\.me\/\d{6,15}\?text=/.test(link), link.slice(0, 40));
  assert.ok(!/=/.test(link.split('?text=')[0].slice('https://wa.me/'.length)), 'number only in the path');
  const text = decodeURIComponent(link.split('?text=')[1]);
  assert.equal(text, vehicleWhatsAppMessage(AVAILABLE), 'round-trip encoding');
  assert.ok(!/access_token|api_key|Bearer/i.test(link), 'no credentials in the link');
  assert.equal(canonicalVehicleUrl(42), 'https://skyshcars.com/vehicles/42');
});

test('special characters and missing fields survive encoding', () => {
  const weird = { id: 7, stock_no: 'A&B/9', brand: 'Mercedes-Benz', model: 'Sprinter 3500 "XD"', model_year: 2020, price_usd: null, status: 'available' };
  const msg = vehicleWhatsAppMessage(weird);
  const link = vehicleWhatsAppLink(weird);
  assert.equal(decodeURIComponent(link.split('?text=')[1]), msg);
  assert.ok(link.includes('%26'), 'ampersand encoded');
  assert.ok(msg.includes('Stock number: A&B/9'));
  assert.ok(!/price/i.test(msg), 'missing price is omitted');
});

test('public status rules: sold is visible, hidden never is, pending never in all/sold', () => {
  assert.equal(publicStatusCondition('sold'), "v.status='sold'");
  assert.ok(publicStatusCondition('all').includes("'available','reserved','sold'"));
  assert.ok(!publicStatusCondition('all').includes('pending_verification'), 'All does not publish pending');
  assert.ok(!publicStatusCondition('all').includes('hidden'));
  assert.ok(!publicStatusCondition('sold').includes('hidden'));
  assert.ok(publicStatusCondition('available').includes('pending_verification'), 'existing available behaviour preserved');
});

test('AI: a named sold vehicle is answered as sold with real alternatives and no old price', () => {
  const alt = { id: 5, stock_no: 'SC-861', brand: 'Yamaha', model: 'R6', model_year: 2016, price_usd: 6100, category: 'motorcycle' };
  const reply = soldVehicleReply(SOLD, [alt], 'en');
  assert.ok(/already been sold/i.test(reply));
  assert.ok(reply.includes('Honda CBR1000'), 'names the exact unit');
  assert.ok(reply.includes('Yamaha R6'), 'offers a real alternative');
  assert.ok(!/\$3,214/.test(reply), 'never repeats the sold price as an offer');
  assert.ok(/would you like/i.test(reply), 'one next step');
  const so = soldVehicleReply(SOLD, [], 'so');
  assert.ok(/la iibiyay/i.test(so), 'localised sold wording');
  const compose = read('src/lib/sales-compose.ts');
  assert.ok(compose.includes('publicVehicleByStockOrUrl(i.words)'), 'the engine resolves the named stock/URL');
  assert.ok(compose.includes("String(namedVehicle.status) === 'sold'"), 'and branches on the real status');
  assert.ok(compose.includes('soldVehicleReply('), 'and answers with the sold reply');
});

test('UI wiring: SOLD badge, last price, similar action, prominent WhatsApp button, nav + page', () => {
  const card = read('src/components/VehicleCard.tsx');
  assert.ok(card.includes('soldBadge') && card.includes('SOLD'), 'badge on the card');
  assert.ok(card.includes('Last listed price'), 'price labelled as last listed');
  assert.ok(card.includes('Find similar'), 'sold card offers similar');
  assert.ok(card.includes('vehicleWhatsAppLink'), 'card WhatsApp uses the shared builder');
  const detail = read('src/app/vehicles/[id]/page.tsx');
  assert.ok(detail.includes('Send This Vehicle to WhatsApp'), 'prominent WhatsApp button');
  assert.ok(detail.includes('Ask About a Similar Vehicle'), 'sold detail action');
  assert.ok(detail.includes('soldNotice'), 'sold notice on the details');
  assert.ok(read('src/components/StockFilter.tsx').includes("href=\"/sold-vehicles\""), 'marketplace links to the sold page');
  assert.ok(read('src/app/sold-vehicles/page.tsx').includes('Vehicles marked Sold'), 'stats labelled honestly');
  assert.ok(read('src/app/layout.tsx').includes('/sold-vehicles'), 'public navigation contains Sold Vehicles');
});

test('metadata: absolute exact photo, sold named as sold, no representative/supplier image', () => {
  const meta = vehicleSeoMetadata(SOLD, { exactImage: '/api/photo/99' });
  assert.equal(meta.alternates.canonical, 'https://skyshcars.com/vehicles/43');
  assert.ok(meta.openGraph.images[0].url.startsWith('https://'), 'absolute HTTPS image');
  assert.ok(meta.title.includes('SOLD'), 'title marks sold');
  assert.ok(/marked SOLD/i.test(meta.openGraph.description));
  assert.ok(!/available from sky cars/i.test(meta.description));
  const noImage = vehicleSeoMetadata({ ...SOLD, exact_cover_url: 'https://supplier.example/private.jpg' }, { exactImage: null });
  assert.equal(noImage.openGraph.images, undefined, 'a supplier URL is never used when no verified image is provided');
  assert.equal(vehicleOgDescription(AVAILABLE).includes('Available'), true);
  assert.equal(vehicleTitle(SOLD), '2011 Honda CBR1000');
});
