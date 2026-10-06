// PART 5  |  reply quality: 25-message labelled context and deterministic slot tracking (no repeats).
const test = require('node:test');
const assert = require('node:assert/strict');
const load = require('./lib.cjs');
const { transcriptLines, labelOf, roleOf, CONTEXT_LIMIT } = load('ai-rules/context.js');
const { extractSlots, missingSlots, nextQuestion, SLOT_ORDER } = load('ai-rules/slots.js');

const HINTS = { countries: ['Somalia', 'Kenya', 'Saudi Arabia'], ports: ['Berbera', 'Mombasa'] };

test('PART 5 context: only the last 25 messages are used, labelled and oldest-first', () => {
  const many = Array.from({ length: 40 }, (_v, i) => ({ sender: 'customer', body: 'msg' + i }));
  const lines = transcriptLines(many, CONTEXT_LIMIT);
  assert.equal(lines.length, 25);
  assert.equal(lines[0], '[CUSTOMER] msg15');
  assert.equal(lines[24], '[CUSTOMER] msg39');
});

test('PART 5 context: customer, staff and AI are labelled so staff can override', () => {
  assert.equal(labelOf({ sender: 'customer' }), '[CUSTOMER]');
  assert.equal(labelOf({ sender: 'human' }), '[STAFF]');
  assert.equal(labelOf({ sender: 'staff' }), '[STAFF]');
  assert.equal(labelOf({ sender: 'ai' }), '[AI]');
  assert.equal(labelOf({ sender: 'system' }), '[SYSTEM]');
  const lines = transcriptLines([
    { sender: 'customer', body: 'is the Prado available?' },
    { sender: 'human', body: 'Sorry, the Prado is sold.' },
  ], 25);
  assert.deepEqual(lines, ['[CUSTOMER] is the Prado available?', '[STAFF] Sorry, the Prado is sold.']);
});

test('PART 5 context: the customer is the user role, everyone else is the assistant', () => {
  assert.equal(roleOf({ sender: 'customer' }), 'user');
  assert.equal(roleOf({ sender: 'human' }), 'assistant');
  assert.equal(roleOf({ sender: 'ai' }), 'assistant');
});

test('PART 5 slots: destination, budget, body, steering, fuel and transmission are captured', () => {
  const s = extractSlots('I want an automatic diesel SUV to Somalia, budget 8000', HINTS);
  assert.equal(s.destination, 'Somalia');
  assert.equal(s.budget_usd, 8000);
  assert.equal(s.body_type, 'suv');
  assert.equal(s.fuel, 'diesel');
  assert.equal(s.transmission, 'automatic');
});

test('PART 5 slots: common budget styles and steering are understood', () => {
  assert.equal(extractSlots('my budget is $5,000', HINTS).budget_usd, 5000);
  assert.equal(extractSlots('under 10k please', HINTS).budget_usd, 10000);
  assert.equal(extractSlots('around 12000 usd', HINTS).budget_usd, 12000);
  assert.equal(extractSlots('I need left hand drive', HINTS).steering, 'LHD');
  assert.equal(extractSlots('right-hand drive', HINTS).steering, 'RHD');
});

test('PART 5 slots: a model year is never mistaken for a budget', () => {
  const s = extractSlots('Toyota RAV4 2011', HINTS);
  assert.equal(s.budget_usd, undefined);
});

test('PART 5 slots: new answers merge over what we already knew', () => {
  const first = extractSlots('ship it to Mombasa', HINTS);
  assert.equal(first.destination, 'Mombasa');
  const second = extractSlots('automatic please', HINTS, first);
  assert.equal(second.destination, 'Mombasa');
  assert.equal(second.transmission, 'automatic');
});

test('PART 5 slots: an answered slot is never asked again', () => {
  const s = extractSlots('SUV to Kenya, budget 9000', HINTS);
  const missing = missingSlots(s);
  assert.ok(!missing.includes('destination'));
  assert.ok(!missing.includes('budget_usd'));
  assert.ok(!missing.includes('body_type'));
  assert.equal(missing[0], 'steering');
  assert.equal(nextQuestion(s), 'Do you need left-hand or right-hand drive?');
  assert.deepEqual(SLOT_ORDER.slice(0, 3), ['destination', 'budget_usd', 'body_type']);
});

test('PART 5 slots: nothing known -> the destination is asked first', () => {
  assert.equal(nextQuestion({}), 'Which country or port should we ship to?');
});
