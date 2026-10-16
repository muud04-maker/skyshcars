// LIVE FAILURE  |  a Facebook motorcycle ad resolved to a car of the same brand.
// Real case: "Motorcycle Honda CBR1000 2015 1000cc $4,364" was answered with
// "2015 Honda XR-V, stock 837, $5,866" because the matcher accepted brand-only evidence and
// ignored the vehicle category. These tests pin the correct behaviour.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const load = require('./lib.cjs');
const { rankReferralCandidates, referralPrice, referralStock, describeReferralVehicle, referralLooksMismatched } = load('ai-rules/referral-match.js');
const { matchVehicles, categoryHint } = load('ai-rules/match.js');
const { carTitle, dedupeText, vehicleDetails, alternatives } = load('ai-rules/vehicle-answer.js');
const { runEngine, customerKey } = load('ai-rules/engine-core.js');

const root = path.join(__dirname, '..', '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const SITE = 'https://skyshcars.com';

// ---------------------------------------------------------------- fixtures (mirror production inventory)
const MOTO = {
  cbr2011: { id: 101, stock_no: 'SC-859', brand: 'Honda', model: 'CBR1000', trim_name: '', model_year: 2011, category: 'motorcycle', price_usd: 3214, ai_enabled: 1 },
  cbr2015: { id: 102, stock_no: 'SC-860', brand: 'Honda', model: 'CBR1000', trim_name: '', model_year: 2015, category: 'motorcycle', price_usd: 4364, ai_enabled: 1 },
  r6: { id: 103, stock_no: 'SC-861', brand: 'Yamaha', model: 'R6', trim_name: '', model_year: 2016, category: 'motorcycle', price_usd: 6100, ai_enabled: 1 },
  mt09: { id: 104, stock_no: 'SC-862', brand: 'Yamaha', model: 'MT-09', trim_name: '', model_year: 2018, category: 'motorcycle', price_usd: 7200, ai_enabled: 1 },
  z1000: { id: 105, stock_no: 'SC-863', brand: 'Kawasaki', model: 'Z1000 SX', trim_name: '', model_year: 2017, category: 'motorcycle', price_usd: 8300, ai_enabled: 1 },
  cb400: { id: 106, stock_no: 'SC-864', brand: 'Honda', model: 'CB400', trim_name: '', model_year: 2013, category: 'motorcycle', price_usd: 2900, ai_enabled: 1 },
  gsxr: { id: 107, stock_no: 'SC-865', brand: 'Suzuki', model: 'GSX-R600', trim_name: '', model_year: 2014, category: 'motorcycle', price_usd: 5400, ai_enabled: 1 },
};
const CAR = {
  xrv: { id: 201, stock_no: 'SC-837', brand: 'Honda', model: 'XR-V', trim_name: '', model_year: 2015, category: 'car', price_usd: 5866, ai_enabled: 1 },
  corolla: { id: 202, stock_no: 'SC-900', brand: 'Toyota', model: 'Corolla', trim_name: '', model_year: 2022, category: 'car', price_usd: 7634, ai_enabled: 1 },
  micra: { id: 203, stock_no: 'SC-901', brand: 'Nissan', model: 'Micra', trim_name: '', model_year: 2019, category: 'car', price_usd: 4200, ai_enabled: 1 },
  qin: { id: 204, stock_no: 'SC-902', brand: 'BYD', model: 'Qin EV', trim_name: '', model_year: 2023, category: 'car', price_usd: 9900, ai_enabled: 1 },
};
const FLEET = [...Object.values(MOTO), ...Object.values(CAR)];
const AD = 'Motorcycle Honda CBR1000 2015 1000cc Price: $4,364 USD';

// ---------------------------------------------------------------- 1/2. the exact live failure
test('1. a Honda CBR1000 Facebook referral resolves to the CBR1000 motorcycle', () => {
  const d = rankReferralCandidates(AD, FLEET);
  assert.equal(d.kind, 'one');
  assert.equal(d.vehicle.model, 'CBR1000');
  assert.equal(d.vehicle.category, 'motorcycle');
  assert.equal(d.vehicle.id, MOTO.cbr2015.id, 'the 2015 unit whose price the ad quoted');
});

test('2. it NEVER resolves to a Honda XR-V (the reported production bug)', () => {
  // The full fleet (a Honda car IS enabled) must still not produce the XR-V.
  const d = rankReferralCandidates(AD, FLEET);
  assert.notEqual(d.vehicle && d.vehicle.id, CAR.xrv.id);
  // And when the catalogue only holds the Honda car (no motorcycles enabled at all) there must be
  // NO match - not a same-brand guess.
  const onlyCars = rankReferralCandidates(AD, [CAR.xrv, CAR.corolla]);
  assert.equal(onlyCars.kind, 'none');
  const viaMatcher = matchVehicles(AD, [CAR.xrv, CAR.corolla]);
  assert.notEqual(viaMatcher.kind, 'one');
  assert.notEqual(viaMatcher.vehicle && viaMatcher.vehicle.id, CAR.xrv.id);
});

test('3. a motorcycle referral can never resolve to a car candidate', () => {
  assert.equal(categoryHint(AD), 'motorcycle');
  assert.equal(rankReferralCandidates('Yamaha R6 for sale', [CAR.corolla, CAR.qin]).kind, 'none');
  assert.equal(rankReferralCandidates('Motorcycle Yamaha R6', FLEET).vehicle.category, 'motorcycle');
  // "Sky Cars & Motorcycles" in the ad copy must not flip a car ad into a motorcycle ad.
  assert.equal(categoryHint('Sky Cars & Motorcycles | 2019 Toyota Corolla, ready to ship'), 'motorcycle');
  assert.equal(rankReferralCandidates('Sky Cars & Motorcycles - 2019 Toyota Corolla $7,634', FLEET, { category: 'car' }).vehicle.category, 'car');
  // Category mismatch is also blocked in the strict matcher used for customer messages.
  assert.equal(matchVehicles('motorcycle Yamaha R6', [CAR.corolla]).kind, 'none');
});

test('4. an exact referral stock/id wins over fuzzy brand and model matching', () => {
  assert.equal(referralStock('Honda CBR1000 - stock SC-859'), 'SC00859');
  const d = rankReferralCandidates('Honda CBR1000 2015 $4,364 - stock 859', FLEET);
  assert.equal(d.kind, 'one');
  assert.equal(d.vehicle.id, MOTO.cbr2011.id, 'the exact stock the ad pointed at, not the 2015 unit');
  assert.equal(d.reason, 'stock_number');
});

test('5. the price in the ad breaks a tie between two identical models', () => {
  assert.equal(referralPrice(AD), 4364);
  const d = rankReferralCandidates('Motorcycle Honda CBR1000, price $4,364', FLEET);
  assert.equal(d.vehicle.id, MOTO.cbr2015.id);
  const noPriceNoYear = rankReferralCandidates('Motorcycle Honda CBR1000 for sale', FLEET);
  assert.equal(noPriceNoYear.kind, 'candidates');
  assert.ok(noPriceNoYear.list.length === 2, 'both CBR1000 units are offered, never a different model');
  assert.ok(noPriceNoYear.list.every((v) => v.model === 'CBR1000'));
  assert.equal(referralLooksMismatched(AD, { model: 'CBR1000', trim_name: '' }), false);
  assert.equal(referralLooksMismatched(AD, { model: 'XR-V', trim_name: '' }), true, 'the drawer warns about a wrong match');
});

test('6/7. an admin correction overrides the automatic mapping and is checked first', () => {
  // The resolver must try the saved correction BEFORE the publish log and the text match.
  const src = read('src/lib/referrals.ts');
  assert.ok(src.indexOf('FROM referral_corrections') < src.indexOf('FROM social_publish_log'), 'correction first');
  assert.ok(src.indexOf('FROM social_publish_log') < src.indexOf('rankReferralCandidates('), 'publish log before fuzzy match');
  // A correction (expressed as the exact stock) always wins, even when the text names another model.
  const corrected = rankReferralCandidates('Honda CBR1000 2015', FLEET, { stock: 'SC-864' });
  assert.equal(corrected.kind, 'one');
  assert.equal(corrected.vehicle.model, 'CB400', 'the owner decision is authoritative');
  // And the correction is applied to the chat immediately.
  assert.ok(read('src/app/api/admin/referrals/route.ts').includes('setCurrentCar(conversationId, vehicleId'), 'correction updates the current vehicle');
});

// ---------------------------------------------------------------- 6. persistence + follow-ups
const PSID = '1234567890123456'; // Messenger ids are numeric; a text id is treated as a group
const KEY = customerKey('facebook', PSID);
function makeStore(extra = {}) {
  return {
    conv: { id: 1, channel: 'facebook', external_user_id: PSID, mode: 'ai', customer_id: 10 },
    messages: [], nextId: 1, answered: 0, pausedUntil: null, lock: null, welcomes: new Set([KEY]),
    sent: [], events: [], currentCar: null, composed: [], ...extra,
  };
}
function makeDeps(s) {
  const inbound = () => s.messages.filter((m) => m.direction === 'inbound');
  return {
    sleep: async () => {}, now: () => Date.now(),
    loadConversation: async () => ({ ...s.conv }),
    tryLock: async () => { if (s.lock) return null; s.lock = 'L'; return 'L'; },
    unlock: async () => { s.lock = null; },
    getState: async () => ({ answered_through_id: s.answered, ai_paused_until: s.pausedUntil }),
    lastAnsweredOutboundId: async () => 0,
    burst: async (_i, afterId) => inbound().filter((m) => m.id > afterId).map((m) => ({ id: m.id, message_type: m.type, body: m.body, external_message_id: m.external_message_id })),
    referralIds: async (ids) => new Set(ids.filter((id) => (s.messages.find((m) => m.id === id) || {}).referral)),
    isFirstContact: async (_c, firstId) => !inbound().some((m) => m.id < firstId),
    lastOutboundBody: async () => null,
    hasNewerCustomerMessage: async (_i, afterId) => inbound().some((m) => m.id > afterId),
    markAnswered: async (_i, through) => { s.answered = Math.max(s.answered, through); },
    channelReady: () => true,
    resolveReferral: async () => ({ vehicle: MOTO.cbr2015, aiEnabled: true, method: 'headline' }),
    setCurrentCar: async (_i, vehicleId, source) => { s.currentCar = vehicleId; s.currentCarSource = source; },
    welcomeConfig: async () => ({ enabled: true, site: SITE, groupLink: 'https://chat.whatsapp.com/ABC', groupName: 'Sky second hand cars' }),
    welcomeAlreadySent: async () => true, claimWelcome: async () => false, releaseWelcome: async () => {},
    compose: async (i) => { s.composed.push(i); return { text: 'Yes - this is the 2015 Honda CBR1000.', lang: 'en', model: 'deepseek-chat', vehicleId: 102, photoPlan: null, allowedNames: ['2015 Honda CBR1000'] }; },
    sendText: async (_c, text) => { s.sent.push(text); return 'mid.out'; },
    storeOutbound: async (_i, text) => { s.messages.push({ id: s.nextId++, type: 'text', body: text, sender: 'ai', direction: 'outbound' }); },
    sendPhotos: async () => {}, flagStaff: async () => {},
    event: async (_i, _e, type, status, details) => { s.events.push([type, status, details]); },
  };
}
function inbound(s, body, referral = false) {
  const id = s.nextId++;
  s.messages.push({ id, type: 'text', body, sender: 'customer', direction: 'inbound', external_message_id: 'in.' + id, referral });
  return id;
}

test('6. the resolved referral vehicle is stored as the conversation current vehicle', async () => {
  const s = makeStore();
  inbound(s, 'Hello! Can I get more info on this?', true);
  const r = await runEngine(makeDeps(s), 1, { trigger: 'webhook' });
  assert.equal(r.status, 'sent');
  assert.equal(s.currentCar, MOTO.cbr2015.id);
  assert.equal(s.currentCarSource, 'headline');
  assert.equal(s.composed[0].referralVehicle.id, MOTO.cbr2015.id);
  assert.ok(s.events.some((e) => e[0] === 'referral_matched' && e[2].vehicle_id === MOTO.cbr2015.id));
});

test('7. "price?" and "photos?" keep using the same referred motorcycle', () => {
  const compose = read('src/lib/sales-compose.ts');
  assert.ok(compose.includes('i.referralVehicle ||'), 'the referral vehicle outranks everything else');
  assert.ok(compose.includes('aiCarById(currentId)'), 'then the stored current vehicle');
  assert.ok(compose.includes('namesAnother'), 'a clearly different brand is not answered with the current car');
  const ai = read('src/lib/ai.ts');
  assert.ok(ai.includes('currentCarFor(conversationId)') && ai.includes('refersToCurrentCar(text)'), 'follow-ups use the current car');
  assert.ok(ai.includes('whatsappPhotosForVehicle(Number(v.id), 3)'), 'exact photos of that exact stock only');
  // The details shown for the referred unit are the real ones (stock + price), and nothing else.
  const details = vehicleDetails(MOTO.cbr2015, 'en', { maxLines: 9 });
  assert.ok(details.includes('2015 Honda CBR1000'));
  assert.ok(details.includes('SC-860') && details.includes('$4,364'));
  assert.ok(!/Mileage:/.test(details) && !/Engine:/.test(details) && !/Transmission:/.test(details), 'never invents missing fields');
});

// ---------------------------------------------------------------- 8. alternatives stay in category
test('8. motorcycle alternatives are motorcycles - never a random car', () => {
  const alts = alternatives(FLEET, MOTO.cbr2015, { limit: 3 });
  assert.equal(alts.length, 3);
  assert.ok(alts.every((c) => c.category === 'motorcycle'), 'no car is ever offered for a motorcycle');
  assert.ok(!alts.some((c) => c.id === CAR.qin.id || c.id === CAR.xrv.id));
  assert.equal(alts[0].model, 'CBR1000', 'same model first');
  assert.ok(alts.some((c) => c.brand === 'Honda'), 'same brand next');
  // And a car conversation is not offered motorcycles.
  const carAlts = alternatives(FLEET, CAR.corolla, { limit: 3 });
  assert.ok(carAlts.every((c) => c.category === 'car'));
  // A unit with no category on file keeps the old behaviour (no filtering).
  assert.equal(alternatives(FLEET, { id: 999, price_usd: 5000 }, { limit: 3 }).length, 3);
});

test('9. duplicated model titles are normalised in every reply', () => {
  assert.equal(carTitle({ model_year: 2011, brand: 'Honda', model: 'CBR1000 Honda CBR1000' }), '2011 Honda CBR1000');
  assert.equal(carTitle({ model_year: 2016, brand: 'Honda', model: 'XR-V', trim_name: 'Honda XR-V' }), '2016 Honda XR-V');
  assert.equal(carTitle({ model_year: 2011, brand: 'Honda', model: 'CBR1000', trim_name: 'CBR1000' }), '2011 Honda CBR1000');
  assert.equal(dedupeText('Honda CBR1000 Honda CBR1000'), 'Honda CBR1000');
  assert.equal(carTitle(CAR.corolla), '2022 Toyota Corolla');
  const details = vehicleDetails({ ...MOTO.cbr2011, model: 'CBR1000 CBR1000' }, 'en');
  assert.ok(details.includes('2011 Honda CBR1000'));
  assert.ok(!/Honda CBR1000 Honda CBR1000/.test(details));
  assert.equal(describeReferralVehicle(MOTO.cbr2011), 'Stock SC-859 - 2011 Honda CBR1000');
});

test('10. an ambiguous referral asks ONE clarification instead of guessing', () => {
  const d = rankReferralCandidates('Motorcycle Honda CBR1000 for sale', FLEET);
  assert.equal(d.kind, 'candidates');
  assert.ok(d.list.every((v) => v.model === 'CBR1000'), 'only real candidates, never another model');
  const compose = read('src/lib/sales-compose.ts');
  assert.ok(compose.includes('clarifyVehicle(lang)'), 'the reply asks which vehicle when nothing resolves');
  assert.ok(read('src/lib/ai-rules/vehicle-answer.ts').includes('export function clarifyVehicle'), 'the question is localised');
  // A referral that names nothing we sell stays unmatched (the AI must not invent the post content).
  assert.equal(rankReferralCandidates('Motorcycle Ducati Panigale V4 2021', FLEET).kind, 'none');
  assert.equal(referralLooksMismatched('', null), true);
});
