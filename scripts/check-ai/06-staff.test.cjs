// PART 6 â€” staff and AI work together: staff echoes are recognised, the AI stays quiet while paused,
// and it returns by itself (sweep) once the pause has expired and the customer is still waiting.
const test = require('node:test');
const assert = require('node:assert/strict');
const load = require('./lib.cjs');
const { isStaffEcho, pauseExpired, DEFAULT_STAFF_PAUSE_MINUTES } = load('ai-rules/staff.js');
const { runEngine, customerKey } = load('ai-rules/engine-core.js');

test('PART 6: our own outgoing messages are recognised as staff echoes', () => {
  assert.equal(isStaffEcho({ from: '1234567890' }, ['1234567890']), true);
  assert.equal(isStaffEcho({ from: '+1 234-567-890' }, ['1234567890']), true);
  assert.equal(isStaffEcho({ from: '255700000001' }, ['1234567890']), false);
  assert.equal(isStaffEcho({}, ['1234567890']), false);
});

test('PART 6: pause expiry', () => {
  const now = 1_000_000;
  assert.equal(pauseExpired(null, now), true);
  assert.equal(pauseExpired(now - 1, now), true);
  assert.equal(pauseExpired(now + 1, now), false);
  assert.equal(DEFAULT_STAFF_PAUSE_MINUTES, 15);
});

const SITE = 'https://skyshcars.com';
const KEY = customerKey('whatsapp', '255700000001');

function makeStore(extra = {}) {
  return {
    conv: { id: 1, channel: 'whatsapp', external_user_id: '255700000001', mode: 'ai', customer_id: 10 },
    messages: [], nextId: 1, answered: 0, pausedUntil: null, lock: null,
    welcomes: new Set([KEY]), sent: [], events: [],
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
    referralIds: async () => new Set(),
    isFirstContact: async (_conv, firstId) => !inbound().some((m) => m.id < firstId),
    lastOutboundBody: async () => null,
    hasNewerCustomerMessage: async (_id, afterId) => inbound().some((m) => m.id > afterId),
    markAnswered: async (_id, through) => { s.answered = Math.max(s.answered, through); },
    channelReady: () => true,
    resolveReferral: async () => null,
    setCurrentCar: async () => {},
    welcomeConfig: async () => ({ enabled: true, site: SITE, groupLink: 'https://chat.whatsapp.com/ABC', groupName: 'Sky second hand cars' }),
    welcomeAlreadySent: async () => true,
    claimWelcome: async () => false,
    releaseWelcome: async () => {},
    compose: async () => ({ text: 'Yes, we can ship it. Which port?', lang: 'en', model: 'deepseek-chat', photoPlan: null }),
    sendText: async (_conv, text) => { s.sent.push(text); return 'wamid.out'; },
    storeOutbound: async (_id, text) => { s.messages.push({ id: s.nextId++, type: 'text', body: text, sender: 'ai', direction: 'outbound' }); },
    sendPhotos: async () => {},
    flagStaff: async () => {},
    event: async (_id, _ext, type, status, details) => { s.events.push([type, status, details && details.reason]); },
  };
}

function send(s, body) {
  const id = s.nextId++;
  s.messages.push({ id, type: 'text', body, sender: 'customer', direction: 'inbound', external_message_id: 'in.' + id });
  return id;
}

test('PART 6: while a chat is paused the AI does not reply', async () => {
  const s = makeStore({ pausedUntil: Date.now() + 60_000 });
  send(s, 'Do you have a Prado?');
  const r = await runEngine(makeDeps(s), 1, { trigger: 'webhook' });
  assert.equal(r.status, 'skipped');
  assert.equal(r.reason, 'ai_paused');
  assert.equal(s.sent.length, 0);
});

test('PART 6: after the pause expires the AI returns to a waiting customer (sweep)', async () => {
  const s = makeStore({ pausedUntil: Date.now() - 1000 });
  send(s, 'Do you have a Prado?');
  const r = await runEngine(makeDeps(s), 1, { trigger: 'sweep' });
  assert.equal(r.status, 'sent');
  assert.equal(s.sent.length, 1);
});
