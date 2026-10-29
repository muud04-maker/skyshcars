const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const load = require('./lib.cjs');
const identity = load('inventory-identity-rules');
const telegram = load('telegram-rules');

const root = path.join(__dirname, '..', '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

const complete = {
  review_status: 'pending',
  extraction_confidence: 0.92,
  brand: 'Nissan',
  model: 'Sylphy',
  model_year: 2020,
  category: 'car',
  price_value: 8594,
  price_currency: 'USD',
  mileage_km: 60000,
  text: 'Available now',
  photo_count: 8,
};

test('V37 duplicate risk is numeric and categorical confidence is never manufactured', () => {
  assert.equal(identity.duplicateRiskForDecision({ kind: 'new', confidence: 0 }), 0);
  assert.equal(identity.duplicateRiskForDecision({ kind: 'possible', confidence: 0.62 }), 0.62);
  assert.equal(identity.duplicateRiskForDecision({ kind: 'confirmed', confidence: 0.44 }), 1);
  assert.equal(identity.duplicateRiskForDecision({ kind: 'possible', confidence: NaN }), null);
});

test('below-80% possible duplicate is automatic-eligible when every validation gate passes', () => {
  const decision = telegram.decideTelegramAutoPublish({
    ...complete, association_status: 'same_album', match_status: 'possible', duplicate_risk: 0.62,
  });
  assert.equal(decision.eligible, true, decision.reasons.join(', '));
  assert.equal(decision.duplicate_risk, 0.62);
});

test('80% and above remains manual review and an absent numeric score fails closed', () => {
  const high = telegram.decideTelegramAutoPublish({
    ...complete, match_status: 'possible', duplicate_risk: 0.8,
  });
  assert.equal(high.eligible, false);
  assert.match(high.reasons.join(' '), /80%/);
  const unknown = telegram.decideTelegramAutoPublish({
    ...complete, match_status: 'possible', duplicate_risk: null,
  });
  assert.equal(unknown.eligible, false);
  assert.match(unknown.reasons.join(' '), /unavailable/);
});

test('auto-publication still requires a durable original photo, USD price and complete specs', () => {
  const base = { ...complete, match_status: 'new', duplicate_risk: 0 };
  assert.equal(telegram.decideTelegramAutoPublish({ ...base, photo_count: 0 }).eligible, false);
  assert.equal(telegram.decideTelegramAutoPublish({ ...base, price_currency: 'CNY', price_value: 60000 }).eligible, false);
  assert.equal(telegram.decideTelegramAutoPublish({ ...base, brand: null }).eligible, false);
  assert.equal(telegram.decideTelegramAutoPublish({ ...base, model_year: null }).eligible, false);
  assert.equal(telegram.decideTelegramAutoPublish({ ...base, category: 'other' }).eligible, false);
});

test('public listing and photo routes exclude both Telegram and WhatsApp pending drafts', () => {
  const vehicles = read('src/lib/vehicles.ts');
  const photo = read('src/app/api/photo/[id]/route.ts');
  assert.match(vehicles, /IN \('whatsapp_group','telegram'\)/);
  assert.match(photo, /IN \('whatsapp_group','telegram'\)/);
  assert.match(vehicles, /status IN \('available','reserved','pending_verification','sold'\)/);
  assert.doesNotMatch(vehicles, /status IN \([^)]*'hidden'/);
});

test('Telegram listings never use representative/model fallback images', () => {
  const vehicles = read('src/lib/vehicles.ts');
  assert.ok(vehicles.includes("if (String(v.source || '') === 'telegram') return v;"));
  assert.ok(vehicles.includes("if (String(vehicle?.source || '') === 'telegram') return [];"));
  assert.ok(vehicles.includes("CASE WHEN COALESCE(v.source,'')='telegram'"));
});

test('all approval paths attach original import photos idempotently', () => {
  const source = read('src/lib/group-import.ts');
  assert.match(source, /export async function attachImportOriginalPhotos/);
  assert.match(source, /attachImportOriginalPhotos\(Number\(item\.id\), vehicleId\)/);
});

test('source price is preserved separately and blank approval never silently uses supplier cost', () => {
  const source = read('src/lib/group-import.ts');
  const ui = read('src/app/admin/imports/V16ImportClient.tsx');
  assert.match(source, /edits\.price_usd===''\|\|edits\.price_usd==null\?null:int\(edits\.price_usd\)/);
  assert.match(ui, /price_usd: ''/);
});

test('duplicate overrides are explicit, audited and blocked at 80% without the override flag', () => {
  const source = read('src/lib/group-import.ts');
  const ui = read('src/app/admin/imports/V16ImportClient.tsx');
  assert.match(source, /duplicateRisk>=0\.8&&!options\.duplicateOverride/);
  assert.match(source, /duplicate_override_publish/);
  assert.match(source, /duplicate_override_merge/);
  assert.match(source, /overridePublishGroupImport/);
  assert.match(source, /manual_duplicate_override/);
  assert.match(ui, /Publish duplicate/);
  assert.match(ui, /Publish → Sell Now \+ Facebook/);
});

test('manual and automatic approval provenance are distinguishable', () => {
  const source = read('src/lib/group-import.ts');
  const memory = read('src/lib/inventory-memory.ts');
  assert.match(source, /options\.automatic\?'automatic'/);
  assert.match(source, /approval_method='manual_merge'/);
  assert.match(source, /approval_method='automatic_exact_repeat'/);
  assert.match(memory, /approval_method='manual_apply_changes'/);
  assert.match(memory, /approved_by/);
});

test('repair preserves Hidden status, reuses stored photos and enables the customer AI only when complete', () => {
  const source = read('src/lib/group-import.ts');
  assert.match(source, /never changes a Hidden vehicle to Available/);
  assert.match(source, /previous_status: vehicle\.status, current_status: repairedVehicle\?\.status/);
  assert.match(source, /attachImportOriginalPhotos\(Number\(item\.id\), vehicleId\)/);
  assert.match(source, /ai_enabled=1/);
  assert.match(source, /SKY-MVT27FXX-ITWA/);
  assert.match(source, /proposed\.price_value \?\? 8594/);
});

test('public vehicle API parses stock/query filters and Facebook preflight performs no post', () => {
  const api = read('src/app/api/vehicles/route.ts');
  const diagnostic = read('src/lib/telegram-automation.ts');
  assert.match(api, /new URL\(request\.url\)\.searchParams/);
  assert.match(api, /stock === 'sold' \? 'sold'/);
  assert.match(api, /search: textParam\(params, 'q'\)/);
  assert.match(diagnostic, /facebookStatus\(\)/);
  assert.match(diagnostic, /posted: false/);
  assert.match(diagnostic, /private_content_included: false/);
});
