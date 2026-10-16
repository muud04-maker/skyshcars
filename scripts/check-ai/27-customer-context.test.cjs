// PART 2/3/4/13/14/15 (continuation) - the AI must know WHO the customer is, remember what they said,
// and keep their full history in one place without leaking it to anyone else.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const load = require('./lib.cjs');
const { extractFacts, looksSensitive, preferencesFromFacts, FACT_KEYS } = load('customer-facts.js');
const { buildContextPack, compactMessages, preferencesLine, CONTEXT_ORDER, DEFAULT_RECENT_MESSAGES } = load('ai-rules/context-pack.js');
const { countdownLabel, NORMAL_REPLY_DELAY_SECONDS } = load('ai-rules/ai-queue.js');

const root = path.join(__dirname, '..', '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const HINTS = { brands: ['Toyota', 'Honda', 'Yamaha'], countries: ['Somalia', 'Kenya'], ports: ['Berbera', 'Mombasa'] };

// ---------------------------------------------------------------- memory extraction
test('8. customer memory saves the brand they asked for', () => {
  const facts = extractFacts('I want Toyota under $8000', HINTS);
  const brand = facts.find((f) => f.fact_key === 'preferred_brand');
  assert.ok(brand, 'brand stored');
  assert.equal(brand.fact_value, 'Toyota');
  assert.ok(brand.confidence >= 0.8, 'confidence recorded');
  assert.match(brand.evidence, /toyota/i, 'traceable to the customer wording');
});

test('9. customer memory saves the budget', () => {
  const facts = extractFacts('I want Toyota under $8000', HINTS);
  const budget = facts.find((f) => f.fact_key === 'budget_max');
  assert.equal(budget.fact_value, '8000');
  assert.equal(extractFacts('budget is 12,500 USD', HINTS).find((f) => f.fact_key === 'budget_max').fact_value, '12500');
  assert.equal(extractFacts('max 9k', HINTS).find((f) => f.fact_key === 'budget_max').fact_value, '9000');
});

test('12. destination is remembered and reused', () => {
  const facts = extractFacts('Ship to Mombasa please', HINTS);
  assert.equal(facts.find((f) => f.fact_key === 'destination_port').fact_value, 'Mombasa');
  assert.equal(facts.find((f) => f.fact_key === 'shipping_needed').fact_value, 'yes');
  const prefs = preferencesFromFacts([{ fact_key: 'preferred_category', fact_value: 'motorcycle' }, { fact_key: 'budget_max', fact_value: '5000' }, { fact_key: 'destination_port', fact_value: 'Mombasa' }]);
  const line = preferencesLine(prefs);
  assert.ok(line.includes('motorcycle') && line.includes('max $5,000') && line.includes('to Mombasa'), line);
});

test('the category of vehicle they want is remembered', () => {
  assert.equal(extractFacts('I need motorcycle', HINTS).find((f) => f.fact_key === 'preferred_category').fact_value, 'motorcycle');
  assert.equal(extractFacts('looking for an SUV', HINTS).find((f) => f.fact_key === 'preferred_category').fact_value, 'car');
  assert.equal(extractFacts('automatic diesel LHD', HINTS).find((f) => f.fact_key === 'transmission').fact_value, 'automatic');
});

test('10. a new value supersedes the old one (one row per fact per customer)', () => {
  const src = read('src/lib/customer-facts.ts');
  assert.ok(src.includes('UNIQUE KEY uq_customer_fact(customer_id,fact_key)'), 'one row per customer+fact');
  assert.ok(src.includes('ON DUPLICATE KEY UPDATE fact_value=VALUES(fact_value)'), 'the new value wins');
  assert.ok(src.includes('INSERT INTO customer_fact_events'), 'the change is logged (traceable)');
  assert.ok(src.includes('action,source,changed_by'), 'who changed it is recorded');
  const before = extractFacts('under $8000', HINTS).find((f) => f.fact_key === 'budget_max').fact_value;
  const after = extractFacts('my budget changed to $10,000', HINTS).find((f) => f.fact_key === 'budget_max').fact_value;
  assert.equal(before, '8000'); assert.equal(after, '10000');
});

test('13. memory is per customer: one customer can never see another customer\'s facts', () => {
  const src = read('src/lib/customer-facts.ts');
  for (const q of ['WHERE customer_id=? AND fact_key=?', 'WHERE customer_id=? AND active=1', 'WHERE customer_id=? ORDER BY id DESC']) {
    assert.ok(src.includes(q), `fact queries are scoped by customer_id: ${q}`);
  }
  assert.ok(!/SELECT[^`]*FROM customer_facts WHERE fact_key=\?[^`]*LIMIT/.test(src), 'no query reads a fact without the customer');
  // The learning/history APIs always take the customer from the conversation, never from the request body.
  assert.ok(read('src/app/api/admin/ai-learning/route.ts').includes('SELECT customer_id FROM conversations WHERE id=?'), 'customer resolved server-side');
  assert.ok(!read('src/app/api/admin/ai-learning/route.ts').includes('b.customer_id'), 'a body cannot choose the customer');
  assert.ok(read('src/lib/customer-context.ts').includes('WHERE c.customer_id=?'), 'history is scoped by customer');
});

test('memory never stores passwords, cards or bank details', () => {
  assert.equal(looksSensitive('my card number is 4111 1111 1111 1111'), true);
  assert.equal(looksSensitive('the password is hunter2'), true);
  assert.equal(looksSensitive('send the bank account details'), true);
  assert.equal(looksSensitive('I want Toyota under $8000'), false);
  assert.deepEqual(extractFacts('my card number is 4111 1111 1111 1111', HINTS), [], 'nothing is stored from sensitive text');
  assert.ok(FACT_KEYS.length >= 10 && !FACT_KEYS.some((k) => /password|card|cvv|secret/i.test(k)), 'no sensitive keys exist');
});

// ---------------------------------------------------------------- context order + compaction
test('6/13. context is assembled in the required order', () => {
  assert.deepEqual(CONTEXT_ORDER, ['latest_turn', 'referral', 'current_vehicle', 'recent_history', 'memory_preferences', 'catalog_facts', 'business_knowledge', 'shipping_quote_facts', 'approved_lessons']);
  const pack = buildContextPack({
    latestTurn: 'what else?',
    referral: { vehicle: { id: 1 }, method: 'headline' },
    currentVehicle: { id: 1, stock_no: 'SC-859' },
    recentMessages: [{ sender: 'customer', body: 'hi' }],
    summary: 'Customer from a CBR1000 ad.',
    facts: [{ fact_key: 'preferred_category', fact_value: 'motorcycle' }],
    catalogCount: 12,
    knowledge: [{ title: 'Shipping', content: 'We ship to Mombasa.' }],
    shipping: { country: 'Kenya' },
    lessons: [{ lesson: 'Motorcycle ads never resolve to cars.' }],
  });
  assert.deepEqual(pack.present, [...CONTEXT_ORDER], 'every section present in the fixed order');
  assert.equal(pack.size.recent, 1);
  assert.ok(pack.prefsLine.includes('motorcycle'));
});

test('14. compaction keeps the newest messages and counts what it left out', () => {
  const many = Array.from({ length: 80 }, (_v, i) => ({ sender: 'customer', body: 'm' + i }));
  const { kept, dropped } = compactMessages(many, DEFAULT_RECENT_MESSAGES);
  assert.equal(kept.length, DEFAULT_RECENT_MESSAGES);
  assert.equal(dropped, 80 - DEFAULT_RECENT_MESSAGES);
  assert.equal(kept[kept.length - 1].body, 'm79', 'the newest message is always kept');
  const capped = compactMessages(many, 500);
  assert.ok(capped.kept.length <= 40, 'the window is bounded');
  const src = read('src/lib/ai.ts');
  assert.ok(src.includes('buildContextPack({'), 'the reply engine uses the pack');
  assert.ok(src.includes('pack.recent.length ? pack.recent : past.slice(-CONTEXT_LIMIT)'), 'the model gets the compacted window');
});

test('17. compaction never deletes the stored history', () => {
  for (const f of ['src/lib/ai.ts', 'src/lib/customer-memory.ts', 'src/lib/customer-context.ts']) {
    const src = read(f);
    assert.ok(!/DELETE\s+FROM\s+messages/i.test(src), `${f} must never delete messages`);
  }
  assert.ok(read('src/lib/customer-context.ts').includes('FROM messages m JOIN conversations c'), 'the full timeline is still read from MySQL');
});

// ---------------------------------------------------------------- history + summary
test('14/15. one timeline holds inbound, AI and staff messages for every channel', () => {
  const src = read('src/lib/customer-context.ts');
  assert.ok(src.includes('m.sender,m.direction'), 'the sender of every message is kept');
  assert.ok(src.includes("kind: 'message'"), 'messages become timeline events');
  for (const kind of ['system', 'referral', 'memory', 'note', 'quote']) assert.ok(src.includes(`kind: '${kind}'`), `timeline includes ${kind} events`);
  assert.ok(src.includes('opts.channels') && src.includes('wanted.includes(String(m.channel))'), 'a channel filter is supported');
  assert.ok(src.includes('WHERE c.customer_id=?'), 'never merges two customers');
  assert.ok(src.includes('ORDER BY m.id DESC LIMIT'), 'the newest events are read first (bounded)');
});

test('16. a conversation summary is kept per customer and shown to the admin', () => {
  const mem = read('src/lib/customer-memory.ts');
  assert.ok(mem.includes('summary TEXT NULL'), 'customer_memory keeps the summary (reused, not duplicated)');
  assert.ok(mem.includes('refreshCustomerMemory'), 'it is refreshed from the real transcript');
  assert.ok(read('src/lib/customer-context.ts').includes('memory.summary'), 'the 360 view exposes it to admin only');
  assert.ok(!read('src/lib/customer-context.ts').includes('public'), 'nothing here is public');
});

test('11. stored preferences are given to the reply engine and never asked again', () => {
  const ai = read('src/lib/ai.ts');
  assert.ok(ai.includes('customer_preferences'), 'preferences are passed as real facts');
  assert.ok(ai.includes('factsForCustomer(customerId)'), 'they come from the stored memory');
  assert.ok(ai.includes('never ask for these again'), 'the model is told not to re-ask');
  assert.ok(ai.includes('extractFacts(text'), 'facts are learned from the customer\'s own words');
  assert.ok(ai.includes("source: 'customer_message'"), 'and attributed to the customer message, never to AI assumptions');
});

test('1/2. the one-minute queue is unchanged by this work and resets on every message', () => {
  assert.equal(NORMAL_REPLY_DELAY_SECONDS, 60);
  assert.equal(countdownLabel(58), 'AI reply in 58s');
  const state = read('src/lib/conversation-state.ts');
  assert.ok(state.includes('pending_ai_reply_at=(NOW() + INTERVAL ? SECOND)'), 'each message moves the durable deadline forward');
  assert.ok(read('src/app/api/whatsapp/webhook/route.ts').includes('scheduleAiReply(Number(c.id), REPLY_DEBOUNCE_SECONDS'), 'whatsapp reschedules per message');
  assert.ok(read('src/app/api/facebook/webhook/route.ts').includes('scheduleAiReply(Number(c.id), REPLY_DEBOUNCE_SECONDS'), 'facebook reschedules per message');
});

// ---------------------------------------------------------------- privacy (Part 16)
test('30. nothing about a customer is exposed publicly', () => {
  for (const f of ['src/app/api/admin/customer-history/route.ts', 'src/app/api/admin/customer-history/[id]/route.ts', 'src/app/api/admin/ai-learning/route.ts', 'src/app/api/admin/ai-learning/[id]/route.ts']) {
    assert.ok(read(f).includes('adminDenied()'), `${f} is admin-only`);
  }
  assert.ok(read('src/app/admin/customer-history/page.tsx').includes("redirect('/admin/login')"), 'history page requires login');
  assert.ok(read('src/app/admin/ai-learning/page.tsx').includes("redirect('/admin/login')"), 'learning page requires login');
  // No public route may read customer memory, learning events, notes or message bodies.
  const publicDirs = ['src/app/api/vehicles/route.ts', 'src/app/api/quote/route.ts', 'src/app/api/tracking/[ref]/route.ts', 'src/app/api/health/route.ts'];
  for (const f of publicDirs) {
    const src = read(f);
    assert.ok(!/customer_facts|ai_learning_events|staff_notes|customer_memory/.test(src), `${f} must not touch private customer data`);
  }
  assert.ok(!read('src/lib/customer-context.ts').includes('export async function customer360') === false, 'the 360 helper exists');
});
