// FINAL VISUAL REPAIR: display titles + shipping precedence + card CSS guards.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const load = require('./lib.cjs');
const { vehicleDisplayTitle, collapseRepeatedPhrases } = load('display-title.js');
const { shippingChoice, DEFAULT_SHIPPING_RANGES } = load('shipping-estimate.js');

const root = path.join(__dirname, '..', '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');

test('display titles remove repeated brand/model phrases and keep meaningful trims', () => {
  assert.equal(vehicleDisplayTitle({ model_year: 2015, brand: 'Kawasaki', model: 'Z1000 ABS Kawasaki Z1000 ABS' }), '2015 Kawasaki Z1000 ABS');
  assert.equal(vehicleDisplayTitle({ model_year: 2016, brand: 'GAC', model: 'Trumpchi GS4' }), '2016 GAC Trumpchi GS4');
  assert.equal(vehicleDisplayTitle({ model_year: 2015, brand: 'Dongfeng Nissan', model: 'Nissan Sunshine' }), '2015 Dongfeng Nissan Sunshine');
  assert.equal(vehicleDisplayTitle({ model_year: 2021, brand: 'Toyota', model: 'Toyota Corolla' }), '2021 Toyota Corolla');
  assert.equal(vehicleDisplayTitle({ model_year: 2020, brand: 'Land Rover', model: 'Range Rover' }), '2020 Land Rover Range Rover');
  assert.equal(vehicleDisplayTitle({ model_year: 2023, brand: 'BMW', model: 'X5 xDrive40i' }), '2023 BMW X5 xDrive40i');
  assert.equal(vehicleDisplayTitle({ model_year: 2024, brand: 'BYD', model: 'Song Plus' }), '2024 BYD Song Plus');
  assert.equal(vehicleDisplayTitle({ model_year: 2019, brand: 'Honda', model: 'CB650R' }), '2019 Honda CB650R');
  assert.equal(collapseRepeatedPhrases('Range Rover Range Rover'), 'Range Rover');
});

test('shipping precedence: motorcycle guidance never uses car route references', () => {
  const route = { country: 'Algeria', gateway: 'Algiers', city: 'Algiers', min_usd: 3300, max_usd: 4300 };
  const moto = shippingChoice({ category: 'motorcycle', route });
  assert.equal(moto.kind, 'policy');
  assert.equal(moto.label, 'General motorcycle guidance');
  assert.equal(moto.rangeText, '$300\u2013$500');
  assert.ok(!moto.rangeText.includes('3,300'));
  assert.ok(/car route references/i.test(moto.note));
});

test('shipping precedence: a route reference is retained, labelled and flagged when above guidance', () => {
  const route = { country: 'Algeria', gateway: 'Algiers', city: 'Algiers', min_usd: 3300, max_usd: 4300 };
  const car = shippingChoice({ category: 'car', route, ranges: DEFAULT_SHIPPING_RANGES });
  assert.equal(car.kind, 'route');
  assert.equal(car.rangeText, '$3,300\u2013$4,300');
  assert.ok(/owner-supplied car route reference/i.test(car.label));
  assert.equal(car.aboveGeneralGuidance, true);
  assert.ok(car.generalGuidance.includes('$1,200\u2013$2,000'));
  assert.ok(car.generalGuidance.includes('$300\u2013$500'));
});

test('shipping precedence: no route falls back to general car policy guidance', () => {
  const car = shippingChoice({ category: 'car', ranges: { car_min: 1400, car_max: 2100, motorcycle_min: 350, motorcycle_max: 550 } });
  assert.equal(car.kind, 'policy');
  assert.equal(car.rangeText, '$1,400\u2013$2,100');
  assert.equal(car.aboveGeneralGuidance, false);
});

test('card photos own their frame and photo-state labels stay outside the image', () => {
  const css = read('src/app/design.css');
  assert.ok(/\.vehicleCard \.steeringTag[\s\S]*?left:auto;right:10px;bottom:10px;top:auto/.test(css), 'steering tag anchored to one corner');
  assert.ok(/\.vehicleCard \.soldBadge[\s\S]*?left:10px;right:auto;top:10px;bottom:auto/.test(css), 'sold badge anchored to one corner');
  assert.ok(css.includes('.vehicleCard .vehicleImageWrap img{display:block;width:100%;height:100%;object-fit:cover'), 'photo fills its own frame');
  assert.ok(css.includes('.vehiclePhotoFallback'), 'failed photos have a neutral fallback');
  assert.ok(css.includes('.photoKind'), 'photo-kind label is styled in the card body');
  const card = read('src/components/VehicleCard.tsx');
  assert.ok(card.includes('cardMetaLine') && card.includes('photoKind'), 'photo-state label lives in the card body');
  assert.ok(!card.includes('repPhotoTag'), 'no decorative photo badge is rendered over the vehicle image');
  assert.ok(!card.includes("background:'#0b7a3b'"), 'no green photo overlay remains');
  assert.ok(read('src/components/VehiclePhoto.tsx').includes('onError'), 'image failures switch to a fallback');
});

test('public pages carry distinct, scoped visual identities', () => {
  const catalog = read('src/components/CatalogPage.tsx');
  const css = read('src/app/design.css');
  assert.ok(catalog.includes("'catalogPage theme-'+theme"), 'catalogue themes are applied at page level');
  for (const theme of ['cars', 'motorcycles', 'electric', 'sold']) {
    assert.ok(css.includes(`theme-${theme}`), `${theme} theme is defined`);
  }
  assert.ok(css.includes('.catalogPage.theme-motorcycles'), 'motorcycle identity is scoped');
  assert.ok(css.includes('.theme-sold .vehicleCard'), 'sold archive card treatment is scoped');
  assert.ok(css.includes('.pageShipping') && css.includes('.pageDestinations'), 'shipping and destination identities exist');
  assert.ok(css.includes('.pageQuote') && css.includes('.theme-auth') && css.includes('.theme-compare'), 'quote, auth and compare identities exist');
  assert.ok(read('src/app/cars/page.tsx').includes('theme="cars"'), 'cars page uses the graphite theme');
  assert.ok(read('src/app/motorcycles/page.tsx').includes('theme="motorcycles"'), 'motorcycles page uses the ice-blue theme');
  assert.ok(read('src/app/vehicles/page.tsx').includes("theme={electric?'electric':'vehicles'}"), 'electric landing uses the cyan theme');
  assert.ok(read('src/app/sold-vehicles/page.tsx').includes('theme-sold'), 'sold page uses the archive theme');
});

test('public pages use the shared display formatter', () => {
  assert.ok(read('src/components/VehicleCard.tsx').includes('vehicleTitle(v)'));
  assert.ok(read('src/app/vehicles/[id]/page.tsx').includes('vehicleTitle(v)'));
  assert.ok(read('src/components/MarketplaceTools.tsx').includes('vehicleDisplayTitle(v)'));
});

test('homepage hero has a real latest-available fallback without changing New Arrivals', () => {
  const page = read('src/app/page.tsx');
  assert.ok(page.includes("getNewArrivals(12)"));
  assert.ok(page.includes("getVehicles({limit:8,onlyAvailable:true,sort:'created_desc'})"));
  assert.ok(page.includes('const hero=[...arrivals,...latest].find(exactImage)||arrivals[0]||latest[0]||null'));
  assert.ok(page.includes('No new vehicles added in the last 10 days.'));
});
