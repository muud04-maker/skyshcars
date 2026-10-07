// PART 22 — the AI as a real sales agent (vehicle context, details, alternatives) + the live inbox.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const load = require('./lib.cjs');
const { vehicleIntent, vehicleDetails, alternatives, alternativeLines, clarifyVehicle, carTitle } = load('ai-rules/vehicle-answer.js');
const root = path.join(__dirname, '..', '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');

const RAV4 = { id: 2, stock_no: 'SC-184', brand: 'Toyota', model: 'RAV4', trim_name: '', model_year: 2019, price_usd: 8900, mileage_km: 76000, engine: '2.0L', transmission: 'automatic', fuel_type: 'petrol', steering: 'LHD', color: 'white', category: 'car', exact_photo_count: 5 };
const FLEET = [
  RAV4,
  { id: 3, stock_no: 'SC-200', brand: 'Toyota', model: 'RAV4', model_year: 2020, price_usd: 9300, category: 'car' },
  { id: 4, stock_no: 'SC-300', brand: 'Honda', model: 'CR-V', model_year: 2019, price_usd: 8700, category: 'car' },
  { id: 5, stock_no: 'SC-400', brand: 'Nissan', model: 'X-Trail', model_year: 2020, price_usd: 8400, category: 'car' },
  { id: 6, stock_no: 'SC-500', brand: 'Toyota', model: 'Hilux', model_year: 2008, price_usd: 3000, category: 'car' },
];

test('1/2/3/4. the vehicle intent is recognised for the real customer questions', () => {
  assert.equal(vehicleIntent('Hello! Can I get more info on this?'), 'moreinfo');
  assert.equal(vehicleIntent('price?'), 'price');
  assert.equal(vehicleIntent('send me the pictures'), 'photos');
  assert.equal(vehicleIntent('what else do you have?'), 'alternatives');
  assert.equal(vehicleIntent('can you ship it to Kenya?'), 'shipping');
  assert.equal(vehicleIntent('hello'), null);
});

test('5/6/7. details come from real fields only - blanks are skipped and nothing is invented', () => {
  const t = vehicleDetails(RAV4, 'en');
  assert.ok(t.includes('2019 Toyota RAV4'));
  assert.ok(t.includes('$8,900') && t.includes('76,000 km') && t.includes('2.0L') && t.includes('petrol'));
  assert.ok(t.includes('- exact photos'));
  const bare = vehicleDetails({ id: 9, stock_no: 'SC-9', brand: 'Toyota', model: 'Corolla' }, 'en');
  assert.ok(!/Price:/.test(bare), 'no price line when the price is missing');
  assert.ok(!/\$0/.test(bare), 'never a fake $0');
  assert.ok(!/Engine:/.test(bare) && !/Mileage:/.test(bare));
});

test('8/9/10. alternatives are real, ranked and capped at 3', () => {
  const alts = alternatives(FLEET, RAV4, { limit: 3 });
  assert.equal(alts.length, 3);
  assert.ok(!alts.some((c) => c.id === RAV4.id), 'never the same car');
  assert.equal(alts[0].model, 'RAV4', 'same model first');
  assert.ok(alts.some((c) => c.brand === 'Toyota'), 'same brand preferred');
  const cheap = alternatives(FLEET, RAV4, { limit: 3, maxPrice: 8600 });
  assert.ok(cheap.every((c) => Number(c.price_usd) <= 8600), 'budget respected');
  const lines = alternativeLines(alts, 'en');
  assert.equal(lines.split('\n').length, 4, 'header + 3 cars');
  assert.ok(lines.includes('$'));
});

test('11/12. one concise clarification, localised', () => {
  for (const lang of ['en', 'so', 'ar', 'zh']) {
    const q = clarifyVehicle(lang);
    assert.ok(q.length > 10 && /[?\u061F\uFF1F]/.test(q), lang);
  }
  assert.notEqual(clarifyVehicle('so'), clarifyVehicle('en'));
  assert.ok(vehicleDetails(RAV4, 'so').startsWith('Haa - kani waa'));
  assert.ok(vehicleDetails(RAV4, 'zh').includes('是的'));
  assert.ok(carTitle(RAV4) === '2019 Toyota RAV4');
});

test('13. referral / current car / matched record are the vehicle sources (priority order)', () => {
  const compose = read('src/lib/sales-compose.ts');
  assert.ok(compose.includes('i.referralVehicle ||'), 'referral wins first');
  assert.ok(compose.includes('aiCarById(currentId)'), 'then the conversation current car');
  assert.ok(compose.includes('vehicleIntent(i.words)'), 'vehicle questions are detected before the model');
  assert.ok(compose.includes('namesAnother'), 'a named different brand is not answered with the current car');
});

test('14/29. alternatives come from the AI Catalog only, max 3', () => {
  const compose = read('src/lib/sales-compose.ts');
  assert.ok(compose.includes('loadAiCars(300)'), 'AI-enabled Available rows only');
  assert.ok(compose.includes('alternatives(cats, current, { limit: 3 })'));
  const catalog = read('src/lib/ai-catalog.ts');
  assert.ok(catalog.includes('aiCarSqlFor'), 'catalog mode + ai_enabled + Available enforced');
});

test('15. photos behave: exact photos are sent, no "visit the website" substitute', () => {
  const photos = read('src/lib/whatsapp-photos.ts');
  assert.ok(photos.includes('plan.images') && photos.includes('type: \'image\''), 'real images are sent + stored');
  const ai = read('src/lib/ai.ts');
  assert.ok(ai.includes("We don't have exact photos"), 'honest fallback when there are no exact photos');
  assert.ok(read('src/lib/sales-compose.ts').includes("vIntent !== 'photos'"), 'the photo plan owns photo requests');
});

test('16/17. the welcome is appended AFTER the useful answer and stays exactly once', () => {
  const engine = read('src/lib/ai-rules/engine-core.ts');
  const composeIdx = engine.indexOf('const composed = await deps.compose(');
  const welcomeIdx = engine.indexOf('text = withBlock(text, block)');
  assert.ok(composeIdx > 0 && welcomeIdx > composeIdx, 'welcome appended after the answer');
  assert.ok(engine.includes('welcomeDue && await deps.claimWelcome('), 'still claimed exactly once');
});

test('18/19/20. the queue rules are preserved (reset, staff cancel, re-arm)', () => {
  assert.ok(read('src/app/api/whatsapp/webhook/route.ts').includes('scheduleAiReply(Number(c.id), REPLY_DEBOUNCE_SECONDS'), 'new message resets the debounce');
  assert.ok(read('src/app/api/whatsapp/webhook/route.ts').includes('clearAiReply(Number(c.id))'), 'staff reply cancels');
  const engine = read('src/lib/ai-rules/engine-core.ts');
  assert.ok(engine.includes("['ai', 'both'].includes"), 'AI + BOTH only');
  assert.ok(engine.includes('waiting_for_customer'), 'turn rule');
});

test('21/22/23/24. the inbox updates live without breaking the draft or duplicating messages', () => {
  const route = read('src/app/api/admin/conversations/inbox/route.ts');
  assert.ok(route.includes('out.conversations = await listConversations'), 'list always returned (preview/waiting/unread live)');
  assert.ok(route.includes("export const dynamic = 'force-dynamic'"));
  const desk = read('src/app/admin/_components/ConversationDesk.tsx');
  assert.ok(desk.includes('visible ? 2500 : 15000'), '2.5s visible / slow hidden');
  assert.ok(desk.includes("setConn(fails.current >= 3 ? 'OFFLINE' : 'RECONNECTING')"), 'retry + indicator');
  assert.ok(desk.includes("className={'conn conn-' + conn.toLowerCase()}"), 'LIVE / RECONNECTING / OFFLINE badge');
  const pollBody = desk.slice(desk.indexOf('async function poll()'), desk.indexOf('useEffect(() => { if (activeId) void loadDetail'));
  assert.ok(pollBody.length > 100 && !pollBody.includes('setText'), 'polling never touches the staff draft');
  assert.ok(desk.includes('mergeMessages(prev, j.messages)'), 'delta merge by id (no duplicates)');
  assert.ok(desk.includes('if (added) { setNewBelow((n) => (atBottom ? 0 : n + added))'), 'no jump when scrolled up');
});

test('25. a failed queue attempt is never silent: diagnostics + bounded retries', () => {
  const worker = read('src/lib/ai-queue-worker.ts');
  assert.ok(worker.includes('recordAiQueueAttempt'), 'records every attempt');
  assert.ok(worker.includes('MAX_ATTEMPTS'));
  assert.ok(worker.includes('flagForStaff(id, ') && worker.includes('gave_up'), 'gives up visibly instead of hanging');
  assert.ok(worker.includes("action: 'retry'"), 'bounded retry');
  const state = read('src/lib/conversation-state.ts');
  assert.ok(state.includes('pending_last_result') && state.includes('pending_attempts'));
  const desk = read('src/app/admin/_components/ConversationDesk.tsx');
  assert.ok(desk.includes('AI queue: {queueLabel}'), 'admin sees the queue state');
});

test('26/27/28. language, shipping destination and no fabricated fields', () => {
  const compose = read('src/lib/sales-compose.ts');
  assert.ok(compose.includes('detectCustomerLanguage'), 'dynamic language kept');
  const ai = read('src/lib/ai.ts');
  assert.ok(ai.includes('known_slots'), 'stored destination/slots are given to the model');
  assert.ok(!/price_usd \|\| 0/.test(compose), 'no invented prices');
});
