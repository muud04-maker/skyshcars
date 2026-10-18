// FINAL UPGRADE - business policy (team voice, shipping ranges, third-party payment) and bulk availability.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const load = require('./lib.cjs');
const { DEFAULT_POLICY, normalizePolicy, shippingEstimateFor, paymentPolicyAnswer, teamStyleNote, policyNote } = load('business-policy.js');
const { normalizeBulkAction, cleanIds, buildBulkWhere, describeBulkRequest, STATUSES } = load('bulk-vehicles.js');

const root = path.join(__dirname, '..', '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const COMPOSE = 'src/lib/sales-compose.ts';
const BULK = 'src/app/api/admin/vehicles/bulk/route.ts';
const POLICY_API = 'src/app/api/admin/business-policy/route.ts';

test('shipping guidance uses the official indicative ranges and is never a quotation', () => {
  const cars = shippingEstimateFor(DEFAULT_POLICY, 'car');
  const moto = shippingEstimateFor(DEFAULT_POLICY, 'motorcycle');
  assert.ok(cars.includes('$1,200') && cars.includes('$2,000'), cars);
  assert.ok(moto.includes('$300') && moto.includes('$500'), moto);
  assert.ok(/estimate/i.test(cars) && /not a guaranteed rate/i.test(cars), 'explicitly an estimate');
  assert.ok(/country and port/i.test(cars), 'asks for the destination rather than assuming');
  assert.equal(shippingEstimateFor(DEFAULT_POLICY, 'car').includes('motorcycle'), false, 'car and bike ranges stay separate');
  assert.ok(DEFAULT_POLICY.shipping.regional_note.includes('East Africa') && DEFAULT_POLICY.shipping.regional_note.includes('West Africa'));
});

test('the payment policy is the third-party arrangement - no bank details, no escrow claims', () => {
  const p = paymentPolicyAnswer(DEFAULT_POLICY);
  assert.ok(/third-party/i.test(p), 'third party stated');
  assert.ok(/rather than asking you to pay us directly/i.test(p), 'no direct payment');
  assert.ok(/trusted intermediary|intermediary/i.test(p), 'asks about their intermediary');
  for (const bad of ['iban', 'account number', 'sort code', 'escrow guaranteed', 'licensed', 'insured']) {
    assert.equal(new RegExp(bad, 'i').test(p), false, `must not claim ${bad}`);
  }
  assert.ok(/never state a payment was received/i.test(DEFAULT_POLICY.payment.escalate_note));
});

test('team voice, brevity and answer-first are enforced in the prompt note', () => {
  const note = teamStyleNote(DEFAULT_POLICY);
  assert.ok(/Sky Cars team/i.test(note) && /"we", "our", "us"/.test(note), 'team voice');
  assert.ok(/3 short sentences or fewer/.test(note), 'brevity');
  assert.ok(/at most one relevant follow-up question/i.test(note), 'one question');
  assert.ok(/exact price immediately/i.test(note), 'price first, never "let us confirm"');
  assert.ok(/never mention internal systems/i.test(note), 'no internal terms');
  assert.ok(/never invent vehicles, prices, payments, partners, fees or delivery times/i.test(note), 'no fabrication');
  const full = policyNote(DEFAULT_POLICY);
  assert.ok(full.includes('$1,200') && full.includes('$300') && full.includes('third-party'), 'one note carries style + shipping + payment');
  assert.ok(/shipping company they trust/i.test(full), 'asks about their own forwarder');
  assert.ok(/only name a partner after/i.test(full), 'partner coverage must be verified');
  // The reply engine injects it on every path.
  const compose = read(COMPOSE);
  assert.ok(compose.includes('getBusinessPolicy()') && compose.includes('policyNote(policy)'), 'policy is loaded per reply');
  assert.ok((compose.match(/policyText/g) || []).length >= 3, 'used by both the inventory and normal reply paths');
});

test('policy input is validated and clamped (a bad save cannot break replies)', () => {
  const p = normalizePolicy({ shipping: { car_min: -5, car_max: 100, motorcycle_min: 'abc', motorcycle_max: 50 }, style: { max_sentences: 99 }, payment: { policy: '   ' } });
  assert.equal(p.shipping.car_min, DEFAULT_POLICY.shipping.car_min, 'negative min rejected');
  assert.ok(p.shipping.car_max >= p.shipping.car_min, 'max never below min');
  assert.ok(p.shipping.motorcycle_max >= p.shipping.motorcycle_min);
  assert.equal(p.style.max_sentences, 6, 'sentence cap clamped');
  assert.equal(p.payment.policy, DEFAULT_POLICY.payment.policy, 'blank payment text falls back to the approved policy');
  const saved = read('src/lib/business-policy.ts');
  assert.ok(saved.includes('version: current.version + 1'), 'every save is a new version');
  assert.ok(saved.includes("'business_policy.updated'"), 'and is audited');
  assert.ok(read(POLICY_API).includes('adminDenied()'), 'editing the policy is admin-only');
  assert.ok(read('src/app/admin/settings/page.tsx').includes('BusinessPolicyCard'), 'staff can edit it in the admin panel');
});

test('bulk availability only accepts Available/Sold and never conflates Sold with Hidden', () => {
  assert.equal(normalizeBulkAction('available'), 'available');
  assert.equal(normalizeBulkAction('SOLD'), 'sold');
  assert.equal(normalizeBulkAction('hidden'), null, 'hidden is a separate state');
  assert.equal(normalizeBulkAction('deleted'), null);
  assert.deepEqual([...STATUSES].sort(), ['available', 'hidden', 'pending_verification', 'reserved', 'sold']);
  const src = read(BULK);
  assert.ok(src.includes('adminDenied()'), 'admin only');
  assert.ok(src.includes('beginTransaction') && src.includes('commit()') && src.includes('rollback()'), 'transactional');
  assert.ok(src.includes('AND status<>?'), 'already-identical rows count as skipped');
  assert.ok(src.includes('updated') && src.includes('skipped') && src.includes('failed'), 'reports the three counts');
  assert.ok(src.includes('audit_logs'), 'who changed what is audited');
  assert.ok(src.includes('LIMIT 5000'), 'cross-page selection is bounded');
  assert.ok(src.includes('Nothing matched that selection.'), 'an empty match is reported, not silently ignored');
});

test('bulk selection is sanitised and every filter value is a bound parameter', () => {
  assert.deepEqual(cleanIds([1, '2', 2, -3, 'x', 0, 1.5]), [1, 2]);
  assert.deepEqual(cleanIds(Array.from({ length: 10 }, (_, i) => i + 1), 3), [1, 2, 3], 'capped');
  const { where, args } = buildBulkWhere({ status: 'available', category: 'motorcycle', brand: 'Honda', model: 'CBR', year: 2015, minPrice: 1000, maxPrice: 9000, q: '859', noPhotos: true, aiOn: true });
  for (const frag of ['v.status=?', 'v.category=?', 'v.brand=?', 'v.model LIKE ?', 'v.model_year=?', 'v.price_usd>=?', 'v.price_usd<=?', 'v.stock_no LIKE ?', 'ai_enabled=1']) assert.ok(where.includes(frag), frag);
  assert.equal(args.length, 11, 'every placeholder has a value');
  // User values are bound, never pasted: none of them may appear inside the SQL text.
  for (const v of ["'Honda'", "'CBR'", "'859'", "v.status='available'", "v.category='motorcycle'"]) {
    assert.equal(where.includes(v), false, `no interpolated value ${v}`);
  }
  assert.throws(() => buildBulkWhere({ status: 'deleted' }), /Invalid status/);
  assert.throws(() => buildBulkWhere({ category: 'spaceship' }), /Invalid category/);
  const byIds = describeBulkRequest({ ids: [4, 5] });
  assert.equal(byIds.mode, 'ids');
  assert.equal(describeBulkRequest({ all_matching: { status: 'sold' } }).mode, 'matching');
});

test('inventory summary distinguishes available, sold, AI-enabled and photo-less stock', () => {
  const src = read(BULK);
  for (const key of ['available_vehicles', 'sold', 'pending', 'hidden', 'cars', 'motorcycles', 'ai_catalog', 'available_in_ai', 'without_photos']) {
    assert.ok(src.includes(key), `summary includes ${key}`);
  }
  assert.ok(src.includes('recent_status_changes'), 'recent status changes are surfaced');
  assert.ok(src.includes('adminDenied()'), 'the summary is admin-only');
});
