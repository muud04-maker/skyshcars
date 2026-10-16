// PART 23 — AI-first replies: a 3-5s debounce instead of waiting for the once-a-minute cron.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const load = require('./lib.cjs');
const { REPLY_DEBOUNCE_SECONDS, REPLY_DELAY_SECONDS, NORMAL_REPLY_DELAY_SECONDS, deadlineMs, isDue, countdownLabel, queueStatusLabel, shouldCancelQueued } = load('ai-rules/ai-queue.js');
const { runEngine, customerKey } = load('ai-rules/engine-core.js');
const root = path.join(__dirname, '..', '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const WHATSAPP = 'src/app/api/whatsapp/webhook/route.ts';
const FACEBOOK = 'src/app/api/facebook/webhook/route.ts';

test('1. the normal AI reply is queued for about one minute', () => {
  assert.equal(NORMAL_REPLY_DELAY_SECONDS, 60, 'one minute');
  assert.equal(REPLY_DEBOUNCE_SECONDS, 60, 'scheduling uses the one-minute delay');
  assert.equal(REPLY_DELAY_SECONDS, 60, 'retry/recovery uses the same one-minute delay');
  const t = Date.parse('2026-10-07T10:00:00Z');
  assert.equal(deadlineMs(t, REPLY_DEBOUNCE_SECONDS) - t, REPLY_DEBOUNCE_SECONDS * 1000);
  assert.equal(isDue(deadlineMs(t, REPLY_DEBOUNCE_SECONDS), t + 59000), false, 'not due before the minute');
  assert.equal(isDue(deadlineMs(t, REPLY_DEBOUNCE_SECONDS), t + 60000), true, 'due after the minute');
  assert.equal(isDue(deadlineMs(t, REPLY_DEBOUNCE_SECONDS), t + 90000), true);
});

test('2. the webhook queues one minute ahead; the cron stays the reliable processor', () => {
  for (const f of [WHATSAPP, FACEBOOK]) {
    const src = read(f);
    assert.ok(src.includes('scheduleAiReply(Number(c.id), REPLY_DEBOUNCE_SECONDS'), `${f} schedules the one-minute deadline`);
    assert.ok(src.includes('REPLY_DEBOUNCE_SECONDS * 1000 + 2000'), `${f} only wakes after the delay has passed`);
    assert.ok(src.includes('processDueAiReplies(5)'), `${f} still kicks the worker after the delay`);
  }
  const cron = read('src/app/api/cron/ai-replies/route.ts');
  assert.ok(cron.includes('processDueAiReplies'), 'the cron is the reliable processor');
  assert.ok(cron.includes('AUTOMATION_CRON_SECRET'), 'the cron keeps its secret');
});

test('3. BOTH mode uses the same one-minute queue (mode-independent)', () => {
  const src = read(WHATSAPP);
  assert.ok(!/mode.*REPLY_DEBOUNCE/.test(src), 'the schedule does not depend on the mode');
  assert.ok(read('src/lib/ai-rules/engine-core.ts').includes("['ai', 'both'].includes"), 'BOTH is an AI mode');
  assert.ok(read('src/lib/ai-rules/ai-queue.ts').includes('NORMAL_REPLY_DELAY_SECONDS = 60'), 'one shared delay for AI and BOTH');
});

test('4. TAKE OVER blocks the AI completely', async () => {
  const s = { conv: { id: 1, channel: 'whatsapp', external_user_id: '255700000001', mode: 'human', customer_id: 10 }, messages: [{ id: 1, type: 'text', body: 'hello', sender: 'customer', direction: 'inbound' }], nextId: 2, answered: 0, lock: null, sent: [] };
  const deps = { sleep: async () => {}, now: () => Date.now(), loadConversation: async () => ({ ...s.conv }), tryLock: async () => 'L', unlock: async () => {}, getState: async () => ({ answered_through_id: 0, ai_paused_until: null }), lastAnsweredOutboundId: async () => 0, burst: async () => [{ id: 1, message_type: 'text', body: 'hello', external_message_id: null }], referralIds: async () => new Set(), isFirstContact: async () => true, lastOutboundBody: async () => null, hasNewerCustomerMessage: async () => false, markAnswered: async () => {}, channelReady: () => true, resolveReferral: async () => null, setCurrentCar: async () => {}, holdForStaff: async () => {}, lastStaffBody: async () => null, turnState: async () => ({ lastInboundId: 1, lastOutboundId: 0 }), welcomeConfig: async () => ({ enabled: true, site: 'https://skyshcars.com', groupLink: 'https://chat.whatsapp.com/x', groupName: 'Sky' }), welcomeAlreadySent: async () => true, claimWelcome: async () => false, releaseWelcome: async () => {}, compose: async () => ({ text: 'x', lang: 'en', needsStaff: null }), sendText: async (_c, t) => { s.sent.push(t); return 'w'; }, storeOutbound: async () => {}, sendPhotos: async () => {}, flagStaff: async () => {}, event: async () => {} };
  const r = await runEngine(deps, 1, { trigger: 'sweep' });
  assert.equal(r.reason, 'human_mode');
  assert.equal(s.sent.length, 0);
});

test('5. staff replying before the AI cancels the pending reply', () => {
  assert.deepEqual(shouldCancelQueued({ mode: 'ai', lastInboundId: 10, lastOutboundId: 11 }), { cancel: true, reason: 'staff_replied' });
  assert.ok(read(WHATSAPP).includes('clearAiReply(Number(c.id))'), 'the staff echo clears the queue');
  assert.ok(read('src/app/api/admin/conversations/[id]/reply/route.ts').includes('clearAiReply'));
});

test('6. staff replying AFTER the AI does not cause a second reply', async () => {
  const s = { conv: { id: 1, channel: 'whatsapp', external_user_id: '255700000001', mode: 'ai', customer_id: 10 }, messages: [], nextId: 1, sent: [] };
  const push = (sender, dir) => { const id = s.nextId++; s.messages.push({ id, type: 'text', body: 'x', sender, direction: dir }); return id; };
  push('customer', 'inbound');
  const deps = { sleep: async () => {}, now: () => Date.now(), loadConversation: async () => ({ ...s.conv }), tryLock: async () => 'L', unlock: async () => {}, getState: async () => ({ answered_through_id: s.answered || 0, ai_paused_until: null }), lastAnsweredOutboundId: async () => 0, burst: async (_i, afterId) => s.messages.filter((m) => m.direction === 'inbound' && m.id > afterId).map((m) => ({ id: m.id, message_type: 'text', body: m.body, external_message_id: null })), referralIds: async () => new Set(), isFirstContact: async () => true, lastOutboundBody: async () => null, hasNewerCustomerMessage: async () => false, markAnswered: async (_i, t) => { s.answered = t; }, channelReady: () => true, resolveReferral: async () => null, setCurrentCar: async () => {}, holdForStaff: async () => {}, lastStaffBody: async () => null, turnState: async () => ({ lastInboundId: 1, lastOutboundId: 2 }), welcomeConfig: async () => ({ enabled: true, site: 'https://skyshcars.com', groupLink: 'https://chat.whatsapp.com/x', groupName: 'Sky' }), welcomeAlreadySent: async () => true, claimWelcome: async () => false, releaseWelcome: async () => {}, compose: async () => ({ text: 'second', lang: 'en', needsStaff: null }), sendText: async (_c, t) => { s.sent.push(t); return 'w'; }, storeOutbound: async () => {}, sendPhotos: async () => {}, flagStaff: async () => {}, event: async () => {} };
  const r = await runEngine(deps, 1, { trigger: 'sweep' });
  assert.equal(r.reason, 'waiting_for_customer');
  assert.equal(s.sent.length, 0, 'no duplicate reply for the same turn');
});

test('7. three quick messages merge into ONE reply', async () => {
  const s = { conv: { id: 1, channel: 'whatsapp', external_user_id: '255700000001', mode: 'ai', customer_id: 10 }, messages: [], nextId: 1, sent: [], answered: 0, composed: [] };
  for (const body of ['hello', 'Toyota', 'under 8000']) { const id = s.nextId++; s.messages.push({ id, type: 'text', body, sender: 'customer', direction: 'inbound' }); }
  const deps = { sleep: async () => {}, now: () => Date.now(), loadConversation: async () => ({ ...s.conv }), tryLock: async () => { if (s.lock) return null; s.lock = 'L'; return 'L'; }, unlock: async () => { s.lock = null; }, getState: async () => ({ answered_through_id: s.answered, ai_paused_until: null }), lastAnsweredOutboundId: async () => 0, burst: async (_i, afterId) => s.messages.filter((m) => m.direction === 'inbound' && m.id > afterId).map((m) => ({ id: m.id, message_type: 'text', body: m.body, external_message_id: null })), referralIds: async () => new Set(), isFirstContact: async () => true, lastOutboundBody: async () => null, hasNewerCustomerMessage: async () => false, markAnswered: async (_i, t) => { s.answered = t; }, channelReady: () => true, resolveReferral: async () => null, setCurrentCar: async () => {}, holdForStaff: async () => {}, lastStaffBody: async () => null, turnState: async () => ({ lastInboundId: 3, lastOutboundId: 0 }), welcomeConfig: async () => ({ enabled: true, site: 'https://skyshcars.com', groupLink: 'https://chat.whatsapp.com/x', groupName: 'Sky' }), welcomeAlreadySent: async () => true, claimWelcome: async () => false, releaseWelcome: async () => {}, compose: async (i) => { s.composed.push(i.words); return { text: 'one reply', lang: 'en', needsStaff: null }; }, sendText: async (_c, t) => { s.sent.push(t); return 'w'; }, storeOutbound: async () => {}, sendPhotos: async () => {}, flagStaff: async () => {}, event: async () => {} };
  const r = await runEngine(deps, 1, { trigger: 'sweep' });
  assert.equal(r.status, 'sent');
  assert.equal(s.sent.length, 1, 'exactly one reply');
  assert.equal(s.composed.length, 1);
  for (const w of ['hello', 'Toyota', 'under 8000']) assert.ok(s.composed[0].includes(w), `merged: ${w}`);
});

test('8/9. the cron stays the fallback and cannot duplicate a reply', () => {
  const cron = read('src/app/api/cron/ai-replies/route.ts');
  assert.ok(cron.includes('processDueAiReplies'), 'cron recovers anything missed');
  assert.ok(cron.includes('AUTOMATION_CRON_SECRET'));
  const worker = read('src/lib/ai-queue-worker.ts');
  assert.ok(worker.includes('runReplyEngine'), 'same engine (lock + answered marker) for both runners');
  const engine = read('src/lib/ai-rules/engine-core.ts');
  assert.ok(engine.includes('tryLock(conversationId)') && engine.includes('markAnswered(conversationId, lastId)'), 'duplicate protection');
});

test('10. restart safety: the deadline lives in MySQL', () => {
  assert.ok(read('src/lib/conversation-state.ts').includes('pending_ai_reply_at DATETIME NULL'));
  assert.ok(read('src/lib/ai-queue-worker.ts').includes('s.pending_ai_reply_at <= NOW()'));
  assert.ok(read(WHATSAPP).includes('scheduleAiReply'), 'the webhook writes the durable deadline');
});

test('11. AI Reply Now is still immediate', () => {
  const route = read('src/app/api/admin/conversations/[id]/ai-reply/route.ts');
  assert.ok(route.includes("trigger:'manual',force:true"));
});

test('12/13. new customer message after staff re-arms, and the UI shows the countdown as asked', () => {
  assert.equal(shouldCancelQueued({ mode: 'ai', lastInboundId: 5, lastOutboundId: 4, lastInboundAtMs: Date.now(), lastStaffAtMs: Date.now() - 60000 }).cancel, false);
  assert.equal(countdownLabel(58), 'AI reply in 58s');
  assert.equal(countdownLabel(31), 'AI reply in 31s');
  assert.equal(countdownLabel(0), 'AI reply queued');
  assert.equal(countdownLabel(0, { sending: true }), 'AI sending...');
  assert.equal(queueStatusLabel({ secondsLeft: 58, pending: true }), 'AI reply in 58s');
  assert.equal(queueStatusLabel({ secondsLeft: 0, pending: true }), 'AI reply queued');
  assert.equal(queueStatusLabel({ secondsLeft: 0, pending: true, sending: true }), 'AI sending...');
  assert.equal(queueStatusLabel({ secondsLeft: 0, lastResult: 'failed (attempt 1): meta 470', pending: true }), 'AI reply failed - retrying');
  const desk = read('src/app/admin/_components/ConversationDesk.tsx');
  assert.ok(desk.includes('queueStatusLabel'));
  assert.ok(desk.includes('sending: !!(active && isLocked(active, now))'), 'the desk shows "AI sending..." while the engine works');
});
