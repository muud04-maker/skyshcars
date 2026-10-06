// PART 9  |  regression suite for the real live failures A-H plus the extra Part 9 scenarios.
const test = require('node:test');
const assert = require('node:assert/strict');
const load = require('./lib.cjs');
const { matchVehicles } = load('ai-rules/match.js');
const { decideReply, wordsFromStored } = load('ai-rules/reply-policy.js');
const { stripInventedHistory } = load('ai-rules/reply-guard.js');
const { transcriptLines } = load('ai-rules/context.js');
const { extractSlots, nextQuestion } = load('ai-rules/slots.js');
const { runEngine, customerKey } = load('ai-rules/engine-core.js');

const HINTS = { countries: ['Somalia', 'Kenya'], ports: ['Berbera', 'Mombasa'] };
const FLEET = [
  { id: 1, stock_no: 'SC-1001', brand: 'Toyota', model: 'Harrier', trim_name: 'Hybrid', model_year: 2019 },
  { id: 2, stock_no: 'SC-1002', brand: 'Haval', model: 'Raptor', trim_name: '', model_year: 2023 },
  { id: 3, stock_no: 'SC-1003', brand: 'Toyota', model: 'RAV4', trim_name: '', model_year: 2011 },
  { id: 4, stock_no: 'SC-1004', brand: 'Toyota', model: 'Prado', trim_name: '', model_year: 2016 },
];
const ENABLED = [FLEET[0], FLEET[2]]; // only the Harrier and the 2011 RAV4 are enabled for the AI

test('A. Facebook referral: an ad-click burst is answered even without a question', () => {
  const d = decideReply({ burst: [{ type: 'text', words: 'Hello! Can I get more info on this?', referral: true }], firstContact: false, lastOutbound: null });
  assert.equal(d.reply, true);
  assert.equal(d.reason, 'ad_click');
});

test('B. old stock leak: a car that is not AI-enabled can never match', () => {
  assert.equal(matchVehicles('Haval Raptor', ENABLED).kind, 'none');
  assert.equal(matchVehicles('Prado 2016', ENABLED).kind, 'none');
  const rav = matchVehicles('RAV4 2011', ENABLED);
  assert.equal(rav.kind, 'one');
  assert.equal(rav.vehicle.id, 3);
});

test('C. wrong generic-word match: "Harrier hybrid" never becomes another car', () => {
  const m = matchVehicles('Harrier hybrid', FLEET);
  assert.equal(m.kind, 'one');
  assert.equal(m.vehicle.id, 1);
  assert.equal(matchVehicles('hybrid suv automatic petrol', FLEET).kind, 'none');
});

const SITE = 'https://skyshcars.com';
const KEY = customerKey('whatsapp', '255700000001');

function makeStore(extra = {}) {
  return {
    conv: { id: 1, channel: 'whatsapp', external_user_id: '255700000001', mode: 'ai', customer_id: 10 },
    messages: [], nextId: 1, answered: 0, pausedUntil: null, lock: null,
    welcomes: new Set([KEY]), sent: [], events: [], composed: [], channelReady: true,
    referralResult: null, failSend: false,
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
    lastOutboundBody: async () => s.lastOutbound || null,
    hasNewerCustomerMessage: async (_id, afterId) => inbound().some((m) => m.id > afterId),
    markAnswered: async (_id, through) => { s.answered = Math.max(s.answered, through); },
    channelReady: () => s.channelReady,
    resolveReferral: async () => s.referralResult,
    setCurrentCar: async () => {},
    welcomeConfig: async () => ({ enabled: true, site: SITE, groupLink: 'https://chat.whatsapp.com/ABC', groupName: 'Sky second hand cars' }),
    welcomeAlreadySent: async () => true,
    claimWelcome: async () => false,
    releaseWelcome: async () => {},
    compose: async (i) => { s.composed.push(i); return { text: s.reply || 'Yes, we can help.', lang: 'en', model: 'deepseek-chat', photoPlan: null, allowedNames: s.allowedNames || [] }; },
    sendText: async (_conv, text) => { if (s.failSend) throw new Error('Meta refused the message'); s.sent.push(text); return 'wamid.out'; },
    storeOutbound: async (_id, text, o) => { s.messages.push({ id: s.nextId++, type: 'text', body: text, sender: 'ai', direction: 'outbound', status: o && o.status }); },
    sendPhotos: async () => {},
    flagStaff: async () => {},
    event: async (_id, _ext, type, status) => { s.events.push([type, status]); },
  };
}
function send(s, body, opts = {}) {
  const id = s.nextId++;
  s.messages.push({ id, type: opts.type || 'text', body, sender: 'customer', direction: 'inbound', external_message_id: 'in.' + id, referral: !!opts.referral });
  return id;
}

test('D. burst merge: two quick messages produce ONE reply that covers both', async () => {
  const s = makeStore();
  send(s, 'Do you have a Harrier?');
  send(s, 'and how much is it?');
  const r = await runEngine(makeDeps(s), 1, { trigger: 'webhook' });
  assert.equal(r.status, 'sent');
  assert.equal(s.sent.length, 1);
  assert.equal(s.composed.length, 1);
  assert.ok(s.composed[0].words.includes('Harrier'));
  assert.ok(s.composed[0].words.includes('how much'));
});

test('D. duplicate reply: a webhook retry sends nothing more', async () => {
  const s = makeStore();
  send(s, 'Do you have a Prado?');
  await runEngine(makeDeps(s), 1, { trigger: 'webhook' });
  const again = await runEngine(makeDeps(s), 1, { trigger: 'webhook' });
  assert.equal(again.status, 'skipped');
  assert.equal(s.sent.length, 1);
});

test('E. invented history is removed unless it names a car we know', () => {
  const allowed = ['2019 Toyota Harrier'];
  assert.equal(stripInventedHistory('You were looking at the FAW Besturn X80.', allowed), '');
  assert.equal(stripInventedHistory('As you mentioned, the Premio is a good car.', allowed), '');
  assert.equal(stripInventedHistory('You were looking at the Toyota Harrier.', allowed), 'You were looking at the Toyota Harrier.');
  assert.equal(stripInventedHistory('Yes, the Harrier is available.', allowed), 'Yes, the Harrier is available.');
});

test('F. short valid answers are understood when we asked a question', () => {
  const asked = 'Do you prefer left-hand or right-hand drive?';
  assert.equal(decideReply({ burst: [{ type: 'text', words: 'Both' }], firstContact: false, lastOutbound: asked }).reply, true);
  assert.equal(decideReply({ burst: [{ type: 'text', words: 'Ok' }], firstContact: false, lastOutbound: asked }).reply, true);
  assert.equal(decideReply({ burst: [{ type: 'text', words: 'Ogulu' }], firstContact: false, lastOutbound: asked }).reason, 'answer_to_our_question');
});

test('G. staff override: staff messages are in the labelled transcript', () => {
  const lines = transcriptLines([
    { sender: 'customer', body: 'Is the Prado still available?' },
    { sender: 'human', body: 'Sorry, that Prado is sold.' },
    { sender: 'ai', body: 'Let me check the alternatives for you.' },
  ], 25);
  assert.deepEqual(lines, [
    '[CUSTOMER] Is the Prado still available?',
    '[STAFF] Sorry, that Prado is sold.',
    '[AI] Let me check the alternatives for you.',
  ]);
});

test('H. media never goes silent and never pretends to see the image', () => {
  assert.equal(wordsFromStored('image', 'PHOTO\nImage received.'), '');
  assert.equal(wordsFromStored('audio', 'VOICE NOTE\nTranscription pending.'), '');
  assert.equal(wordsFromStored('image', 'PHOTO\nCaption: is this available?'), 'is this available?');
  assert.equal(decideReply({ burst: [{ type: 'image', words: '' }], firstContact: false, lastOutbound: null }).reason, 'media');
  assert.equal(decideReply({ burst: [{ type: 'audio', words: '' }], firstContact: false, lastOutbound: null }).reply, true);
});

test('I. no AI reply into a WhatsApp group, ever', () => {
  const d = decideReply({ burst: [{ type: 'text', words: 'how much?' }], firstContact: true, recipient: '120363000000000000@g.us' });
  assert.equal(d.reply, false);
  assert.equal(d.reason, 'group');
});

test('J. pure thanks / emoji get no reply when there is no pending question', () => {
  assert.equal(decideReply({ burst: [{ type: 'text', words: 'thank you' }], firstContact: false, lastOutbound: null }).reason, 'ack_only');
  assert.equal(decideReply({ burst: [{ type: 'text', words: '👍' }], firstContact: false, lastOutbound: null }).reason, 'ack_only');
});

test('K. the first message ever is always answered', () => {
  const d = decideReply({ burst: [{ type: 'text', words: 'hello' }], firstContact: true, lastOutbound: null });
  assert.equal(d.reply, true);
  assert.equal(d.reason, 'first_message');
});

test('L. zero AI-enabled inventory can never produce a match', () => {
  assert.equal(matchVehicles('Toyota Harrier', []).kind, 'none');
  assert.equal(matchVehicles('SUV under 10000', []).kind, 'none');
});

test('M. an unconfigured channel is skipped, never a failed send', async () => {
  const s = makeStore({ channelReady: false });
  send(s, 'Do you have a Prado?');
  const r = await runEngine(makeDeps(s), 1, { trigger: 'webhook' });
  assert.equal(r.status, 'skipped');
  assert.equal(r.reason, 'not_configured');
  assert.equal(s.sent.length, 0);
});

test('N. an answered slot is never asked again', () => {
  const slots = extractSlots('SUV to Kenya', HINTS);
  assert.notEqual(nextQuestion(slots), 'Which country or port should we ship to?');
  assert.equal(nextQuestion(slots), 'What is your budget?');
});

test('O. a matched but AI-disabled referral is passed through as not sellable', async () => {
  const s = makeStore({ referralResult: { vehicle: FLEET[3], aiEnabled: false, method: 'social_log' } });
  send(s, 'info please', { referral: true });
  await runEngine(makeDeps(s), 1, { trigger: 'webhook' });
  assert.equal(s.composed[0].referralVehicle.id, 4);
  assert.equal(s.composed[0].referralAiEnabled, false);
});

test('Q. a failed send is recorded and never counted as sent', async () => {
  const s = makeStore({ failSend: true });
  send(s, 'Do you have a Prado?');
  const r = await runEngine(makeDeps(s), 1, { trigger: 'webhook' });
  assert.equal(r.status, 'failed');
  assert.equal(s.sent.length, 0);
  assert.ok(s.messages.some((m) => m.direction === 'outbound' && m.status === 'failed'));
});
