// PART 3  |  Facebook/Meta ad & post referral.
// (A) the strict matcher must never force a wrong vehicle (failure C: "Harrier hybrid" -> Haval Raptor).
// (B) the reply engine must resolve the tapped post to the exact car, set it as the current car,
//     and log referral_matched / referral_unmatched.
const test = require('node:test');
const assert = require('node:assert/strict');
const load = require('./lib.cjs');
const { matchVehicles, isGenericOnly, normalize } = load('ai-rules/match.js');
const { runEngine, customerKey } = load('ai-rules/engine-core.js');

const FLEET = [
  { id: 1, stock_no: 'SC-1001', brand: 'Toyota', model: 'Harrier', trim_name: 'Hybrid', model_year: 2019 },
  { id: 2, stock_no: 'SC-1002', brand: 'Haval', model: 'Raptor', trim_name: '', model_year: 2023 },
  { id: 3, stock_no: 'SC-1003', brand: 'Toyota', model: 'RAV4', trim_name: '', model_year: 2011 },
  { id: 4, stock_no: 'SC-1004', brand: 'Toyota', model: 'RAV4', trim_name: '', model_year: 2015 },
  { id: 5, stock_no: 'SC-1005', brand: 'Toyota', model: 'Vios', trim_name: '', model_year: 2016 },
  { id: 6, stock_no: 'SC-1006', brand: 'FAW-Volkswagen', model: 'Tiguan', trim_name: '', model_year: 2018 },
  { id: 7, stock_no: 'SC-1007', brand: 'Toyota', model: 'Prado', trim_name: '', model_year: 2016 },
  { id: 8, stock_no: 'SC-1008', brand: 'Toyota', model: 'Camry', trim_name: '', model_year: 2008 },
];

test('PART 3 matcher: "Harrier hybrid" matches only the Harrier, never the Haval Raptor', () => {
  const m = matchVehicles('Hello, is the Harrier hybrid still available?', FLEET);
  assert.equal(m.kind, 'one');
  assert.equal(m.vehicle.id, 1);
});

test('PART 3 matcher: generic words alone never match a car', () => {
  assert.equal(matchVehicles('hybrid suv automatic petrol', FLEET).kind, 'none');
  assert.equal(isGenericOnly('hybrid suv automatic'), true);
});

test('PART 3 matcher: brand-only gives a candidate list, never a forced single car', () => {
  const m = matchVehicles('Do you have any Toyota?', FLEET);
  assert.equal(m.kind, 'candidates');
  assert.ok(m.list.length >= 2);
  assert.ok(m.list.every((v) => /toyota/i.test(String(v.brand))));
});

test('PART 3 matcher: an exact stock number wins', () => {
  const m = matchVehicles('price for SC-1004 please', FLEET);
  assert.equal(m.kind, 'one');
  assert.equal(m.vehicle.id, 4);
});

test('PART 3 matcher: a truncated Facebook headline ("...") still matches', () => {
  const m = matchVehicles('2019 Toyota Harrier 2.0 Hybrid, low mileage, ready to ship...', FLEET);
  assert.equal(m.kind, 'one');
  assert.equal(m.vehicle.id, 1);
});

test('PART 3 matcher: a stated year narrows the field', () => {
  const m = matchVehicles('Toyota RAV4 2011', FLEET);
  assert.equal(m.kind, 'one');
  assert.equal(m.vehicle.id, 3);
});

test('PART 3 matcher: multi-token brands (FAW-Volkswagen) resolve by the common token', () => {
  const m = matchVehicles('Volkswagen Tiguan price?', FLEET);
  assert.equal(m.kind, 'one');
  assert.equal(m.vehicle.id, 6);
});

test('PART 3 matcher: no inventory -> no match', () => {
  assert.equal(matchVehicles('Toyota Harrier', []).kind, 'none');
});

// ---------------------------------------------------------------------------

const SITE = 'https://skyshcars.com';
const KEY = customerKey('whatsapp', '255700000001');

function makeStore(extra = {}) {
  return {
    conv: { id: 1, channel: 'whatsapp', external_user_id: '255700000001', mode: 'ai', customer_id: 10 },
    messages: [], nextId: 1, answered: 0, pausedUntil: null, lock: null,
    welcomes: new Set([KEY]), sent: [], events: [], currentCar: null,
    referralResult: null, composedRef: null,
    ...extra,
  };
}

function makeDeps(s) {
  const inbound = () => s.messages.filter((m) => m.direction === 'inbound');
  return {
    sleep: async () => {},
    now: () => Date.now(),
    loadConversation: async () => ({ ...s.conv }),
    tryLock: async () => { if (s.lock) return null; s.lock = 'L'; return 'L'; },
    unlock: async () => { s.lock = null; },
    getState: async () => ({ answered_through_id: s.answered, ai_paused_until: s.pausedUntil }),
    lastAnsweredOutboundId: async () => 0,
    burst: async (_id, afterId) => s.messages.filter((m) => m.direction === 'inbound' && m.id > afterId)
      .map((m) => ({ id: m.id, message_type: m.type, body: m.body, external_message_id: m.external_message_id })),
    referralIds: async (ids) => new Set(ids.filter((id) => (s.messages.find((m) => m.id === id) || {}).referral)),
    isFirstContact: async (_conv, firstId) => !inbound().some((m) => m.id < firstId),
    lastOutboundBody: async () => null,
    hasNewerCustomerMessage: async (_id, afterId) => inbound().some((m) => m.id > afterId),
    markAnswered: async (_id, through) => { s.answered = Math.max(s.answered, through); },
    channelReady: () => true,
    resolveReferral: async () => s.referralResult,
    setCurrentCar: async (_id, vehicleId, source) => { s.currentCar = vehicleId; s.currentCarSource = source; },
    welcomeConfig: async () => ({ enabled: true, site: SITE, groupLink: 'https://chat.whatsapp.com/ABC', groupName: 'Sky second hand cars' }),
    welcomeAlreadySent: async () => true,
    claimWelcome: async () => false,
    releaseWelcome: async () => {},
    compose: async (i) => { s.composedRef = i; return { text: 'Thanks, noted.', lang: 'en', model: 'deepseek-chat', vehicleId: null, photoPlan: null }; },
    sendText: async (_conv, text) => { s.sent.push(text); return 'wamid.out'; },
    storeOutbound: async (_id, text) => { s.messages.push({ id: s.nextId++, type: 'text', body: text, sender: 'ai', direction: 'outbound' }); },
    sendPhotos: async () => {},
    flagStaff: async () => {},
    event: async (_id, _ext, type, status, details) => { s.events.push([type, status, details]); },
  };
}

function send(s, body, opts = {}) {
  const id = s.nextId++;
  s.messages.push({ id, type: 'text', body, sender: 'customer', direction: 'inbound', external_message_id: opts.ext || ('in.' + id), referral: !!opts.referral });
  return id;
}

test('PART 3: a matched referral sets the current car and logs referral_matched', async () => {
  const s = makeStore({ referralResult: { vehicle: FLEET[0], aiEnabled: true, method: 'social_log' } });
  send(s, 'Hello! Can I get more info on this?', { referral: true });
  const r = await runEngine(makeDeps(s), 1, { trigger: 'webhook' });
  assert.equal(r.status, 'sent');
  assert.equal(s.currentCar, 1);
  assert.equal(s.currentCarSource, 'social_log');
  assert.equal(s.composedRef.referral, true);
  assert.equal(s.composedRef.referralVehicle.id, 1);
  assert.equal(s.composedRef.referralAiEnabled, true);
  assert.ok(s.events.some((e) => e[0] === 'referral_matched' && e[2].vehicle_id === 1));
});

test('PART 3: an unmatched referral is logged as referral_unmatched and the vehicle stays unknown', async () => {
  const s = makeStore({ referralResult: { vehicle: null, aiEnabled: false, method: 'none' } });
  send(s, 'Hello! Can I get more info on this?', { referral: true });
  await runEngine(makeDeps(s), 1, { trigger: 'webhook' });
  assert.equal(s.currentCar, null);
  assert.equal(s.composedRef.referralVehicle, null);
  assert.ok(s.events.some((e) => e[0] === 'referral_unmatched'));
});

test('PART 3: an AI-disabled matched car is passed through as not sellable', async () => {
  const s = makeStore({ referralResult: { vehicle: FLEET[7], aiEnabled: false, method: 'social_log' } });
  send(s, 'info please', { referral: true });
  await runEngine(makeDeps(s), 1, { trigger: 'webhook' });
  assert.equal(s.composedRef.referralAiEnabled, false);
  assert.equal(s.composedRef.referralVehicle.id, 8);
});

test('PART 3: a normal message does not touch the referral resolver', async () => {
  const s = makeStore();
  send(s, 'How much is the Prado?');
  await runEngine(makeDeps(s), 1, { trigger: 'webhook' });
  assert.equal(s.composedRef.referral, false);
  assert.equal(s.events.some((e) => String(e[0]).startsWith('referral_')), false);
});
