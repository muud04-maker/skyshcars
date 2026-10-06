// PART 7  |  inbox helpers (unread, pause/lock countdown, waiting label, filters, message merge, days).
const test = require('node:test');
const assert = require('node:assert/strict');
const load = require('./lib.cjs');
const {
  computeUnread, isPaused, isLocked, pauseSecondsLeft, countdown, waitingLabel,
  filterRows, mergeMessages, maxId, dayKey, dayLabel, deliveryState,
} = load('ai-rules/inbox.js');

const NOW = Date.parse('2026-05-10T12:00:00Z');
const iso = (offsetSeconds) => new Date(NOW + offsetSeconds * 1000).toISOString();

test('PART 7: unread dot only when a customer message is newer than the last read', () => {
  assert.equal(computeUnread({ id: 1, last_inbound_id: 10, last_read_message_id: 5 }), 1);
  assert.equal(computeUnread({ id: 1, last_inbound_id: 10, last_read_message_id: 10 }), 0);
  assert.equal(computeUnread({ id: 1 }), 0);
});

test('PART 7: AI pause countdown', () => {
  const row = { id: 1, ai_paused_until: iso(754) }; // 12:34 left
  assert.equal(isPaused(row, NOW), true);
  assert.equal(pauseSecondsLeft(row, NOW), 754);
  assert.equal(countdown(754), '12:34');
  assert.equal(isPaused({ id: 1, ai_paused_until: iso(-5) }, NOW), false);
  assert.equal(pauseSecondsLeft({ id: 1 }, NOW), 0);
  assert.equal(countdown(59), '0:59');
});

test('PART 7: reply lock state', () => {
  assert.equal(isLocked({ id: 1, lock_until: iso(30) }, NOW), true);
  assert.equal(isLocked({ id: 1, lock_until: iso(-30) }, NOW), false);
  assert.equal(isLocked({ id: 1 }, NOW), false);
});

test('PART 7: waiting label', () => {
  assert.equal(waitingLabel({ id: 1, needs_reply: 1, waiting_minutes: 0 }), 'waiting');
  assert.equal(waitingLabel({ id: 1, needs_reply: 1, waiting_minutes: 9 }), 'waiting 9 min');
  assert.equal(waitingLabel({ id: 1, needs_reply: 1, waiting_minutes: 95 }), 'waiting 1 h 35 min');
  assert.equal(waitingLabel({ id: 1, needs_reply: 0, waiting_minutes: 9 }), '');
});

const ROWS = [
  { id: 1, mode: 'ai', needs_reply: 1, needs_staff: 0, full_name: 'Ahmed', external_user_id: '255701', current_stock_no: 'SC-1001' },
  { id: 2, mode: 'human', needs_reply: 0, needs_staff: 1, full_name: 'Fatima', external_user_id: '255702', preview: 'Prado 2016' },
  { id: 3, mode: 'paused', needs_reply: 0, needs_staff: 0, full_name: '', external_user_id: '255703', preview: 'Vios' },
];

test('PART 7: filters', () => {
  assert.equal(filterRows(ROWS, 'all').length, 3);
  assert.deepEqual(filterRows(ROWS, 'waiting').map((r) => r.id), [1]);
  assert.deepEqual(filterRows(ROWS, 'ai').map((r) => r.id), [1]);
  assert.deepEqual(filterRows(ROWS, 'human').map((r) => r.id), [2]);
  assert.deepEqual(filterRows(ROWS, 'paused').map((r) => r.id), [3]);
  assert.deepEqual(filterRows(ROWS, 'needs_staff').map((r) => r.id), [2]);
});

test('PART 7: search matches name, phone and stock number', () => {
  assert.deepEqual(filterRows(ROWS, 'all', 'fatima').map((r) => r.id), [2]);
  assert.deepEqual(filterRows(ROWS, 'all', '255701').map((r) => r.id), [1]);
  assert.deepEqual(filterRows(ROWS, 'all', 'sc-1001').map((r) => r.id), [1]);
  assert.deepEqual(filterRows(ROWS, 'all', 'prado').map((r) => r.id), [2]);
  assert.deepEqual(filterRows(ROWS, 'all', 'nothing'), []);
});

test('PART 7: a delta batch merges into the thread by id with updates winning', () => {
  const prev = [{ id: 1, body: 'hi', delivery_status: 'sent' }, { id: 2, body: 'hello' }];
  const incoming = [{ id: 2, delivery_status: 'read' }, { id: 3, body: 'new' }];
  const merged = mergeMessages(prev, incoming);
  assert.deepEqual(merged.map((m) => m.id), [1, 2, 3]);
  assert.equal(merged[1].body, 'hello');            // unchanged fields kept
  assert.equal(merged[1].delivery_status, 'read');  // update wins
  assert.equal(maxId(prev), 2);
  assert.equal(maxId(merged), 3);
});

test('PART 7: day separators', () => {
  assert.equal(dayKey('not a date'), '');
  assert.equal(dayLabel(iso(0), NOW), 'Today');
  assert.equal(dayLabel(iso(-86400), NOW), 'Yesterday');
  const older = dayLabel('2026-05-01T08:00:00Z', NOW);
  assert.ok(older && older !== 'Today' && older !== 'Yesterday');
});

test('PART 7: delivery badges and the failure reason', () => {
  assert.equal(deliveryState({ id: 1, direction: 'inbound', delivery_status: 'delivered' }), null);
  assert.equal(deliveryState({ id: 1, direction: 'outbound', delivery_status: 'sent' }).label, 'sent');
  assert.equal(deliveryState({ id: 1, direction: 'outbound', delivery_status: 'read' }).label, 'read');
  const failed = deliveryState({ id: 1, direction: 'outbound', delivery_status: 'failed', delivery_error: 'outside the 24-hour window' });
  assert.equal(failed.label, 'failed');
  assert.equal(failed.tone, 'bad');
  assert.equal(failed.reason, 'outside the 24-hour window');
});
