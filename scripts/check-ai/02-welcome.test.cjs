// PART 2 â€” first-contact welcome, sent exactly once, and the marketing-link filter.
// Runs the real reply engine (ai-rules/engine-core) against an in-memory store that mimics the
// database semantics (atomic welcome claim, per-chat lock, answered marker).
const test = require('node:test');
const assert = require('node:assert/strict');
const load = require('./lib.cjs');
const { runEngine, customerKey } = load('ai-rules/engine-core.js');

const SITE = 'https://skyshcars.com';
const GROUP = 'https://chat.whatsapp.com/EyGQRCZmdyhKUnXD2H1bIq?s=cl&p=a&mlu=4&ilr=4';
const WA = '255700000001';
const KEY = customerKey('whatsapp', WA);

function makeStore(extra = {}) {
  return {
    conv: { id: 1, channel: 'whatsapp', external_user_id: WA, mode: 'ai', customer_id: 10 },
    messages: [], nextId: 1, answered: 0, pausedUntil: null, lock: null,
    welcomes: new Set(), sent: [], events: [], failSend: false, currentCar: null, referralResult: null,
    reply: 'Yes, we can help. What is your budget?',
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
    lastAnsweredOutboundId: async () => Math.max(0, ...s.messages.filter((m) => m.direction === 'outbound' && (m.sender === 'ai' || m.sender === 'human')).map((m) => m.id)),
    burst: async (_id, afterId) => s.messages.filter((m) => m.direction === 'inbound' && m.id > afterId)
      .map((m) => ({ id: m.id, message_type: m.type, body: m.body, external_message_id: m.external_message_id })),
    referralIds: async (ids) => new Set(ids.filter((id) => (s.messages.find((m) => m.id === id) || {}).referral)),
    isFirstContact: async (_conv, firstId) => !inbound().some((m) => m.id < firstId),
    lastOutboundBody: async (_id, beforeId) => { const o = s.messages.filter((m) => m.direction === 'outbound' && (m.sender === 'ai' || m.sender === 'human') && m.id < beforeId); return o.length ? o[o.length - 1].body : null; },
    hasNewerCustomerMessage: async (_id, afterId) => inbound().some((m) => m.id > afterId),
    markAnswered: async (_id, through) => { s.answered = Math.max(s.answered, through); },
    channelReady: () => true,
    resolveReferral: async () => s.referralResult,
    setCurrentCar: async (_id, vehicleId) => { s.currentCar = vehicleId; },
    welcomeConfig: async () => ({ enabled: true, site: SITE, groupLink: GROUP, groupName: 'Sky second hand cars' }),
    welcomeAlreadySent: async (key) => s.welcomes.has(key),
    claimWelcome: async (key) => { if (s.welcomes.has(key)) return false; s.welcomes.add(key); return true; },
    releaseWelcome: async (key) => { s.welcomes.delete(key); },
    compose: async () => ({ text: s.reply, lang: 'en', model: 'deepseek-chat', vehicleId: null, photoPlan: null }),
    sendText: async (_conv, text) => { if (s.failSend) throw new Error('Meta: message outside the 24-hour window'); s.sent.push(text); return 'wamid.out.' + s.sent.length; },
    storeOutbound: async (_id, text, o) => { s.messages.push({ id: s.nextId++, type: 'text', body: text, sender: 'ai', direction: 'outbound', status: o && o.status }); },
    sendPhotos: async () => {},
    flagStaff: async (_id, reason) => { s.events.push(['flag', reason]); },
    event: async (_id, _ext, type, status, details) => { s.events.push([type, status, details && details.reason]); },
  };
}

function send(s, body, opts = {}) {
  const id = s.nextId++;
  s.messages.push({ id, type: opts.type || 'text', body, sender: 'customer', direction: 'inbound', external_message_id: opts.ext || ('in.' + id), referral: !!opts.referral });
  return id;
}

test('PART 2: the first reply of a new customer carries the website + group welcome once', async () => {
  const s = makeStore();
  send(s, 'Hello! Do you have a Toyota Harrier?');
  const r = await runEngine(makeDeps(s), 1, { trigger: 'webhook' });
  assert.equal(r.status, 'sent');
  assert.equal(r.welcome, true);
  assert.equal(s.sent.length, 1);
  assert.ok(s.sent[0].includes(SITE), 'website link present');
  assert.ok(s.sent[0].includes(GROUP), 'group invite present');
  assert.equal([...s.welcomes].length, 1);
});

test('PART 2: a later reply never repeats the welcome', async () => {
  const s = makeStore({ welcomes: new Set([KEY]) });
  send(s, 'How much is the Harrier?');
  const r = await runEngine(makeDeps(s), 1, { trigger: 'webhook' });
  assert.equal(r.status, 'sent');
  assert.equal(r.welcome, false);
  assert.ok(!s.sent[0].includes(GROUP));
});

test('PART 2: a webhook retry of the same message does not send a second reply', async () => {
  const s = makeStore();
  send(s, 'Hi, any RAV4?', { ext: 'wamid.in.1' });
  const first = await runEngine(makeDeps(s), 1, { trigger: 'webhook' });
  const retry = await runEngine(makeDeps(s), 1, { trigger: 'webhook' });
  assert.equal(first.status, 'sent');
  assert.equal(retry.status, 'skipped');
  assert.equal(retry.reason, 'nothing_new');
  assert.equal(s.sent.length, 1);
});

test('PART 2: two parallel workers produce exactly one reply and one welcome', async () => {
  const s = makeStore();
  send(s, 'Hello, do you ship to Somalia?');
  const [a, b] = await Promise.all([
    runEngine(makeDeps(s), 1, { trigger: 'webhook' }),
    runEngine(makeDeps(s), 1, { trigger: 'webhook' }),
  ]);
  assert.equal(s.sent.length, 1, 'only one message sent');
  assert.equal([...s.welcomes].length, 1, 'welcome claimed once');
  assert.ok([a.status, b.status].includes('sent'));
});

test('PART 2: an existing (back-filled) customer never receives the welcome', async () => {
  const s = makeStore({ welcomes: new Set([KEY]) });
  send(s, 'Good morning');
  const r = await runEngine(makeDeps(s), 1, { trigger: 'webhook' });
  assert.equal(r.welcome, false);
});

test('PART 2: an ad-click first message is answered and welcomed', async () => {
  const s = makeStore();
  send(s, 'Hello! Can I get more info on this?', { referral: true });
  const r = await runEngine(makeDeps(s), 1, { trigger: 'webhook' });
  assert.equal(r.status, 'sent');
  assert.equal(r.welcome, true);
});

test('PART 2: a referral on a returning customer is treated as an ad click', async () => {
  const s = makeStore({ welcomes: new Set([KEY]) });
  send(s, 'hi');                       // earlier message, already answered
  s.answered = s.messages[s.messages.length - 1].id;
  send(s, 'Hello! Can I get more info on this?', { referral: true });
  const r = await runEngine(makeDeps(s), 1, { trigger: 'webhook' });
  assert.equal(r.status, 'sent');
  assert.equal(r.reason, 'ad_click');
});

test('PART 2: a failed delivery does not burn the welcome (it rides the next reply)', async () => {
  const s = makeStore({ failSend: true });
  send(s, 'Hello, any Toyota?');
  const failed = await runEngine(makeDeps(s), 1, { trigger: 'webhook' });
  assert.equal(failed.status, 'failed');
  assert.equal([...s.welcomes].length, 0, 'claim released after the failed send');

  s.failSend = false;
  send(s, 'Do you have a Toyota RAV4?');
  const ok = await runEngine(makeDeps(s), 1, { trigger: 'webhook' });
  assert.equal(ok.status, 'sent');
  assert.equal(ok.welcome, true);
  assert.ok(s.sent[0].includes(GROUP));
});

test('PART 2: after the welcome, marketing links are stripped from AI replies', async () => {
  const s = makeStore({ welcomes: new Set([KEY]), reply: 'See everything on https://skyshcars.com or join https://chat.whatsapp.com/ABC123' });
  send(s, 'What cars do you have?');
  const r = await runEngine(makeDeps(s), 1, { trigger: 'webhook' });
  assert.equal(r.status, 'sent');
  assert.ok(!s.sent[0].includes('skyshcars.com'), 'website root removed');
  assert.ok(!s.sent[0].includes('chat.whatsapp.com'), 'group link removed');
});

test('PART 2: the links are kept when the customer explicitly asks for them', async () => {
  const s = makeStore({ welcomes: new Set([KEY]), reply: 'Join our group here: https://chat.whatsapp.com/ABC123' });
  send(s, 'please send me the group link');
  const r = await runEngine(makeDeps(s), 1, { trigger: 'webhook' });
  assert.equal(r.status, 'sent');
  assert.ok(s.sent[0].includes('https://chat.whatsapp.com/ABC123'));
});

test('PART 2: the welcome can be disabled from Admin Settings', async () => {
  const s = makeStore();
  const deps = makeDeps(s);
  deps.welcomeConfig = async () => ({ enabled: false, site: SITE, groupLink: GROUP, groupName: 'x' });
  send(s, 'Hello');
  const r = await runEngine(deps, 1, { trigger: 'webhook' });
  assert.equal(r.status, 'sent');
  assert.equal(r.welcome, false);
  assert.ok(!s.sent[0].includes(GROUP));
});
