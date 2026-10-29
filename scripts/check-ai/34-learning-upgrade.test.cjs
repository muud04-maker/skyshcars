// 120-point upgrade - supervised learning, staff workflow and honest metrics.
// Every case below is derived from the real snapshot (anonymised: ids/counts only, no customer data).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const load = require('./lib.cjs');
const { similarity, detectContradictions, tokensOf, categoryForType, LESSON_CATEGORIES, LEARNING_TYPES } = load('ai-learning.js');
const { taskKey, normalizeTaskStatus, TASK_TYPES, TASK_STATUSES } = load('staff-tasks.js');
const { alternatives } = load('ai-rules/vehicle-answer.js');

const root = path.join(__dirname, '..', '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const LEARNING = 'src/lib/ai-learning.ts';
const TASKS = 'src/lib/staff-tasks.ts';
const COMPOSE = 'src/lib/sales-compose.ts';
const ENGINE = 'src/lib/ai-rules/engine-core.ts';
const UI = 'src/app/admin/ai-learning/AiLearningClient.tsx';
const TASK_UI = 'src/app/admin/staff-tasks/StaffTasksClient.tsx';
const COVERAGE = 'docs/AI_UPGRADE_120_COVERAGE.md';

// ---------------------------------------------------------------- lesson quality
test('lessons carry a category, confidence and evidence (items 30-32)', () => {
  assert.ok(LESSON_CATEGORIES.includes('photos') && LESSON_CATEGORIES.includes('pricing'));
  assert.equal(categoryForType('missing_photo'), 'photos');
  assert.equal(categoryForType('wrong_price'), 'pricing');
  assert.equal(categoryForType('wrong_shipping_answer'), 'shipping');
  assert.equal(categoryForType('wrong_language'), 'language');
  assert.equal(categoryForType('referral_correction'), 'vehicle');
  for (const t of ['missing_photo', 'availability', 'inappropriate_wording', 'objection', 'negotiation']) assert.ok(LEARNING_TYPES.includes(t), `${t} type exists`);
  const src = read(LEARNING);
  assert.ok(src.includes('ADD COLUMN confidence DECIMAL(4,2)'), 'confidence column');
  assert.ok(src.includes('ADD COLUMN category VARCHAR(40)'), 'category column');
  assert.ok(src.includes('ADD COLUMN evidence_ref VARCHAR(191)'), 'evidence column');
  assert.ok(src.includes('ADD COLUMN expires_at DATETIME'), 'expiry column');
});

test('expired lessons stop influencing replies (item 34)', () => {
  const src = read(LEARNING);
  assert.ok(src.includes("AND (expires_at IS NULL OR expires_at > NOW())"), 'retrieval filters expired lessons');
  assert.ok(src.includes('AND undone_at IS NULL'), 'undone lessons are excluded too');
  assert.ok(src.includes('ORDER BY (status=\'applied\') DESC, id DESC'), 'recent/applied lessons come first');
});

test('contradictory lessons are detected, not auto-resolved (item 33)', () => {
  assert.ok(tokensOf('Motorcycle ads must never resolve to a car').length >= 3);
  assert.equal(similarity('answer the price directly', 'answer the price directly'), 1);
  assert.equal(similarity('shipping to Mombasa', 'photos of the interior'), 0);
  const pairs = detectContradictions([
    { id: 1, event_type: 'wrong_vehicle', question: 'Which Honda is this?', lesson: 'For a CBR1000 referral always answer with the CBR1000 motorcycle.' },
    { id: 2, event_type: 'wrong_vehicle', question: 'Which Honda is this?', lesson: 'For a CBR1000 referral answer with the Honda XR-V car instead.' },
    { id: 3, event_type: 'wrong_shipping_answer', question: 'ship to Mombasa', lesson: 'Quote the confirmed Mombasa rate.' },
  ]);
  assert.equal(pairs.length, 1, 'only the contradicting pair is reported');
  assert.equal(pairs[0].a, 1); assert.equal(pairs[0].b, 2);
  assert.ok(pairs[0].similarity > 0.3);
  assert.equal(detectContradictions([{ id: 1, event_type: 'wrong_vehicle', lesson: 'x' }]).length, 0, 'short lessons are ignored');
  assert.ok(read(UI).includes('Contradictory lessons'), 'the admin is warned in the UI');
});

test('an applied lesson can be undone and the knowledge entry it created is deactivated (item 37)', () => {
  const src = read(LEARNING);
  assert.ok(src.includes('export async function undoLearningEvent'), 'undo exists');
  assert.ok(src.includes("ref = `ai_knowledge:${Number(k?.insertId) || ''}`"), 'the exact knowledge id is recorded');
  assert.ok(src.includes("await db().execute('UPDATE ai_knowledge SET active=0 WHERE id=?', [kId])"), 'undo deactivates that entry only');
  assert.ok(src.includes("status='approved'"), 'status returns to approved (stops influencing replies)');
  assert.ok(src.includes('undone_by'), 'the undo is auditable');
  assert.ok(src.includes("reverted = 'referral mapping kept"), 'referral mappings are not silently deleted');
  assert.ok(read(UI).includes('Undo'), 'the button exists');
});

test('a lesson can be evaluated against historical cases before applying (item 38/118)', () => {
  const src = read(LEARNING);
  assert.ok(src.includes('export async function evaluateLearningEvent'), 'evaluation exists');
  assert.ok(src.includes('cases_with_human_correction'), 'counts human-corrected similar cases');
  assert.ok(src.includes('Neither proves correctness'), 'the result is labelled as evidence, not accuracy');
  assert.ok(src.includes('WHERE event_type=? AND question IS NOT NULL'), 'it uses stored cases of the same type');
  assert.ok(read('src/app/api/admin/ai-learning/[id]/route.ts').includes("evaluate') === '1'"), 'the API exposes it');
  assert.ok(read(UI).includes('Historical evaluation'), 'and the UI shows it');
});

// ---------------------------------------------------------------- staff workflow
test('one deduplicated task per request type/chat/stock (items 57/58/87-89)', () => {
  assert.equal(taskKey('photo', 12, 'SC-859'), 'photo:12:SC-859');
  assert.equal(taskKey('photo', 12, 'sc-859'), 'photo:12:SC-859', 'case-insensitive');
  assert.equal(taskKey('photo', 12, 'SC-859'), taskKey('photo', 12, 'SC-859'), 'stable key = no duplicates');
  assert.notEqual(taskKey('photo', 12, 'SC-859'), taskKey('freight', 12, 'SC-859'));
  assert.notEqual(taskKey('photo', 12, 'SC-859'), taskKey('photo', 13, 'SC-859'));
  assert.equal(taskKey('nonsense', 1, 'x').startsWith('follow_up:'), true, 'unknown types fall back safely');
  assert.deepEqual([...TASK_TYPES], ['photo', 'freight', 'sourcing', 'follow_up', 'serious_buyer', 'inventory_review']);
  assert.deepEqual([...TASK_STATUSES], ['pending', 'in_progress', 'done', 'declined']);
  assert.equal(normalizeTaskStatus('DONE'), 'done');
  assert.equal(normalizeTaskStatus('hacked'), 'pending', 'unknown statuses are rejected');
  const src = read(TASKS);
  assert.ok(src.includes('UNIQUE KEY uq_task_dedupe(dedupe_key)'), 'the database enforces the dedupe');
  assert.ok(src.includes('dedupe_key=${closed ? \'NULL\' : \'dedupe_key\'}'), 'closing a task frees the key for a genuinely new request');
  assert.ok(src.includes('handled_by') && src.includes('completed_at'), 'fulfilment is tracked');
});

test('the engine and the composer create real tasks (not just flags)', () => {
  const engine = read(ENGINE);
  assert.ok(engine.includes("type: 'photo'"), 'missing photos create a photo task');
  const compose = read(COMPOSE);
  assert.ok(compose.includes("type: 'serious_buyer'"), 'serious buyers create a task');
  assert.ok(compose.includes("type: 'freight'"), 'freight questions create a task');
  assert.ok(compose.includes("type: 'sourcing'"), 'an unstocked brand creates a sourcing task');
  assert.ok(compose.includes('createTask') && compose.includes('catch'), 'task failures never break a reply');
  assert.ok(read('src/app/admin/staff-tasks/page.tsx').includes("redirect('/admin/login')"), 'the queue page is admin-only');
  assert.ok(read('src/app/api/admin/staff-tasks/route.ts').includes('adminDenied()'), 'the API is admin-only');
  assert.ok(read(TASK_UI).includes('Mark done'), 'staff can complete a task');
});

// ---------------------------------------------------------------- recommendations
test('a rejected vehicle never comes back in alternatives (items 50/78)', () => {
  const fleet = [
    { id: 1, stock_no: 'SC-859', brand: 'Honda', model: 'CBR1000', model_year: 2015, price_usd: 4364, category: 'motorcycle' },
    { id: 2, stock_no: 'SC-860', brand: 'Honda', model: 'CB400', model_year: 2013, price_usd: 2900, category: 'motorcycle' },
    { id: 3, stock_no: 'SC-861', brand: 'Yamaha', model: 'R6', model_year: 2016, price_usd: 6100, category: 'motorcycle' },
  ];
  const all = alternatives(fleet, fleet[0], { limit: 3 });
  assert.equal(all.length, 2, 'both other bikes offered');
  const filtered = alternatives(fleet, fleet[0], { limit: 3, excludeStocks: ['SC-860'] });
  assert.deepEqual(filtered.map((v) => v.stock_no), ['SC-861'], 'the declined bike is never suggested again');
  assert.ok(read(COMPOSE).includes('excludeStocks: await rejectedStocksFor'), 'the reply engine applies the customer\'s rejected list');
  assert.ok(read('src/lib/customer-facts.ts').includes("'rejected_vehicles'"), 'stored as an admin-set fact');
});

// ---------------------------------------------------------------- reporting + coverage
test('the coverage matrix maps all 120 items', () => {
  const doc = read(COVERAGE);
  const numbered = doc.match(/^\|\s*(\d{1,3})\s*\|/gm) || [];
  assert.equal(numbered.length, 120, `expected 120 numbered rows, found ${numbered.length}`);
  for (const status of ['E', 'N', 'P', 'U']) assert.ok(doc.includes(`| ${status} |`), `legend status ${status} used`);
  assert.ok(doc.includes('not** silently claimed as done') || doc.includes('not** silently claimed'), 'unavailable items are called out');
});

test('the 120-point pass does not regress the earlier gates', () => {
  // The suites that pin the previous release must still exist (they run in the same check).
  const dir = __dirname;
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.test.cjs'));
  for (const f of ['25-referral-category.test.cjs', '26-mobile-inbox.test.cjs', '29-all-history.test.cjs', '31-history-integration.test.cjs', '32-photo-integrity.test.cjs', '33-release-hardening.test.cjs']) {
    assert.ok(files.includes(f), `${f} still exists`);
  }
});
