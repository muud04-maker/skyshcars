// Real customer cases: Facebook vehicle ads must preserve the named model/year even when several
// stock units remain possible. Brand words inside a model never count as model evidence.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const load = require('./lib.cjs');
const { rankReferralCandidates, referralHintFromCandidates, referralPrice } = load('ai-rules/referral-match.js');
const { vehicleDetails } = load('ai-rules/vehicle-answer.js');

const root = path.join(__dirname, '..', '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');

const SAIL_1852_A = { id: 44, stock_no: 'SC00044', brand: 'SAIC-GM Chevrolet', model: 'Chevrolet Sail', model_year: 2014, category: 'car', price_usd: 1852, ai_enabled: 1 };
const SAIL_1600 = { id: 93, stock_no: 'SC00093', brand: 'SAIC-GM Chevrolet', model: 'Chevrolet Sail', model_year: 2014, category: 'car', price_usd: 1600, ai_enabled: 1 };
const SAIL_1852_B = { id: 158, stock_no: 'SC00158', brand: 'SAIC-GM Chevrolet', model: 'Chevrolet Sail', model_year: 2014, category: 'car', price_usd: 1852, ai_enabled: 1 };
const SAIL_3 = { id: 2, stock_no: 'SC00002', brand: 'SAIC-GM Chevrolet', model: 'Chevrolet Sail 3', model_year: 2015, category: 'car', price_usd: 1842, ai_enabled: 1 };
const TRAX = { id: 128, stock_no: 'SC00128', brand: 'SAIC-GM Chevrolet', model: 'Chevrolet Trax', model_year: 2014, category: 'car', price_usd: 2210, ai_enabled: 1 };
const CRUZE = { id: 135, stock_no: 'SC00135', brand: 'SAIC-GM Chevrolet', model: 'Chevrolet Cruze', model_year: 2014, category: 'car', price_usd: 1739, ai_enabled: 1 };

const H6_2013_A = { id: 166, stock_no: 'SC00166', brand: 'Great Wall Motors', model: 'Haval H6', model_year: 2013, category: 'car', price_usd: 2004, ai_enabled: 1 };
const H6_2013_B = { id: 207, stock_no: 'V16-039', brand: 'Haval', model: 'H6', model_year: 2013, category: 'car', price_usd: 2152, ai_enabled: 1 };
const H6_2016 = { id: 113, stock_no: 'SC00113', brand: 'Great Wall Motors', model: 'Haval H6', model_year: 2016, category: 'car', price_usd: 2130, ai_enabled: 1 };
const H2 = { id: 106, stock_no: 'SC00106', brand: 'Great Wall Motors', model: 'Haval H2', model_year: 2016, category: 'car', price_usd: 1916, ai_enabled: 1 };

const SAIL_AD = 'Chevrolet Sail 2014 1.4L Manual Petrol - Price $1,852 USD';
const HAVAL_AD = 'Haval H6 2013 1.5T 2WD Manual Petrol - Great Wall Motors';

test('Chevrolet Sail ad cannot pull in every Chevrolet model', () => {
  const decision = rankReferralCandidates(SAIL_AD, [SAIL_1852_A, SAIL_1600, SAIL_1852_B, SAIL_3, TRAX, CRUZE]);
  assert.equal(decision.kind, 'candidates');
  assert.ok(decision.list.every((v) => v.model === 'Chevrolet Sail'), 'only Sail units remain');
  assert.ok(!decision.list.some((v) => ['Chevrolet Trax', 'Chevrolet Cruze', 'Chevrolet Sail 3'].includes(v.model)));
  assert.equal(referralPrice(SAIL_AD), 1852);
});

test('ambiguous Chevrolet Sail keeps the model/year hint instead of losing it', () => {
  const decision = rankReferralCandidates(SAIL_AD, [SAIL_1852_A, SAIL_1852_B, TRAX]);
  assert.equal(decision.kind, 'candidates');
  const hint = referralHintFromCandidates(decision.list);
  assert.equal(hint.brand, 'SAIC-GM Chevrolet');
  assert.equal(hint.model, 'Chevrolet Sail');
  assert.equal(hint.year, 2014);
  assert.equal(hint.category, 'car');
});

test('Haval H6 2013 is acknowledged even when two exact units remain possible', () => {
  const decision = rankReferralCandidates(HAVAL_AD, [H6_2013_A, H6_2013_B, H6_2016, H2]);
  assert.equal(decision.kind, 'candidates');
  assert.ok(decision.list.every((v) => /H6/.test(String(v.model))));
  assert.ok(!decision.list.some((v) => v.id === H2.id), 'Haval H2 is not the advertised H6');
  const hint = referralHintFromCandidates(decision.list);
  assert.equal(hint.model, 'Haval H6');
  assert.equal(hint.year, 2013);
});

test('a unique exact unit still resolves from the same ad', () => {
  const decision = rankReferralCandidates(SAIL_AD, [SAIL_1852_A, SAIL_1600, TRAX, CRUZE]);
  assert.equal(decision.kind, 'one');
  assert.equal(decision.vehicle.id, SAIL_1852_A.id);
});

test('unmatched referral wording asks for the ad link/screenshot, never which vehicle', () => {
  const compose = read('src/lib/sales-compose.ts');
  assert.ok(!compose.includes('then ask which vehicle they are looking for'), 'old unsafe wording removed');
  assert.ok(/do NOT ask "Which vehicle\?"/i.test(compose), 'model-known clarification forbids the generic question');
  assert.ok(compose.includes('advertisement link or a screenshot'), 'missing backend referral metadata asks for the source');
  assert.ok(compose.includes('exact stock unit is NOT verified'), 'model known but stock uncertain stays honest');
});

test('referral metadata preserves ad title/body and logs only redacted diagnostics', () => {
  const referrals = read('src/lib/referrals.ts');
  const core = read('src/lib/ai-rules/engine-core.ts');
  assert.ok(referrals.includes('ads.ad_body') && referrals.includes('ads.ad_creative_body'));
  assert.ok(referrals.includes('referralHintFromCandidates'));
  assert.ok(core.includes('headline_present') && core.includes('body_present') && core.includes('source_url_present'));
  assert.ok(core.includes('hint_model') && core.includes('hint_year'));
  assert.ok(core.includes('!referral.vehicle && !referral.hint'), 'an ad with no backend vehicle text is remembered as unresolved');
  assert.ok(!/access_token|app_secret/i.test(core));
});

test('staff takeover and stale-turn protections remain wired around referral answering', () => {
  const core = read('src/lib/ai-rules/engine-core.ts');
  assert.ok(core.includes("'staff_took_over'"));
  assert.ok(core.includes('hasNewerCustomerMessage'));
  assert.ok(core.includes("'already_answered'"));
  assert.ok(core.includes('setCurrentCar'));
});

test('vehicle details use the real status and never label a sold referral as available', () => {
  const sold=vehicleDetails({ ...SAIL_1852_A, status: 'sold' }, 'en');
  assert.ok(sold.includes('Status: Sold'));
  assert.ok(!sold.includes('Status: Available'));
  assert.ok(!sold.includes('$1,852'), 'sold old price is not presented as current');
  const available=vehicleDetails({ ...SAIL_1852_A, status: 'available' }, 'en');
  assert.ok(available.includes('Status: Available'));
  const compose=read('src/lib/sales-compose.ts');
  assert.ok(compose.includes("currentStatus !== 'available'"), 'referent status is checked before a direct answer');
  assert.ok(compose.includes('SOLD. Do not quote its old price'), 'sold referral wording is guarded');
  assert.ok(compose.includes('exactReferralNotQuotable'), 'non-AI referral units are not described as directly quotable');
  assert.ok(compose.includes("publicVehicleByStockOrUrl('/vehicles/' + currentId)"), 'a sold/current unit is looked up by its real status');
  assert.ok(compose.includes("type: 'follow_up'") && compose.includes('not enabled for AI price/photo answers'), 'a staff promise has a real tracked task');
});

test('a stale advertised price is identified while the verified price remains authoritative', () => {
  const compose=read('src/lib/sales-compose.ts');
  assert.ok(compose.includes('The advertisement displayed $'));
  assert.ok(compose.includes('Use the verified current price'));
  assert.ok(compose.includes('ad may be outdated'));
  assert.equal(referralPrice('Chevrolet Sail 2014 USD $1,852'), 1852);
});

test('an available requested vehicle is not automatically followed by other vehicles', () => {
  const compose=read('src/lib/sales-compose.ts');
  assert.ok(compose.includes("vIntent === 'alternatives' && alts.length"), 'alternative facts are gated by intent');
  assert.ok(compose.includes("? (alternativeLines(alts, lang) || vehicleDetails(current, lang, { maxLines: 4 }))"), 'direct alternatives only appear for an alternatives request');
  assert.ok(!compose.includes("vehicleDetails(current, lang, { maxLines: vIntent === 'price' ? 4 : 9 })}${alts.length"), 'available price/details answers do not append unrequested vehicles');
});
