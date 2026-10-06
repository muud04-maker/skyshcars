// PART 12 — staff statements override the AI (deterministic, not prompt-only).
const test = require('node:test');
const assert = require('node:assert/strict');
const load = require('./lib.cjs');
const { staffFact, applyStaffOverride } = load('ai-rules/staff-override.js');
const { runEngine, customerKey } = load('ai-rules/engine-core.js');

test('PART 12: staff facts are detected', () => {
  assert.equal(staffFact('We sold this car.'), 'sold');
  assert.equal(staffFact('Sorry, that Prado is no longer available'), 'sold');
  assert.equal(staffFact('It is reserved for another customer'), 'unavailable');
  assert.equal(staffFact('The correct price is $8,900'), 'price');
  assert.equal(staffFact('Shipping to Mombasa is $1,200'), 'shipping');
  assert.equal(staffFact('hello'), null);
});

test('PART 12: the AI can never claim availability after staff said it is sold', () => {
  const reply = 'Yes, this Corolla is available for $7,634. Which country should we ship to?';
  assert.equal(applyStaffOverride(reply, 'We sold this car.'), 'That one has been sold. I can show you similar available cars.');
  assert.equal(applyStaffOverride(reply, 'It is not available anymore'), 'That one has been sold. I can show you similar available cars.');
});

test('PART 12: unrelated replies and non-sold staff messages are untouched', () => {
  assert.equal(applyStaffOverride('Yes, it is available.', 'Shipping is $900'), 'Yes, it is available.');
  assert.equal(applyStaffOverride('Here are similar cars.', 'We sold this car.'), 'Here are similar cars.');
  assert.equal(applyStaffOverride('Yes it is available.', null), 'Yes it is available.');
});

const SITE = 'https://skyshcars.com';
const KEY = customerKey('whatsapp', '255700000001');
function makeStore(extra = {}) {
  return { conv: { id: 1, channel: 'whatsapp', external_user_id: '255700000001', mode: 'ai', customer_id: 10 }, messages: [], nextId: 1, answered: 0, pausedUntil: null, lock: null, welcomes: new Set([KEY]), sent: [], events: [], staffText: null, ...extra };
}
function makeDeps(s) {
  const inbound = () => s.messages.filter((m) => m.direction === 'inbound');
  return {
    sleep: async () => {}, now: () => Date.now(),
    loadConversation: async () => ({ ...s.conv }),
    tryLock: async () => { if (s.lock) return null; s.lock = 'L'; return 'L'; }, unlock: async () => { s.lock = null; },
    getState: async () => ({ answered_through_id: s.answered, ai_paused_until: s.pausedUntil }),
    lastAnsweredOutboundId: async () => 0,
    burst: async (_i, afterId) => s.messages.filter((m) => m.direction === 'inbound' && m.id > afterId).map((m) => ({ id: m.id, message_type: m.type, body: m.body, external_message_id: m.external_message_id })),
    referralIds: async () => new Set(),
    isFirstContact: async (_c, firstId) => !inbound().some((m) => m.id < firstId),
    lastOutboundBody: async () => null,
    hasNewerCustomerMessage: async (_i, afterId) => inbound().some((m) => m.id > afterId),
    markAnswered: async (_i, through) => { s.answered = Math.max(s.answered, through); },
    channelReady: () => true, resolveReferral: async () => null, setCurrentCar: async () => {},
    holdForStaff: async () => {}, lastStaffBody: async () => s.staffText,
    welcomeConfig: async () => ({ enabled: true, site: SITE, groupLink: 'https://chat.whatsapp.com/ABC', groupName: 'Sky second hand cars' }),
    welcomeAlreadySent: async () => true, claimWelcome: async () => false, releaseWelcome: async () => {},
    compose: async () => ({ text: 'Yes, this Corolla is available for $7,634.', lang: 'en', model: 'deepseek-chat', photoPlan: null, allowedNames: ['Toyota Corolla'], needsStaff: null }),
    sendText: async (_c, text) => { s.sent.push(text); return 'wamid.out'; },
    storeOutbound: async (_i, text) => { s.messages.push({ id: s.nextId++, type: 'text', body: text, sender: 'ai', direction: 'outbound' }); },
    sendPhotos: async () => {}, flagStaff: async () => {},
    event: async (_i, _e, type, status) => { s.events.push([type, status]); },
  };
}

test('PART 12: the send path replaces an availability claim after a staff "sold"', async () => {
  const s = makeStore({ staffText: 'We sold this car.' });
  s.messages.push({ id: s.nextId++, type: 'text', body: 'Is it available?', sender: 'customer', direction: 'inbound', external_message_id: 'in.1' });
  const r = await runEngine(makeDeps(s), 1, { trigger: 'webhook' });
  assert.equal(r.status, 'sent');
  assert.deepEqual(s.sent, ['That one has been sold. I can show you similar available cars.']);
});
