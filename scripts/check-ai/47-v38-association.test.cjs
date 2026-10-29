const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const load = require('./lib.cjs');
const association = load('telegram-association');
const extraction = load('vehicle-extraction');
const telegram = load('telegram-rules');

const root = path.join(__dirname, '..', '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

const base = {
  explicitReply: false,
  sameMediaGroup: false,
  previousHasText: false,
  previousHasMedia: true,
  previousTextKind: 'unknown',
  previousMediaKind: 'car',
  currentHasText: true,
  currentHasMedia: false,
  currentTextKind: 'car',
  currentMediaKind: 'unknown',
  messageDistance: 1,
  secondsApart: 5,
};

test('native Telegram albums are one association unit', () => {
  const decision = association.decideTelegramAssociation({ ...base, sameMediaGroup: true });
  assert.equal(decision.allowed, true);
  assert.equal(decision.status, 'same_album');
});

test('explicit Telegram replies are trusted without a time-window guess', () => {
  const decision = association.decideTelegramAssociation({ ...base, explicitReply: true, messageDistance: 500, secondsApart: 999 });
  assert.equal(decision.allowed, true);
  assert.equal(decision.status, 'explicit_reply');
});

test('a Volkswagen description cannot absorb adjacent Triumph motorcycle photos', () => {
  const decision = association.decideTelegramAssociation({
    ...base,
    previousMediaKind: 'motorcycle',
    currentTextKind: 'car',
  });
  assert.equal(decision.allowed, false);
  assert.equal(decision.status, 'unrelated');
  assert.match(decision.reason, /car.*motorcycle/i);
});

test('adjacent text/photo pairs associate only when category evidence matches', () => {
  assert.equal(association.decideTelegramAssociation(base).allowed, true);
  const unknown = association.decideTelegramAssociation({ ...base, previousMediaKind: 'unknown' });
  assert.equal(unknown.allowed, false);
  assert.equal(unknown.status, 'ambiguous');
});

test('an uncaptioned album pairs with its sole adjacent description when no image model is available', () => {
  const unique = association.decideTelegramAssociation({
    ...base, previousMediaKind: 'unknown', uniqueAdjacentCandidate: true,
  });
  assert.equal(unique.allowed, true);
  assert.equal(unique.status, 'semantic_adjacent');
  assert.match(unique.reason, /unique adjacent/i);
  assert.equal(association.decideTelegramAssociation({ ...base, previousMediaKind: 'unknown' }).allowed, false);
});

test('photo-first and description-first use the same strict unique-neighbour rule', () => {
  const photoFirst = association.decideTelegramAssociation({ ...base, previousMediaKind: 'unknown', uniqueAdjacentCandidate: true });
  const textFirst = association.decideTelegramAssociation({
    ...base, previousHasText: true, previousHasMedia: false, currentHasText: false, currentHasMedia: true,
    previousTextKind: 'car', currentTextKind: 'unknown', currentMediaKind: 'unknown', uniqueAdjacentCandidate: true,
  });
  assert.equal(photoFirst.allowed, true);
  assert.equal(textFirst.allowed, true);
  const competingPhoto = association.decideTelegramAssociation({
    ...base, previousMediaKind: 'unknown', uniqueAdjacentCandidate: false,
  });
  assert.equal(competingPhoto.allowed, false);
  assert.equal(competingPhoto.status, 'ambiguous');
});

test('time proximity alone or a wide gap never authorizes a merge', () => {
  const unknown = association.decideTelegramAssociation({ ...base, previousMediaKind: 'unknown', currentTextKind: 'unknown' });
  assert.equal(unknown.allowed, false);
  const late = association.decideTelegramAssociation({ ...base, secondsApart: 46 });
  assert.equal(late.allowed, false);
  const far = association.decideTelegramAssociation({ ...base, messageDistance: 3 });
  assert.equal(far.allowed, false);
});

test('two text posts or two photo posts are never combined', () => {
  const texts = association.decideTelegramAssociation({ ...base, previousHasText: true, previousHasMedia: false });
  assert.equal(texts.allowed, false);
  assert.equal(texts.status, 'unrelated');
  const photos = association.decideTelegramAssociation({
    ...base, previousHasText: false, previousHasMedia: true, currentHasText: false, currentHasMedia: true,
  });
  assert.equal(photos.allowed, false);
  assert.equal(photos.status, 'unrelated');
});

test('vehicle-kind inference separates the real Triumph and Volkswagen examples', () => {
  assert.equal(association.vehicleKindFromText('2020 Triumph Bobber 1200 Engine 1200cc'), 'motorcycle');
  assert.equal(association.vehicleKindFromText('2008 Volkswagen Touareg 3.6FSI V6 Automatic'), 'car');
  assert.equal(association.vehicleKindFromImageDescriptions(['A red motorcycle beside a rider']), 'motorcycle');
  assert.equal(association.vehicleKindFromImageDescriptions(['A dark SUV parked outdoors']), 'car');
  assert.equal(association.vehicleKindFromImageDescriptions(['An outdoor scene']), 'unknown');
});

test('AI Autofill deterministically extracts the VW sample without inventing confidence', async () => {
  const text = `Volkswagen Touareg 2008 3.6FSI V6 Automatic Luxury Edition petrol
Manufacturer: Volkswagen
Manufacturing date: 2008
Engine: 3.6L V6
Transmission: Automatic
Displacement: 3.6L
Price: $4,500 USD`;
  const result = await extraction.extractSupplierVehicles(text);
  const draft = result.vehicles[0];
  assert.equal(draft.brand, 'Volkswagen');
  assert.equal(draft.model, 'Touareg');
  assert.equal(draft.model_year, 2008);
  assert.equal(draft.trim_name, '3.6FSI V6 Automatic Luxury Edition');
  assert.equal(draft.engine, '3.6L V6');
  assert.equal(draft.transmission, 'automatic');
  assert.equal(draft.fuel_type, 'petrol');
  assert.equal(draft.price_value, 4500);
  assert.equal(draft.price_currency, 'USD');
  assert.equal(draft.confidence, undefined);
  assert.equal(draft.extraction_quality, 'complete');
  assert.equal(draft.original_description, text);
});

test('AI Autofill deterministic fallback understands the Triumph motorcycle sample', async () => {
  const result = await extraction.extractSupplierVehicles('2020 Triumph Bobber 1200 motorcycle\nEngine: 1200cc\nPrice: $10,125 USD');
  const draft = result.vehicles[0];
  assert.equal(draft.category, 'motorcycle');
  assert.equal(draft.brand, 'Triumph');
  assert.equal(draft.model, 'Bobber');
  assert.equal(draft.model_year, 2020);
  assert.equal(draft.price_value, 10125);
});

test('automatic publication requires confident association, complete extraction, price, photos and duplicate policy', () => {
  const valid = {
    association_status: 'same_album', match_status: 'new', duplicate_risk: 0.35,
    review_status: 'pending', extraction_quality: 'complete', brand: 'Volkswagen', model: 'Touareg',
    model_year: 2008, category: 'car', price_value: 5500, price_currency: 'USD', photo_count: 4, text: 'Available',
  };
  assert.equal(telegram.decideTelegramAutoPublish(valid).eligible, true);
  assert.equal(telegram.decideTelegramAutoPublish({ ...valid, association_status: 'ambiguous' }).eligible, false);
  assert.equal(telegram.decideTelegramAutoPublish({ ...valid, extraction_quality: 'partial', extraction_confidence: null }).eligible, false);
  assert.equal(telegram.decideTelegramAutoPublish({ ...valid, duplicate_risk: 0.8 }).eligible, false);
});

test('source cost is never treated as selling price without configured markup', () => {
  assert.equal(telegram.telegramSellingPrice(4500, null, null), null);
  assert.equal(telegram.telegramSellingPrice(4500, 1000, null), 5500);
  assert.equal(telegram.telegramSellingPrice(4500, null, 10), 4950);
});

test('V38 source association replaces the broad three-minute merge path', () => {
  const source = read('src/lib/group-import.ts');
  assert.doesNotMatch(source, /MERGE_WINDOW_MIN/);
  assert.match(source, /decideTelegramAssociation/);
  assert.match(source, /association_status/);
  assert.match(source, /telegram_file_unique_id/);
  assert.match(source, /source_message_key/);
  assert.match(source, /setGroupImportCover/);
  assert.match(source, /reextractGroupImport/);
  assert.match(source, /adjacencyCandidates\.length===1/);
  assert.match(source, /more than one adjacent text\/photo candidate/);
});

test('V38 sanitized production diagnostic extracts source metadata without returning supplier text', () => {
  const source = read('src/lib/telegram-automation.ts');
  assert.match(source, /sanitized_text_extraction/);
  assert.match(source, /extractSupplierVehicles\(text\)/);
  assert.match(source, /private_content_included: false/);
});

test('Add Vehicle exposes AI Autofill, source price, drafts and publish validation', () => {
  const ui = read('src/app/admin/vehicles/_components/VehicleForm.tsx');
  const route = read('src/app/api/admin/vehicles/extract/route.ts');
  assert.match(ui, /Paste supplier vehicle description/);
  assert.match(ui, /AI Extract \/ Autofill/);
  assert.match(ui, /Supplier source price/);
  assert.match(ui, /Save Draft/);
  assert.match(ui, /Publish Now/);
  assert.match(ui, /missing_fields/);
  assert.match(route, /extractSupplierVehicles/);
  assert.match(route, /getAdminSession/);
});
