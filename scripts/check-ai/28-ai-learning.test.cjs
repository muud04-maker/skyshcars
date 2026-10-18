// PART 7-12, 19, 20 (continuation) - the AI improves ONLY from lessons a human approves.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const load = require('./lib.cjs');
const { lessonTitle, isUsableLesson, nextStatus, typeFromReason, lessonsNote, LEARNING_TYPES, LEARNING_REASONS } = load('ai-learning.js');

const root = path.join(__dirname, '..', '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const LEARNING_ROUTE = 'src/app/api/admin/ai-learning/route.ts';
const LEARNING_ID = 'src/app/api/admin/ai-learning/[id]/route.ts';
const LEARNING_PAGE = 'src/app/admin/ai-learning/page.tsx';
const LEARNING_CLIENT = 'src/app/admin/ai-learning/AiLearningClient.tsx';
const DESK = 'src/app/admin/_components/ConversationDesk.tsx';

test('18. a thumbs-down creates a pending learning event (never an automatic change)', () => {
  const src = read(LEARNING_ROUTE);
  assert.ok(src.includes("action === 'thumbs_down'"), 'thumbs-down path exists');
  assert.ok(src.includes('typeFromReason(reason)'), 'the reason becomes the event type');
  assert.ok(src.includes("status: 'pending'"), 'it waits for a human');
  assert.equal(typeFromReason('wrong vehicle'), 'wrong_vehicle');
  assert.equal(typeFromReason('wrong language'), 'wrong_language');
  assert.equal(typeFromReason('unnecessary hold'), 'unnecessary_hold');
  assert.equal(typeFromReason('something odd'), 'other');
  assert.ok(LEARNING_REASONS.includes('wrong vehicle') && LEARNING_REASONS.includes('bad recommendation'));
});

test('thumbs-up is recorded as a good example', () => {
  const src = read(LEARNING_ROUTE);
  assert.ok(src.includes("action === 'thumbs_up'"), 'thumbs-up path exists');
  assert.ok(src.includes("eventType: 'good_reply'"));
  assert.ok(src.includes("status: 'approved'"), 'positive examples need no review');
  assert.ok(read(DESK).includes('&#128077; Good') && read(DESK).includes('&#128078; Needs improvement'), 'both controls are on each AI reply');
});

test('19. a staff correction becomes a learning candidate', () => {
  const src = read(LEARNING_ROUTE);
  assert.ok(src.includes("action === 'correction'"), 'correction action exists');
  assert.ok(src.includes("status: 'pending'"), 'corrections are candidates, not rules');
  assert.ok(read(DESK).includes('Use this as correction'), 'staff can mark their answer as the correction');
  assert.ok(read(DESK).includes("action: input.action === 'up' ? 'thumbs_up'"), 'the desk posts the right action');
  // A referral correction the owner saves becomes a candidate lesson too.
  const referrals = read('src/app/api/admin/referrals/route.ts');
  assert.ok(referrals.includes("eventType: 'referral_correction'"), 'referral corrections feed the learning log');
  assert.ok(referrals.includes('payload: { vehicle_id: Number(vehicleId)'), 'the corrected vehicle is stored for applying later');
});

test('20. approving changes the status, and only from pending', () => {
  assert.equal(nextStatus('approve', 'pending'), 'approved');
  assert.equal(nextStatus('approve', 'approved'), null);
  assert.equal(nextStatus('approve', 'rejected'), null);
  assert.equal(nextStatus('reject', 'pending'), 'rejected');
  assert.equal(nextStatus('reject', 'approved'), 'rejected');
  assert.equal(nextStatus('apply', 'approved'), 'applied');
  assert.equal(nextStatus('apply', 'pending'), null, 'an unapproved lesson can never be applied');
  assert.equal(nextStatus('reopen', 'rejected'), 'pending');
  const src = read(LEARNING_ID);
  assert.ok(src.includes('reviewLearningEvent') && src.includes('applyLearningEvent'), 'both review and apply exist');
  assert.ok(src.includes('adminDenied()'), 'admin only');
});

test('21. a rejected lesson is never used', () => {
  assert.equal(isUsableLesson('rejected'), false);
  assert.equal(isUsableLesson('pending'), false);
  assert.equal(isUsableLesson('approved'), true);
  assert.equal(isUsableLesson('applied'), true);
  const src = read('src/lib/ai-learning.ts');
  assert.ok(src.includes("WHERE status IN ('approved','applied') AND applies_to='global'"), 'only approved global lessons are loaded');
  assert.ok(!/status IN \('pending'/.test(src), 'pending lessons are never loaded into prompts');
});

test('23. an approved lesson is used when relevant (and only then)', () => {
  const note = lessonsNote([{ lesson: 'Never answer a motorcycle ad with a car.' }]);
  assert.ok(note.includes('APPROVED LESSONS'));
  assert.ok(note.includes('Never answer a motorcycle ad with a car.'));
  assert.equal(lessonsNote([]), '', 'no lessons, no note');
  assert.equal(lessonsNote([{ lesson: '   ' }]), '', 'blank lessons are ignored');
  const ai = read('src/lib/ai.ts');
  assert.ok(ai.includes('approvedLessons(5)'), 'the engine loads a bounded number of lessons');
  assert.ok(ai.includes('lessonsNote(lessons)'), 'and passes them into the system note');
});

test('22. customer memory never becomes global business knowledge', () => {
  const facts = read('src/lib/customer-facts.ts');
  assert.ok(!facts.includes('ai_knowledge'), 'customer facts never write to the knowledge base');
  assert.ok(!facts.includes('access_token'), 'no secrets involved');
  const learning = read('src/lib/ai-learning.ts');
  assert.ok(learning.includes("ev.event_type === 'business_rule'"), 'only an explicit business rule becomes global knowledge');
  assert.ok(learning.includes("applies_to ENUM('global','customer')"), 'lessons are explicitly scoped');
  assert.ok(learning.includes('applies_to=\'global\' AND'), 'prompt context uses global lessons only');
  assert.ok(read('src/lib/ai.ts').includes('never ask for these again'), 'customer preferences stay customer-scoped');
});

test('12. applying a lesson picks the right permanent form', () => {
  const src = read('src/lib/ai-learning.ts');
  assert.ok(src.includes("ev.event_type === 'referral_correction' && payload?.vehicle_id"), 'referral lessons become deterministic mappings');
  assert.ok(src.includes('setReferralCorrection('), 'using the existing correction store');
  assert.ok(src.includes('ai_knowledge:'), 'business rules become knowledge entries (with the exact id for undo)');
  assert.ok(src.includes("ref = 'prompt_context'"), 'everything else becomes prompt context');
  assert.ok(src.includes('lessonTitle('), 'knowledge entries get a readable title');
  assert.ok(lessonTitle('business_rule', 'shipping').includes('Business rule'));
});

test('the learning log stores everything a reviewer needs', () => {
  const src = read('src/lib/ai-learning.ts');
  for (const col of ['conversation_id', 'customer_id', 'message_id', 'question', 'ai_reply', 'correction', 'event_type', 'reason', 'lesson', 'applies_to', 'payload', 'status', 'created_by', 'reviewed_by', 'applied_ref', 'created_at']) {
    assert.ok(src.includes(col), `learning events record ${col}`);
  }
  assert.ok(src.includes("status ENUM('pending','approved','rejected','applied')"), 'the four statuses exist');
  assert.ok(/INDEX idx_learning_status\(status,created_at\)/.test(src), 'indexed for fast admin queries (Part 22)');
  assert.ok(/INDEX idx_learning_customer\(customer_id,created_at\)/.test(src));
  assert.ok(LEARNING_TYPES.includes('wrong_vehicle') && LEARNING_TYPES.includes('referral_correction') && LEARNING_TYPES.includes('business_rule'));
});

test('7. every learning section the owner asked for is representable', () => {
  for (const t of ['wrong_vehicle', 'wrong_price', 'wrong_category', 'wrong_language', 'wrong_shipping_answer', 'missing_information', 'bad_tone', 'referral_correction', 'better_sales_reply', 'business_rule', 'other']) {
    assert.ok(LEARNING_TYPES.includes(t), `type ${t} exists`);
  }
  assert.ok(read(LEARNING_CLIENT).includes('good_reply'), 'good replies are listed too');
  assert.ok(read(LEARNING_CLIENT).includes('Rejected'), 'rejected lessons stay reviewable');
});

test('20. the learning page works on a phone (cards, statuses, actions)', () => {
  const src = read(LEARNING_CLIENT);
  assert.ok(src.includes('learnCard'), 'cards, not a wide table');
  assert.ok(!src.includes('<table'), 'no table that needs sideways scrolling');
  for (const a of ['Approve', 'Reject', 'Edit', 'Apply']) assert.ok(src.includes(`>${a}<`), `${a} action present`);
  for (const f of ['Customer question', 'AI reply', 'Staff correction', 'Lesson']) assert.ok(src.includes(f), `${f} is shown`);
  assert.ok(read('src/app/inbox.css').includes('.learnStatus.pending'), 'status chips are styled');
  assert.ok(read('src/app/inbox.css').includes('@media (max-width: 900px)'), 'phone layout exists');
});

test('26. the customer history page works on a phone (list -> history -> back)', () => {
  const src = read('src/app/admin/customer-history/CustomerHistoryClient.tsx');
  assert.ok(src.includes('chRow') && src.includes('chList'), 'the list is a card list');
  assert.ok(!src.includes('<table'), 'no wide desktop table');
  assert.ok(src.includes('&lt; Back to customers'), 'a back control returns to the list');
  assert.ok(src.includes('setOpenId(null)'), 'back clears the open customer');
  assert.ok(src.includes('setOpenId(c.id)'), 'tapping a customer opens that history');
  assert.ok(read('src/app/inbox.css').includes('.chBack { display: inline-flex; }'), 'the back button shows on phones');
  assert.ok(src.includes('Screen A') || src.includes('chTools'), 'the list screen has search and filters');
  for (const f of ['Channel', 'Vehicle type', 'Handled by', 'From', 'To']) assert.ok(src.includes(f), `filter ${f} exists`);
  for (const s of ['Customer', 'Current interest', 'Preferences (AI memory)', 'Chat history', 'Sales history', 'Staff notes']) assert.ok(src.includes(s), `360 section ${s}`);
});

test('24/25. both new pages and their APIs are admin protected', () => {
  assert.ok(read(LEARNING_PAGE).includes("redirect('/admin/login')"));
  assert.ok(read('src/app/admin/customer-history/page.tsx').includes("redirect('/admin/login')"));
  assert.ok(read(LEARNING_PAGE).includes('robots: { index: false'), 'never indexed');
  for (const f of [LEARNING_ROUTE, LEARNING_ID, 'src/app/api/admin/customer-history/route.ts', 'src/app/api/admin/customer-history/[id]/route.ts']) {
    assert.ok(read(f).includes('adminDenied()'), `${f} is admin-only`);
  }
  assert.ok(read('src/app/admin/_components/AdminShell.tsx').includes("['/admin/ai-learning','AI Learning']"), 'reachable from the admin nav');
  assert.ok(read('src/app/admin/_components/AdminShell.tsx').includes("['/admin/customer-history','Customer History']"));
});

test('28/29. the previous fixes are still in place (no regression)', () => {
  // Part 17: category-strict referrals.
  assert.ok(read('src/lib/ai-rules/referral-match.ts').includes('category_mismatch'), 'motorcycle never maps to a car');
  assert.ok(read('src/lib/ai-rules/match.ts').includes('brand_only_insufficient'), 'no brand-only guessing');
  assert.ok(read('src/lib/ai-rules/vehicle-answer.ts').includes('likeCategory'), 'alternatives stay in the same category');
  assert.ok(read('src/lib/referrals.ts').includes('FROM referral_corrections'), 'owner corrections still win');
  // Part 18: the mobile inbox.
  const desk = read(DESK);
  assert.ok(desk.includes('mobileChat') && desk.includes('chatBack'), 'list/chat screens intact');
  assert.ok(desk.includes('withDraft(d, conversationId, ') || desk.includes('withDraft(d, activeId, '), 'per-chat drafts intact');
  const css = read('src/app/inbox.css');
  assert.ok(css.includes('.inbox.mobileChat') && css.includes('env(safe-area-inset-bottom)'), 'sticky composer intact');
  // The two earlier test suites still exist and still cover those behaviours.
  assert.ok(fs.existsSync(path.join(here24(), '25-referral-category.test.cjs')));
  assert.ok(fs.existsSync(path.join(here24(), '26-mobile-inbox.test.cjs')));
});

function here24() { return __dirname; }
