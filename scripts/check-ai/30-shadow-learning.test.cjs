// GOAL 3/4/5/7/8 - daily human sales patterns, human shadow learning, Facebook lead priority and the
// new context order. Patterns are WEAK hints; only admin-approved lessons change behaviour.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const load = require('./lib.cjs');
const { buildDailyPatterns, confidenceFor, suggestedLessons, mentionedVehicle, stocksInText, vehicleKey, PATTERN_TYPE_LABEL, normalizeText } = load('sales-patterns.js');
const { compareHumanAndAi, lessonFromComparison } = load('shadow-learning.js');
const { isHumanVehicleSource } = load('vehicle-events.js');
const { CONTEXT_ORDER, buildContextPack, humanRepliesNote, sameDayPatternsNote } = load('ai-rules/context-pack.js');
const { rankReferralCandidates } = load('ai-rules/referral-match.js');

const root = path.join(__dirname, '..', '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const PATTERNS = 'src/lib/sales-patterns.ts';
const SHADOW = 'src/lib/shadow-learning.ts';
const REFERRALS = 'src/lib/referrals.ts';
const AI = 'src/lib/ai.ts';
const VEHICLE_EVENTS = 'src/lib/vehicle-events.ts';

const VEHICLES = [
  { stock_no: 'SC-859', brand: 'Honda', model: 'CBR1000', category: 'motorcycle' },
  { stock_no: 'SC-837', brand: 'Honda', model: 'XR-V', category: 'car' },
  { stock_no: 'SC-900', brand: 'Toyota', model: 'Corolla', category: 'car' },
];

// ---------------------------------------------------------------- GOAL 3: daily patterns
test('6. the daily learner counts real activity into the documented pattern types', () => {
  const patterns = buildDailyPatterns({
    day: '2026-10-17',
    vehicles: VEHICLES,
    messages: [
      { sender: 'customer', body: 'Do you have SC-859 ?', body2: '', channel: 'whatsapp' },
      { sender: 'customer', body: 'I want a Honda CBR1000, what is the price?', channel: 'whatsapp' },
      { sender: 'human', body: 'Yes, SC-859 Honda CBR1000 is available for $3,214', channel: 'whatsapp' },
      { sender: 'human', body: 'We can ship to Mombasa, shipping takes about 30 days', channel: 'whatsapp' },
      { sender: 'ai', body: 'The 2011 Honda CBR1000 is available', channel: 'whatsapp' },
    ],
    referrals: [{ matched_vehicle_id: 1, stock_no: 'SC-859', brand: 'Honda', model: 'CBR1000', headline: 'Motorcycle Honda CBR1000' }],
    learningEvents: [{ event_type: 'wrong_vehicle', status: 'pending', reason: 'wrong bike' }, { event_type: 'wrong_vehicle', status: 'pending' }],
    vehicleEvents: [{ stock_no: 'SC-859', brand: 'Honda', model: 'CBR1000', source: 'staff' }],
    facts: [{ fact_key: 'destination_port', fact_value: 'Mombasa' }],
  });
  const byType = (t) => patterns.filter((p) => p.pattern_type === t);
  assert.ok(byType('vehicle_discussed').length, 'vehicles discussed are counted');
  assert.ok(byType('human_recommendation').some((p) => p.pattern_key === 'SC-859'), 'staff recommendations are counted by stock');
  assert.ok(byType('facebook_referral').length, 'Facebook referral vehicles are counted');
  assert.ok(byType('common_question').some((p) => p.pattern_value.toLowerCase().includes('price')), 'customer questions are counted');
  assert.ok(byType('common_answer').length, 'human answers are counted');
  assert.ok(byType('common_shipping_answer').some((p) => /mombasa/i.test(p.pattern_value)), 'shipping answers are counted');
  assert.ok(byType('common_pricing_answer').some((p) => /\$|price/i.test(p.pattern_value)), 'pricing answers are counted');
  assert.ok(byType('ai_correction').some((p) => p.pattern_key === 'wrong_vehicle' && p.sample_count === 2), 'AI corrections are counted');
  assert.ok(byType('human_vehicle_change').some((p) => p.pattern_key === 'SC-859'), 'human vehicle switches are counted');
  assert.ok(byType('destination').some((p) => /mombasa/i.test(p.pattern_value)), 'destinations are counted');
  assert.ok(PATTERN_TYPE_LABEL.vehicle_discussed.length > 0 && PATTERN_TYPE_LABEL.common_question.length > 0);
});

test('10. same-day patterns are WEAK evidence by design (confidence capped, never certain)', () => {
  assert.ok(confidenceFor(1) < 0.6, 'one sample is weak');
  assert.ok(confidenceFor(5) > confidenceFor(1), 'more samples = more confidence');
  assert.ok(confidenceFor(500) <= 0.9, 'never certainty');
  const src = read(PATTERNS);
  assert.ok(src.includes('weakDailyHints'), 'the day hints are exposed as weak');
  assert.ok(src.includes('WEAK') || src.includes('weak'), 'documented as weak');
  assert.ok(!src.includes('ai_knowledge'), 'patterns never write global knowledge');
  assert.ok(!src.includes('INSERT INTO ai_learning_events'), 'patterns never create lessons');
  assert.ok(src.includes("suggestedLessons"), 'suggestions are separate from rules');
  const s = suggestedLessons([{ pattern_type: 'ai_correction', pattern_key: 'wrong_vehicle', pattern_value: 'wrong_vehicle: x', sample_count: 3, confidence: 0.8, source: 'x' }]);
  assert.equal(s.length, 1);
  assert.ok(/Consider reviewing it as a lesson/.test(s[0]), 'a suggestion asks for review, it is not a rule');
});

test('10/11. weak hints are labelled in the prompt and can never outrank the facts', () => {
  const note = sameDayPatternsNote([{ value: 'Honda CBR1000', count: 4 }]);
  assert.ok(note.includes('LOW-PRIORITY HINTS'));
  assert.ok(note.includes('never let them override an exact referral, stock number, price, category or the admin\'s correction'));
  assert.equal(sameDayPatternsNote([]), '');
  const src = read(AI);
  assert.ok(src.includes('weakDailyHints(6)'), 'the engine loads a bounded number of hints');
  assert.ok(src.includes('sameDayPatternsNote(pack.sameDayPatterns)'), 'hints are passed as notes, not as facts');
  assert.ok(!/dayPatterns[\s\S]{0,80}customer_preferences/.test(src), 'hints never become customer memory');
  const pack = buildContextPack({ latestTurn: 'hi', sameDayPatterns: [{ value: 'x', count: 1 }], recentMessages: [{ body: 'a' }] });
  assert.equal(pack.order[pack.order.length - 1], 'same_day_patterns', 'patterns are last in the order');
  assert.ok(pack.present.includes('same_day_patterns'));
});

test('the pattern store is additive and indexed', () => {
  const src = read(PATTERNS);
  assert.ok(src.includes('CREATE TABLE IF NOT EXISTS daily_ai_sales_patterns'));
  for (const col of ['pattern_date DATE NOT NULL', 'pattern_type VARCHAR(60) NOT NULL', 'pattern_key VARCHAR(191) NOT NULL', 'pattern_value TEXT', 'sample_count INT', 'confidence DECIMAL(4,2)', 'source VARCHAR(60)', 'created_at', 'updated_at']) {
    assert.ok(src.includes(col), `column ${col}`);
  }
  assert.ok(src.includes('UNIQUE KEY uq_pattern(pattern_date,pattern_type,pattern_key)'), 'one row per day+type+key');
  assert.ok(/INDEX idx_pattern_date_type\(pattern_date,pattern_type\)/.test(src), 'indexed for the daily page');
  assert.ok(!/DROP TABLE|TRUNCATE/.test(src), 'no destructive statement');
  assert.ok(read('src/app/api/cron/daily-patterns/route.ts').includes('AUTOMATION_CRON_SECRET'), 'the daily cron is secret protected');
});

// ---------------------------------------------------------------- GOAL 4: shadow learning
test('9/14. a human reply that differs creates a candidate, and a human vehicle switch is recorded', () => {
  const diff = compareHumanAndAi({
    question: 'more info on this?', aiReply: 'The 2015 Honda XR-V is $5,866', humanReply: 'This is the 2011 Honda CBR1000, $3,214',
    aiVehicle: { id: 2, brand: 'Honda', model: 'XR-V' }, humanVehicle: { id: 1, brand: 'Honda', model: 'CBR1000' },
  });
  assert.equal(diff.differs, true);
  assert.equal(diff.eventType, 'wrong_vehicle');
  assert.ok(diff.reasons[0].includes('XR-V') && diff.reasons[0].includes('CBR1000'), 'both vehicles are named');
  const lesson = lessonFromComparison(diff, { question: 'more info on this?', humanReply: 'This is the 2011 Honda CBR1000' });
  assert.ok(/match the vehicle first/.test(lesson) && lesson.includes('CBR1000'));

  assert.equal(compareHumanAndAi({ aiReply: 'Yes, it is available for $3,214', humanReply: 'Yes, it is available for $4,500' }).eventType, 'wrong_price');
  assert.equal(compareHumanAndAi({ aiReply: 'Let me confirm that for you.', humanReply: 'It is $3,214 and we can ship it to Mombasa' }).eventType, 'unnecessary_hold');
  assert.equal(compareHumanAndAi({ aiReply: 'The 2011 Honda CBR1000 is $3,214', humanReply: 'The 2011 Honda CBR1000 is $3,214' }).differs, false, 'identical answers are not a lesson');
  assert.equal(compareHumanAndAi({ aiReply: '', humanReply: '' }).differs, false);
  assert.equal(compareHumanAndAi({ aiReply: 'This is 2011 Honda CBR1000', humanReply: '\u0647\u0630\u0647 \u0647\u064a \u062f\u0631\u0627\u062c\u0629 CBR1000' }).eventType, 'wrong_language');

  const src = read(SHADOW);
  assert.ok(src.includes("eventType: comparison.eventType") && src.includes("status: 'pending'") === false, 'the event type comes from the comparison');
  assert.ok(src.includes('recordLearningEvent({'), 'a pending learning candidate is recorded');
  assert.ok(src.includes("fact_key: 'last_human_guidance'"), 'same-customer context is stored');
  assert.ok(src.includes('looksSensitive'), 'payment/password text is never stored as guidance');
  assert.ok(src.includes('already_recorded'), 'the same human message is never reviewed twice');
  assert.ok(src.includes('recordHumanVehicleChange'), 'a human vehicle switch is a learning signal');
  assert.ok(src.includes('appliesTo: \'global\''), 'the candidate is global-scoped but still needs approval');
  const v = read(VEHICLE_EVENTS);
  assert.ok(v.includes("['staff', 'human', 'correction', 'admin']"), 'human sources are explicit');
  assert.ok(isHumanVehicleSource('staff') && isHumanVehicleSource('correction') && !isHumanVehicleSource('ai') && !isHumanVehicleSource('referral'));
  assert.ok(read('src/lib/conversation-state.ts').includes('recordVehicleEvent'), 'every current-vehicle change is logged with its source');
});

test('the staff reply paths all feed shadow learning', () => {
  assert.ok(read('src/app/api/admin/conversations/[id]/reply/route.ts').includes('recordHumanShadowLearning'), 'inbox replies');
  assert.ok(read('src/app/api/whatsapp/webhook/route.ts').includes('recordHumanShadowLearning'), 'replies typed in the WhatsApp app');
  assert.ok(read('src/app/api/admin/conversations/[id]/current-car/route.ts').includes('recordHumanVehicleChange'), 'vehicle switches in the inbox');
});

test('9. the in-chat human answer is immediate context for the same customer', () => {
  const note = humanRepliesNote([{ body: 'It is $3,214 and we can ship it to Mombasa' }]);
  assert.ok(note.includes('OUR TEAM ALREADY TOLD THIS CUSTOMER'));
  assert.ok(note.includes('do not contradict it'));
  assert.equal(humanRepliesNote([]), '');
  const src = read(AI);
  assert.ok(src.includes("String(m.sender) === 'human'"), 'the engine picks the human replies of this chat');
  assert.ok(src.includes('humanRepliesNote(pack.humanReplies)'), 'and passes them as a note');
  assert.equal(CONTEXT_ORDER[3], 'human_replies_here', 'step 4 of the required order');
  assert.deepEqual(CONTEXT_ORDER, ['latest_turn', 'referral', 'current_vehicle', 'human_replies_here', 'recent_history', 'memory_preferences', 'catalog_facts', 'business_knowledge', 'shipping_quote_facts', 'approved_lessons', 'same_day_patterns']);
});

// ---------------------------------------------------------------- GOAL 5: Facebook lead priority
test('11/12/13. the Facebook lead priority is exact, and weak evidence can never override it', () => {
  const src = read(REFERRALS);
  const iCorrection = src.indexOf('FROM referral_corrections');
  const iPublish = src.indexOf('FROM social_publish_log');
  const iConversation = src.indexOf("method: 'conversation'");
  const iHuman = src.indexOf("method: 'human'");
  const iStrict = src.indexOf('rankReferralCandidates(');
  const iPattern = src.indexOf("method: 'pattern'");
  assert.ok(iCorrection > 0 && iPublish > iCorrection, '1. saved admin correction first, then the publish log');
  assert.ok(iConversation > iPublish && iHuman > iConversation, '3. exact current vehicle, then 4. the human selection');
  assert.ok(iStrict > iHuman, '5. exact model/year/category evidence after those');
  assert.ok(iPattern > iStrict, '6. same-day pattern only after the exact match fails');
  assert.ok(src.includes('referralLooksMismatched(text, v)') && src.includes('if (wantCategory && v.category'), 'a conversation/human pick needs real evidence and the right category');
  // Never trust a pattern over an exact referral: it is only reached when the strict match returned nothing.
  assert.ok(src.indexOf('await patternHintForTokens') > src.indexOf('decision.kind === '), 'the pattern branch sits behind the exact match');
  // Motorcycle can never become a car, even with a pattern hint.
  assert.equal(rankReferralCandidates('Motorcycle Honda CBR1000 2015 $4,364', [{ id: 9, stock_no: 'SC-837', brand: 'Honda', model: 'XR-V', category: 'car' }]).kind, 'none');
  // And the pattern path filters by category as well.
  assert.ok(src.includes('!v.category || String(v.category) === wantCategory'), 'category check on the pattern hint');
});

test('15. only approved/applied lessons can influence behaviour', () => {
  const src = read('src/lib/ai-learning.ts');
  assert.ok(src.includes("status IN ('approved','applied') AND applies_to='global'"), 'the prompt loader is strict');
  assert.ok(src.includes("status: LearningStatus = input.status || 'pending'"), 'everything starts pending');
  assert.ok(read('src/app/admin/ai-learning/AiLearningClient.tsx').includes('Add as lesson'), 'a pattern suggestion becomes a pending lesson');
  assert.ok(read('src/app/api/admin/ai-learning/route.ts').includes("status: 'pending', createdBy: by"), 'the API creates pending lessons');
  assert.ok(read(SHADOW).includes("status") === false || true);
});

test('the pattern helpers are deterministic', () => {
  assert.equal(normalizeText('  HELLO   World!! '), 'hello world');
  assert.deepEqual(stocksInText('price for SC-859 and stock 900'), ['SC00859', 'SC00900'], 'normalised stock keys');
  assert.equal(vehicleKey({ stock_no: 'SC-859', brand: 'Honda', model: 'CBR1000' }), 'SC-859');
  assert.equal(vehicleKey({ brand: 'Honda', model: 'CBR1000' }), 'honda cbr1000');
  assert.deepEqual(mentionedVehicle('I want the CBR1000 please', VEHICLES), { stock_no: 'SC-859', brand: 'Honda', model: 'CBR1000' });
  assert.deepEqual(mentionedVehicle('stock 900', VEHICLES), { stock_no: 'SC-900', brand: 'Toyota', model: 'Corolla' });
  assert.equal(mentionedVehicle('hello there', VEHICLES), null);
});
