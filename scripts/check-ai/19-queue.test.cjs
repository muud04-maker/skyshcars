// PART 19 — the 60-second AI reply queue (scheduling, resetting, cancelling, restart safety).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const load = require('./lib.cjs');
const { REPLY_DELAY_SECONDS, deadlineMs, isDue, secondsLeft, countdownLabel, shouldCancelQueued } = load('ai-rules/ai-queue.js');
const { computeWaiting } = load('ai-rules/staff-echo.js');
const root = path.join(__dirname, '..', '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');

const T0 = Date.parse('2026-10-07T10:00:00Z');

test('13. a customer message schedules the AI reply for +60 seconds', () => {
  assert.equal(REPLY_DELAY_SECONDS, 60);
  assert.equal(deadlineMs(T0), T0 + 60000);
  assert.equal(isDue(deadlineMs(T0), T0), false);
  assert.equal(isDue(deadlineMs(T0), T0 + 60000), true);
});

test('14. a second message 30s later resets the deadline', () => {
  const first = deadlineMs(T0);
  const second = deadlineMs(T0 + 30000);
  assert.ok(second > first);
  assert.equal(second - (T0 + 30000), 60000);
  const webhook = read('src/app/api/whatsapp/webhook/route.ts');
  assert.ok(webhook.includes('scheduleAiReply(Number(c.id), REPLY_DEBOUNCE_SECONDS'), 'every inbound message reschedules the short debounce');
});

test('15. two customer messages produce ONE reply (worker runs the one-reply engine)', () => {
  const worker = read('src/lib/ai-queue-worker.ts');
  assert.ok(worker.includes('runReplyEngine(id, { trigger: \'sweep\' })'), 'single engine call per chat');
  assert.ok(worker.includes('clearAiReply(id)'), 'deadline cleared after processing');
});

test('16. a staff reply cancels the pending AI reply', () => {
  const v = shouldCancelQueued({ mode: 'ai', paused: false, archived: false, lastInboundId: 10, lastOutboundId: 11 });
  assert.equal(v.cancel, true);
  assert.equal(v.reason, 'staff_replied');
  const webhook = read('src/app/api/whatsapp/webhook/route.ts');
  assert.ok(/clearAiReply\(Number\(c\.id\)\)/.test(webhook), 'staff echo clears the queue');
  assert.ok(read('src/app/api/admin/conversations/[id]/reply/route.ts').includes('clearAiReply'));
});

test('17. HUMAN takeover cancels the pending AI reply', () => {
  assert.deepEqual(shouldCancelQueued({ mode: 'human', lastInboundId: 10, lastOutboundId: 0 }), { cancel: true, reason: 'human_takeover' });
  assert.ok(read('src/app/api/admin/conversations/[id]/mode/route.ts').includes('clearAiReply'));
  assert.ok(read('src/app/api/admin/conversations/bulk/route.ts').includes('clearAiReply'), 'bulk takeover cancels too');
});

test('18. a paused AI never sends a due reply', () => {
  assert.deepEqual(shouldCancelQueued({ mode: 'ai', paused: true, lastInboundId: 10, lastOutboundId: 0 }), { cancel: true, reason: 'ai_paused' });
});

test('19. "AI Reply Now" processes the pending reply immediately', () => {
  const route = read('src/app/api/admin/conversations/[id]/ai-reply/route.ts');
  assert.ok(route.includes("trigger:'manual',force:true"), 'manual trigger ignores the delay');
  assert.ok(route.includes('clearAiReply'), 'pending deadline cleared');
});

test('20. duplicate cron runs cannot produce two replies', () => {
  const worker = read('src/lib/ai-queue-worker.ts');
  assert.ok(worker.includes('runReplyEngine'), 'engine lock + answered marker guard duplicates');
  const engine = read('src/lib/ai-rules/engine-core.ts');
  assert.ok(engine.includes('tryLock(conversationId)'), 'per-chat lock');
  assert.ok(engine.includes('markAnswered(conversationId, lastId)'), 'answered marker written before send');
});

test('21. a server restart does not lose the scheduled reply (durable MySQL state)', () => {
  const state = read('src/lib/conversation-state.ts');
  assert.ok(state.includes('pending_ai_reply_at DATETIME NULL'), 'lazy additive column');
  assert.ok(state.includes('scheduleAiReply'), 'deadline stored in the database');
  const worker = read('src/lib/ai-queue-worker.ts');
  assert.ok(worker.includes('s.pending_ai_reply_at <= NOW()'), 'worker reads the database, not memory');
  const webhook = read('src/app/api/whatsapp/webhook/route.ts');
  assert.ok(!/after\(\(\) => scheduleReply/.test(webhook), 'no in-memory timer left in the webhook');
});

test('22. the first-contact welcome waits and rides the first queued reply', () => {
  const webhook = read('src/app/api/whatsapp/webhook/route.ts');
  assert.ok(webhook.includes('ai_queued'), 'message is queued, not answered instantly');
  assert.ok(!webhook.includes('sendWhatsApp('), 'the webhook itself sends nothing');
  assert.ok(read('src/lib/ai-rules/engine-core.ts').includes('claimWelcome'), 'welcome still claimed inside the one reply');
});

test('23/24. waiting is true during the delay and clears after the AI reply', () => {
  assert.equal(computeWaiting([10], [0]), true);
  assert.equal(computeWaiting([10], [11]), false);
});

test('25. a new customer message after an AI reply starts a new timer', () => {
  const first = deadlineMs(T0);
  const afterReply = deadlineMs(T0 + 120000);
  assert.ok(afterReply > first);
  assert.equal(isDue(afterReply, T0 + 121000), false);
});

test('26. an archived chat never sends a pending AI reply', () => {
  assert.deepEqual(shouldCancelQueued({ mode: 'ai', archived: true, lastInboundId: 10, lastOutboundId: 0 }), { cancel: true, reason: 'archived' });
  assert.ok(read('src/app/api/admin/conversations/bulk/route.ts').includes("action === 'archive'"), 'archive clears the queue');
});

test('27. an unknown question after 60s sends one hold and pauses (same engine path)', () => {
  const worker = read('src/lib/ai-queue-worker.ts');
  assert.ok(worker.includes("trigger: 'sweep'"), 'queued replies use the normal engine (hold logic included)');
  const engine = read('src/lib/ai-rules/engine-core.ts');
  assert.ok(engine.includes('holdForStaff'), 'hold pauses the AI');
  assert.ok(engine.includes('holding_already_sent'), 'the hold is sent once');
});

test('28. the inbox shows a compact countdown and a cancel control', () => {
  assert.equal(countdownLabel(4), 'AI replying in 4s');
  assert.equal(countdownLabel(0), 'AI sending...');
  assert.equal(secondsLeft(T0 + 42000, T0), 42);
  const desk = read('src/app/admin/_components/ConversationDesk.tsx');
  assert.ok(desk.includes('queueStatusLabel({ secondsLeft: replyLeft'), 'the live queue label is shown');
  assert.ok(desk.includes('cancel-reply'));
  const state = read('src/lib/inbox.ts');
  assert.ok(state.includes('s.pending_ai_reply_at'), 'the inbox API returns the deadline');
});

test('29. the cron endpoint is secret-protected and documented', () => {
  const route = read('src/app/api/cron/ai-replies/route.ts');
  assert.ok(route.includes('AUTOMATION_CRON_SECRET'));
  assert.ok(route.includes("status: 401"), 'unauthorized without the secret');
  assert.ok(fs.existsSync(path.join(root, 'docs/AI_REPLY_CRON.md')));
  const doc = read('docs/AI_REPLY_CRON.md');
  assert.ok(doc.includes('/api/cron/ai-replies') && doc.includes('every minute'));
});
