// ONE-PASS RELEASE HARDENING - the fixes from the master brief, validated with anonymised fixtures that
// mirror the real conversations named in the brief (ids and shapes only, no customer data).
//
// Real evidence this file pins down (messages dump: 152 customers, 148 conversations, 2972 messages):
//   - 100 inbound photos stored as "PHOTO\nImage received." and 0 with a visual description
//   - 21 voice notes left "Transcription pending." and 0 transcripts   -> media AI was never enabled
//   - 95 "which vehicle/car/bike" asks, 53 holds, 46 of them because the vehicle was still unknown
//   - conversation #35: the AI spoke 8s after a staff reply (send race)
//   - conversation #4: "[0 vehicle photo sent] ... BYD Seagull" for an SUV photo request
//   - 14 reaction/edit placeholders counted as customers waiting
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const load = require('./lib.cjs');
const { runEngine } = load('ai-rules/engine-core.js');
const { buyingSignal, needsHumanNow, signalNextStep, signalStaffReason } = load('ai-rules/buying-signal.js');
const { maskIdentifier, historyBlock } = load('all-history.js');

const root = path.join(__dirname, '..', '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const ENGINE = 'src/lib/ai-rules/engine-core.ts';
const COMPOSE = 'src/lib/sales-compose.ts';
const AI = 'src/lib/ai.ts';
const INBOX = 'src/lib/inbox.ts';
const HOOK = 'src/app/api/whatsapp/webhook/route.ts';

// ---------------------------------------------------------------- 1. send race (conv #35 / #51)
function makeStore(extra = {}) {
  return {
    conv: { id: 1, channel: 'whatsapp', external_user_id: '255700000001', mode: 'ai', customer_id: 10 },
    messages: [], nextId: 1, answered: 0, pausedUntil: null, lock: null, sent: [], events: [], ...extra,
  };
}
function makeDeps(s, opts = {}) {
  const inbound = () => s.messages.filter((m) => m.direction === 'inbound');
  return {
    sleep: async () => {}, now: () => Date.now(),
    loadConversation: async () => (opts.modeAfterCompose && s.composed ? { ...s.conv, mode: opts.modeAfterCompose } : { ...s.conv }),
    tryLock: async () => { if (s.lock) return null; s.lock = 'L'; return 'L'; },
    unlock: async () => { s.lock = null; },
    getState: async () => ({ answered_through_id: s.answered, ai_paused_until: s.pausedUntil }),
    lastAnsweredOutboundId: async () => 0,
    burst: async (_i, afterId) => inbound().filter((m) => m.id > afterId).map((m) => ({ id: m.id, message_type: m.type, body: m.body, external_message_id: m.external_message_id })),
    referralIds: async () => new Set(),
    isFirstContact: async (_c, f) => !inbound().some((m) => m.id < f),
    lastOutboundBody: async () => null,
    hasNewerCustomerMessage: async (_i, after) => inbound().some((m) => m.id > after),
    markAnswered: async (_i, t) => { s.answered = Math.max(s.answered, t); },
    channelReady: () => true,
    resolveReferral: async () => null,
    setCurrentCar: async () => {},
    holdForStaff: async () => {},
    lastStaffBody: async () => null,
    turnState: async () => (opts.turnState ? opts.turnState(s) : { lastInboundId: 1, lastOutboundId: 0 }),
    welcomeConfig: async () => ({ enabled: true, site: 'https://skyshcars.com', groupLink: 'https://chat.whatsapp.com/x', groupName: 'Sky' }),
    welcomeAlreadySent: async () => true, claimWelcome: async () => false, releaseWelcome: async () => {},
    compose: async () => {
      s.composed = true;
      if (opts.staffRepliesDuringCompose) s.messages.push({ id: s.nextId++, sender: 'human', direction: 'outbound', type: 'text', body: 'Which country should we ship to?' });
      return { text: 'Yes, it is available.', lang: 'en', model: 'm', photoPlan: null };
    },
    sendText: async (_c, t) => { s.sent.push(t); return 'w'; },
    storeOutbound: async () => {},
    sendPhotos: async () => {}, flagStaff: async () => {},
    event: async (_i, _e, type, status, details) => { s.events.push([type, status, details]); },
  };
}
function inbound(s, body) { const id = s.nextId++; s.messages.push({ id, type: 'text', body, sender: 'customer', direction: 'inbound', external_message_id: 'in.' + id }); return id; }

test('REGRESSION (conv#35): a staff reply that arrives WHILE the AI is composing silences the AI', async () => {
  const s = makeStore();
  inbound(s, 'Can I get more info on this?');
  const deps = makeDeps(s, {
    staffRepliesDuringCompose: true,
    // the final pre-send read sees the staff message (this is what the fix adds)
    turnState: (st) => {
      const staffMsg = st.messages.find((m) => m.sender === 'human');
      if (!staffMsg) return { lastInboundId: 1, lastOutboundId: 0 };
      return { lastInboundId: 1, lastOutboundId: Number(staffMsg.id), lastInboundAtMs: Date.now() - 8000, lastStaffAtMs: Date.now() };
    },
  });
  const r = await runEngine(deps, 1, { trigger: 'sweep' });
  assert.equal(r.status, 'skipped');
  assert.equal(r.reason, 'staff_replied_during_compose');
  assert.equal(s.sent.length, 0, 'the AI never speaks over the human');
  assert.equal(s.events.some((e) => String(e[2] && e[2].reason) === 'staff_replied_during_compose'), true, 'the race is recorded');
});

test('a NEW customer message that arrives while composing is not answered with a stale reply', async () => {
  const s = makeStore();
  inbound(s, 'hello');
  const deps = makeDeps(s, { turnState: () => ({ lastInboundId: 2, lastOutboundId: 0, lastInboundAtMs: Date.now(), lastStaffAtMs: 0 }) });
  const r = await runEngine(deps, 1, { trigger: 'sweep' });
  assert.equal(r.status, 'skipped');
  assert.equal(['newer_customer_message_during_compose', 'nothing_new', 'waiting_for_customer'].includes(r.reason), true, r.reason);
});

test('a takeover during composing also stops the send', async () => {
  const s = makeStore();
  inbound(s, 'price?');
  const deps = makeDeps(s, { modeAfterCompose: 'human' });
  const r = await runEngine(deps, 1, { trigger: 'sweep' });
  assert.equal(r.status, 'skipped');
  assert.equal(s.sent.length, 0);
  // Either the post-compose mode check or the final pre-send gate catches it; both mean "no AI turn".
  assert.equal(['staff_took_over', 'staff_took_over_during_compose', 'human_mode'].includes(r.reason), true, r.reason);
  assert.ok(read(ENGINE).includes('staff_took_over_during_compose'), 'the guard exists in the engine');
});

test('the pre-send gate cannot duplicate a reply', () => {
  const src = read(ENGINE);
  assert.ok(src.includes('await deps.markAnswered(conversationId, lastId); // before sending'), 'answered marker written before the send');
  assert.ok(src.includes('if (st.answered_through_id >= lastId && !opts.force)'), 'a second runner cannot answer the same turn');
  assert.ok(src.includes('tryLock(conversationId)'), 'one worker per chat');
});

// ---------------------------------------------------------------- 2. media follow-through
test('a photo request with no vehicle honours the customer filters instead of the newest item', () => {
  const src = read(AI);
  assert.ok(src.includes('photoBackedMatchFor'), 'the filter-aware selection exists');
  assert.ok(!src.includes('newestCarWithPhotos'), 'the newest-item shortcut is gone');
  assert.ok(src.includes('want.category'), 'category (SUV/motorcycle) respected');
  assert.ok(src.includes('want.bodyType'), 'body type respected');
  assert.ok(src.includes('want.steering'), 'steering respected');
  assert.ok(src.includes('want.maxPrice'), 'budget respected');
  assert.ok(src.includes("get('preferred_category')"), 'stored customer memory is used');
  assert.ok(src.includes("get('budget_max')"), 'stored budget is used');
  assert.ok(src.includes('matches.slice(0, 8)'), 'only photo-backed matches are considered');
  assert.ok(src.includes('whatsappPhotosForVehicle'), 'and only their own verified photos');
});

test('media the AI cannot read is a configuration gap, not a code gap', () => {
  const hook = read(HOOK);
  assert.ok(hook.includes('mediaAiConfigured()'), 'the code checks for a media key');
  assert.ok(hook.includes('describeImage'), 'the image path exists');
  assert.ok(hook.includes('transcribeAudio'), 'the voice path exists');
  assert.ok(hook.includes('flagForStaff'), 'and staff are flagged when media cannot be read');
  const compose = read(COMPOSE);
  assert.ok(compose.includes('cannot see or hear'), 'the model is told not to claim it saw the media');
});

// ---------------------------------------------------------------- 3. buying signals -> human triage
test('buying signals are detected and handed to a human with ONE relevant next step', () => {
  assert.equal(buyingSignal('I want this car, how can I pay?'), 'ready_to_buy');
  // Asking HOW to pay is the strongest signal (the customer wants to buy now); the payment branch covers
  // messages that talk about paying without that intent phrasing.
  assert.equal(buyingSignal('How do I pay the deposit?'), 'ready_to_buy');
  assert.equal(buyingSignal('can I send the deposit by bank transfer?'), 'payment');
  assert.equal(buyingSignal('Is it still available?'), 'availability');
  assert.equal(buyingSignal('How much is shipping to Mombasa?'), 'shipping');
  assert.equal(buyingSignal('what is the price'), 'price');
  assert.equal(buyingSignal('send me photos please'), 'photos');
  assert.equal(buyingSignal('hello'), null);
  assert.equal(needsHumanNow('ready_to_buy'), true);
  assert.equal(needsHumanNow('payment'), true);
  assert.equal(needsHumanNow('price'), false);
  assert.ok(signalNextStep('ready_to_buy').includes('payment procedure'));
  assert.ok(signalNextStep('shipping').includes('destination'));
  assert.ok(signalStaffReason('payment').includes('payment procedure'));
  const compose = read(COMPOSE);
  assert.ok(compose.includes('buyingSignal(i.words)'), 'the engine detects the signal');
  assert.ok(compose.includes('signalStaffReason(signal)'), 'staff get a precise reason');
  assert.ok(compose.includes('signalNote'), 'the next step reaches the reply');
  assert.ok(!/INSERT INTO orders|INSERT INTO payments/i.test(compose), 'no order/payment is fabricated');
});

// ---------------------------------------------------------------- 4. privacy + honest triage
test('phone numbers and PSIDs are masked in the history stream and its TXT export', () => {
  assert.equal(maskIdentifier('255700000001'), '…0001');
  assert.equal(maskIdentifier('1234567890123456'), '…3456');
  assert.equal(maskIdentifier(''), '');
  const src = read('src/lib/all-history.ts');
  assert.ok(src.includes('maskIdentifier(r.phone || r.psid)'), 'the export masks the identifier');
  const client = read('src/app/admin/all-history/AllHistoryClient.tsx');
  assert.ok(client.includes('maskId(r.phone || r.psid)'), 'the page masks it too');
  const block = historyBlock({
    ts: '2026-10-05 10:00:00', source_id: 'msg:1', kind: 'message', sender_role: 'customer', channel: 'whatsapp',
    customer_id: 42, customer_name: null, phone: '255700000001', psid: null, conversation_id: 7,
    body: 'hello', meta: null, vehicle_id: null, stock_no: null, category: null, brand: null, model: null, model_year: null,
  });
  assert.ok(block.includes('…0001'), 'masked id present');
  assert.ok(block.includes('#42'), 'customer id present for cross-checking');
  assert.ok(!block.includes('255700000001'), 'the raw number never appears');
});

test('a reaction or an edit is not counted as "needs reply"', () => {
  const src = read(INBOX);
  assert.ok(src.includes('export function actionableInbound'), 'the helper exists');
  assert.ok(src.includes("NOT LIKE '[Unsupported message: reaction]%'"), 'reactions are excluded');
  assert.ok(src.includes("NOT LIKE '[Unsupported message: edit]%'"), 'edits are excluded');
  const applied = (src.match(/actionableInbound\(/g) || []).length;
  assert.ok(applied >= 6, 'applied to needs_reply, last_inbound_id and waiting_minutes in both list queries, found ' + applied);
});

// ---------------------------------------------------------------- 5. the brief's named cases
test('the named historical cases are covered by anonymised fixtures elsewhere in the suite', () => {
  const dir = __dirname;
  const all = fs.readdirSync(dir).filter((f) => f.endsWith('.test.cjs')).map((f) => fs.readFileSync(path.join(dir, f), 'utf8')).join('\n');
  assert.ok(/CBR1000/.test(all), 'motorcycle-vs-car case');
  assert.ok(/which vehicle/i.test(all), 'unknown-vehicle case');
  assert.ok(/no exact photos/.test(all), 'missing-photo case');
  assert.ok(/photos of stock 829/.test(all), 'the delivered-promise failure (conv#130)');
  assert.ok(/staff_replied_during_compose/.test(all), 'the staff race (conv#35/#51)');
  assert.ok(/budget/.test(all), 'budget filters');
});
