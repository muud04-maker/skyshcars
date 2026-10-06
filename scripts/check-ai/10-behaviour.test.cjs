// PART 10  |  AI behaviour: short holding reply when it does not know, then WAIT; never repeat it.
const test = require('node:test');
const assert = require('node:assert/strict');
const load = require('./lib.cjs');
const { holdingLine, isHolding, shouldHold } = load('ai-rules/hold.js');
const { runEngine, customerKey } = load('ai-rules/engine-core.js');

test('PART 10: the holding line exists in all three languages', () => {
  assert.equal(holdingLine('en'), 'Let me confirm that for you.');
  assert.equal(holdingLine('so'), 'Waan kuu xaqiijinayaa.');
  assert.ok(holdingLine('ar').length > 5);
  assert.equal(holdingLine('xx'), 'Let me confirm that for you.');
});

test('PART 10: a holding line is recognised so it is never sent twice', () => {
  assert.equal(isHolding('Let me confirm that for you.'), true);
  assert.equal(isHolding('Waan kuu xaqiijinayaa.'), true);
  assert.equal(isHolding('Yes, this Corolla is available.'), false);
  assert.equal(isHolding(''), false);
});

test('PART 10: hold only when there is no grounded car and the customer wants an answer', () => {
  assert.equal(shouldHold({ grounded: false, question: true, request: false }), true);
  assert.equal(shouldHold({ grounded: false, question: false, request: true }), true);
  assert.equal(shouldHold({ grounded: true, question: true, request: false }), false);
  assert.equal(shouldHold({ grounded: false, question: false, request: false }), false);
});

const SITE = 'https://skyshcars.com';
const KEY = customerKey('whatsapp', '255700000001');

function makeStore(extra = {}) {
  return {
    conv: { id: 1, channel: 'whatsapp', external_user_id: '255700000001', mode: 'ai', customer_id: 10 },
    messages: [], nextId: 1, answered: 0, pausedUntil: null, lock: null,
    welcomes: new Set([KEY]), sent: [], events: [], held: 0, flagged: [], lastOut: null,
    needsStaff: null,
    ...extra,
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
    burst: async (_id, afterId) => s.messages.filter((m) => m.direction === 'inbound' && m.id > afterId)
      .map((m) => ({ id: m.id, message_type: m.type, body: m.body, external_message_id: m.external_message_id })),
    referralIds: async () => new Set(),
    isFirstContact: async (_c, firstId) => !inbound().some((m) => m.id < firstId),
    lastOutboundBody: async () => s.lastOut,
    hasNewerCustomerMessage: async (_id, afterId) => inbound().some((m) => m.id > afterId),
    markAnswered: async (_id, through) => { s.answered = Math.max(s.answered, through); },
    channelReady: () => true,
    resolveReferral: async () => null,
    setCurrentCar: async () => {},
    holdForStaff: async () => { s.held++; s.pausedUntil = Date.now() + 60000; },
    welcomeConfig: async () => ({ enabled: true, site: SITE, groupLink: 'https://chat.whatsapp.com/ABC', groupName: 'Sky second hand cars' }),
    welcomeAlreadySent: async () => true,
    claimWelcome: async () => false,
    releaseWelcome: async () => {},
    compose: async () => ({ text: s.groundedText || 'Yes, this Corolla is available for $7,634.', lang: 'en', model: 'deepseek-chat', photoPlan: null, allowedNames: s.needsStaff ? [] : ['Toyota Corolla'], needsStaff: s.needsStaff }),
    sendText: async (_c, text) => { s.sent.push(text); s.lastOut = text; return 'wamid.out'; },
    storeOutbound: async (_id, text) => { s.messages.push({ id: s.nextId++, type: 'text', body: text, sender: 'ai', direction: 'outbound' }); },
    sendPhotos: async () => {},
    flagStaff: async (_id, reason) => { s.flagged.push(reason); },
    event: async (_id, _ext, type, status, details) => { s.events.push([type, status, details && details.reason]); },
  };
}
function send(s, body) { const id = s.nextId++; s.messages.push({ id, type: 'text', body, sender: 'customer', direction: 'inbound', external_message_id: 'in.' + id }); return id; }

test('PART 10: an unknown question gets ONE short holding line, flags staff and pauses (waits)', async () => {
  const s = makeStore({ needsStaff: 'no verified answer' });
  send(s, 'How much is shipping to Mombasa?');
  const r = await runEngine(makeDeps(s), 1, { trigger: 'webhook' });
  assert.equal(r.status, 'sent');
  assert.deepEqual(s.sent, ['Let me confirm that for you.']);
  assert.equal(s.flagged.length, 1);
  assert.equal(s.held, 1);
});

test('PART 10: the holding message is never repeated', async () => {
  const s = makeStore({ needsStaff: 'no verified answer', lastOut: 'Let me confirm that for you.' });
  send(s, 'So how much is it?');
  const r = await runEngine(makeDeps(s), 1, { trigger: 'webhook' });
  assert.equal(r.status, 'skipped');
  assert.equal(r.reason, 'holding_already_sent');
  assert.equal(s.sent.length, 0);
});

test('PART 10: a grounded answer is still sent normally (no holding)', async () => {
  const s = makeStore({ needsStaff: null });
  send(s, 'Is the Corolla available?');
  const r = await runEngine(makeDeps(s), 1, { trigger: 'webhook' });
  assert.equal(r.status, 'sent');
  assert.deepEqual(s.sent, ['Yes, this Corolla is available for $7,634.']);
  assert.equal(s.held, 0);
});
