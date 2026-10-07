// PART 21 — AI / TAKE OVER / BOTH modes with turn-based blocking (no timer-based AI wake-up).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const load = require('./lib.cjs');
const { runEngine, customerKey } = load('ai-rules/engine-core.js');
const { shouldCancelQueued, REPLY_DELAY_SECONDS, deadlineMs, isDue } = load('ai-rules/ai-queue.js');
const root = path.join(__dirname, '..', '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');

const SITE = 'https://skyshcars.com';
const GROUP = 'https://chat.whatsapp.com/EyGQRCZmdyhKUnXD2H1bIq?s=cl&p=a&mlu=4&ilr=4';

function makeStore(extra = {}) {
  return {
    conv: { id: 1, channel: 'whatsapp', external_user_id: '255700000001', mode: 'ai', customer_id: 10 },
    messages: [], nextId: 1, answered: 0, pausedUntil: null, lock: null, welcomes: new Set([customerKey('whatsapp', '255700000001')]),
    sent: [], turn: null, ...extra,
  };
}
function makeDeps(s) {
  const inbound = () => s.messages.filter((m) => m.direction === 'inbound');
  const outbound = () => s.messages.filter((m) => m.direction === 'outbound' && ['ai', 'human'].includes(String(m.sender)));
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
    holdForStaff: async () => {}, lastStaffBody: async () => null,
    // turn state from the fake message list (mirrors the SQL in sales-engine)
    turnState: async () => ({
      lastInboundId: Math.max(0, ...inbound().map((m) => m.id)),
      lastOutboundId: Math.max(0, ...outbound().map((m) => m.id)),
      lastInboundAtMs: Math.max(0, ...inbound().map((m) => Number(m.at || 0))),
      lastStaffAtMs: Math.max(0, ...s.messages.filter((m) => m.sender === 'human').map((m) => Number(m.at || 0))),
    }),
    welcomeConfig: async () => ({ enabled: true, site: SITE, groupLink: GROUP, groupName: 'Sky second hand cars' }),
    welcomeAlreadySent: async (key) => s.welcomes.has(key),
    claimWelcome: async (key) => { if (s.welcomes.has(key)) return false; s.welcomes.add(key); return true; },
    releaseWelcome: async () => {},
    compose: async () => ({ text: 'Yes, we have Toyota available.', lang: 'en', model: 'deepseek-chat', photoPlan: null, allowedNames: ['Toyota Corolla'], needsStaff: null }),
    sendText: async (_c, text) => { s.sent.push(text); return 'wamid.out'; },
    storeOutbound: async (_i, text) => { s.messages.push({ id: s.nextId++, type: 'text', body: text, sender: 'ai', direction: 'outbound' }); },
    sendPhotos: async () => {}, flagStaff: async () => {}, event: async () => {},
  };
}
function inbound(s, body, at = Date.now()) { const id = s.nextId++; s.messages.push({ id, type: 'text', body, sender: 'customer', direction: 'inbound', at }); return id; }
function human(s, body, at = Date.now()) { const id = s.nextId++; s.messages.push({ id, type: 'text', body, sender: 'human', direction: 'outbound', at }); return id; }

test('1. AI mode: a customer message schedules the 60s AI reply (nothing sent instantly)', () => {
  assert.equal(REPLY_DELAY_SECONDS, 60);
  const webhook = read('src/app/api/whatsapp/webhook/route.ts');
  assert.ok(webhook.includes('scheduleAiReply(Number(c.id), REPLY_DELAY_SECONDS'), 'inbound queues the reply');
  assert.ok(!webhook.includes('sendWhatsApp('), 'the webhook never sends a reply itself');
});

test('2. a staff reply cancels the pending AI reply', () => {
  assert.equal(shouldCancelQueued({ mode: 'ai', lastInboundId: 5, lastOutboundId: 6 }).reason, 'staff_replied');
  assert.ok(read('src/app/api/whatsapp/webhook/route.ts').includes('clearAiReply(Number(c.id))'), 'staff echo cancels');
  assert.ok(read('src/app/api/admin/conversations/[id]/reply/route.ts').includes('clearAiReply'));
});

test('3. the AI stays silent after a staff reply (turn rule)', async () => {
  const s = makeStore(); inbound(s, 'Do you have Toyota?'); human(s, 'Yes, we have Toyota available.');
  const r = await runEngine(makeDeps(s), 1, { trigger: 'sweep' });
  assert.equal(r.status, 'skipped');
  assert.equal(r.reason, 'waiting_for_customer');
  assert.equal(s.sent.length, 0);
});

test('4/5. 15 minutes or 2 hours passing never reactivates the AI', async () => {
  for (const minutes of [15, 120]) {
    const s = makeStore({ pausedUntil: null }); inbound(s, 'Do you have Toyota?'); human(s, 'We sold it.');
    // time passes: the deadline would have been long due, the pause (if any) long expired
    const r = await runEngine(makeDeps(s), 1, { trigger: 'sweep' });
    assert.equal(r.reason, 'waiting_for_customer', `${minutes} min later`);
    assert.equal(s.sent.length, 0);
  }
  // and the cron no longer auto-resumes by timer
  const cron = read('src/app/api/cron/automation/route.ts');
  assert.ok(!cron.includes('sweepDuePauses'), 'no timer-based resume in the cron');
});

test('6. a NEW customer message re-arms the AI', async () => {
  const s = makeStore(); inbound(s, 'Do you have Toyota?'); human(s, 'Yes, we have Toyota available.');
  inbound(s, 'Send me pictures.'); // customer speaks again -> newest message is the customer's
  const r = await runEngine(makeDeps(s), 1, { trigger: 'sweep' });
  assert.equal(r.status, 'sent');
  assert.equal(s.sent.length, 1);
});

test('7/8. TAKE OVER cancels the pending reply and blocks all automatic AI', async () => {
  assert.deepEqual(shouldCancelQueued({ mode: 'human', lastInboundId: 5, lastOutboundId: 0 }), { cancel: true, reason: 'human_takeover' });
  const s = makeStore({ conv: { id: 1, channel: 'whatsapp', external_user_id: '255700000001', mode: 'human', customer_id: 10 } });
  inbound(s, 'Do you have Toyota?');
  const r = await runEngine(makeDeps(s), 1, { trigger: 'sweep' });
  assert.equal(r.reason, 'human_mode');
  assert.equal(s.sent.length, 0);
  assert.ok(read('src/app/api/admin/conversations/[id]/mode/route.ts').includes('clearAiReply'), 'Take Over clears the queue');
});

test('9/10. Return to AI does not answer the old turn and waits for the customer', () => {
  const route = read('src/app/api/admin/conversations/[id]/mode/route.ts');
  assert.ok(!route.includes('runReplyEngine'), 'no catch-up reply on mode change');
  assert.ok(route.includes('Waiting for the next customer message.'), 'UI copy states the behaviour');
  const s = makeStore(); inbound(s, 'Do you have Toyota?'); human(s, 'Staff already answered.');
  return runEngine(makeDeps(s), 1, { trigger: 'catch_up' }).then((r) => {
    assert.equal(r.reason, 'waiting_for_customer');
    assert.equal(s.sent.length, 0);
  });
});

test('11. AI Reply Now can answer the current turn (explicit override)', async () => {
  const s = makeStore(); inbound(s, 'Do you have Toyota?'); human(s, 'Staff answered first.');
  const forced = await runEngine(makeDeps(s), 1, { trigger: 'manual', force: true });
  assert.equal(forced.status, 'sent');
  assert.equal(s.sent.length, 1);
  const route = read('src/app/api/admin/conversations/[id]/ai-reply/route.ts');
  assert.ok(route.includes("trigger:'manual',force:true"));
});

test('12/13/14. BOTH schedules the AI, a staff reply cancels it and blocks until the customer speaks', async () => {
  const both = makeStore({ conv: { id: 1, channel: 'whatsapp', external_user_id: '255700000001', mode: 'both', customer_id: 10 } });
  inbound(both, 'Do you have Toyota?');
  const first = await runEngine(makeDeps(both), 1, { trigger: 'sweep' });
  assert.equal(first.status, 'sent', 'BOTH lets the AI answer');
  const s = makeStore({ conv: { id: 1, channel: 'whatsapp', external_user_id: '255700000001', mode: 'both', customer_id: 10 } });
  inbound(s, 'Do you have Toyota?'); human(s, 'Yes we do.');
  const r = await runEngine(makeDeps(s), 1, { trigger: 'sweep' });
  assert.equal(r.reason, 'waiting_for_customer');
  assert.equal(s.sent.length, 0);
});

test('15. never a double human + AI reply for the same customer turn', async () => {
  const s = makeStore(); inbound(s, 'Do you have Toyota?'); human(s, 'Yes we do.');
  assert.equal(shouldCancelQueued({ mode: 'ai', lastInboundId: 1, lastOutboundId: 2 }).cancel, true);
  const r = await runEngine(makeDeps(s), 1, { trigger: 'sweep' });
  assert.equal(r.status, 'skipped');
  assert.equal(s.sent.length, 0);
});

test('16. the mode + turn state live in MySQL (survives a restart)', () => {
  const state = read('src/lib/conversation-state.ts');
  assert.ok(state.includes("ENUM('ai','human','paused','both')"), 'mode column includes both');
  assert.ok(state.includes('pending_ai_reply_at'), 'the queue is durable');
  const engine = read('src/lib/ai-rules/engine-core.ts');
  assert.ok(engine.includes("['ai', 'both'].includes"), 'AI answers in ai + both');
  assert.ok(engine.includes('turnState'), 'turn rule uses message ids, not memory');
});

test('17/18/19. bulk Take Over / Return to AI / Set Both use the same behaviour', () => {
  const bulk = read('src/app/api/admin/conversations/bulk/route.ts');
  for (const a of ["'human'", "'ai'", "'both'"]) assert.ok(bulk.includes(a), `bulk action ${a}`);
  assert.ok(bulk.includes("mode='human',takeover_by='admin'"), 'bulk take over');
  assert.ok(bulk.includes("const target = action === 'both' ? 'both' : 'ai'"), 'bulk return/both');
  assert.ok(bulk.includes('clearAiReply'), 'bulk cancels queued replies');
  const desk = read('src/app/admin/_components/ConversationDesk.tsx');
  assert.ok(desk.includes("bulk('human')") && desk.includes("bulk('ai')") && desk.includes("bulk('both')"));
});

test('20. the header has ONE compact mode control (AI / TAKE OVER / BOTH)', () => {
  const desk = read('src/app/admin/_components/ConversationDesk.tsx');
  assert.ok(desk.includes('className="modeSeg"'), 'segmented control');
  assert.ok(desk.includes('>AI</button>') && desk.includes('>TAKE OVER</button>') && desk.includes('>BOTH</button>'));
  assert.ok(!desk.includes('modeNotice'), 'the old yellow mode strip is gone');
  assert.ok(!/<select value=\{active\.mode/.test(desk), 'no duplicate mode dropdown');
  assert.ok(desk.includes('AI Reply Now') && desk.includes('Return to AI'));
  assert.ok(desk.includes('Pause AI for 15 min'), 'pause is confined to the More menu');
  const css = read('src/app/inbox.css');
  assert.ok(css.includes('.modeSeg'));
});

test('21. a staff PAUSE silences only the answered turn, not the next customer message', async () => {
  const T = Date.now();
  const s = makeStore({ pausedUntil: new Date(T + 10 * 60 * 1000) });   // staff pause still running
  inbound(s, 'Do you have Toyota?', T);
  human(s, 'Yes, we have Toyota available.', T + 1000);                // staff answered this turn
  inbound(s, 'Send me pictures of it.', T + 3 * 60 * 1000);            // customer speaks again (inside 15 min)
  const r = await runEngine(makeDeps(s), 1, { trigger: 'sweep' });
  assert.equal(r.status, 'sent', 'a new customer message re-arms the AI even while a staff pause runs');
  assert.equal(s.sent.length, 1);
});

test('22. a staff pause DOES silence the turn the human answered', async () => {
  const T = Date.now();
  const s = makeStore({ pausedUntil: new Date(T + 10 * 60 * 1000) });
  inbound(s, 'Do you have Toyota?', T);
  human(s, 'Yes, we have Toyota available.', T + 1000);
  const r = await runEngine(makeDeps(s), 1, { trigger: 'sweep' });
  assert.ok(['ai_paused', 'waiting_for_customer'].includes(r.reason));
  assert.equal(s.sent.length, 0);
});

test('23. the queue worker applies the same pause rule', () => {
  const now = Date.now();
  // customer spoke AFTER the staff reply -> the queued AI reply must NOT be cancelled
  assert.equal(shouldCancelQueued({ mode: 'ai', paused: true, lastInboundId: 3, lastOutboundId: 2, lastInboundAtMs: now, lastStaffAtMs: now - 5 * 60 * 1000 }).cancel, false);
  // no customer message since the staff reply -> cancelled
  assert.deepEqual(shouldCancelQueued({ mode: 'ai', paused: true, lastInboundId: 1, lastOutboundId: 2, lastInboundAtMs: now - 5 * 60 * 1000, lastStaffAtMs: now }), { cancel: true, reason: 'ai_paused' });
  // and with no pause at all, a staff reply still silences the turn
  assert.equal(shouldCancelQueued({ mode: 'ai', paused: false, lastInboundId: 1, lastOutboundId: 2 }).reason, 'staff_replied');
});
