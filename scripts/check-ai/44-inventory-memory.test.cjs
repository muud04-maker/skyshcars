const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.join(__dirname, '..', '..');
const load = require('./lib.cjs');
const rules = load('inventory-identity-rules');
const imageFingerprints = load('image-fingerprints');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

const base = {
  category: 'motorcycle', brand: 'Honda', model: 'CB125F', model_year: 2024,
  trim_name: 'Standard', engine: '125cc', transmission: 'manual', fuel_type: 'petrol',
  color: 'red', mileage_km: 0, price_usd: 1200,
};
const existing = { id: 101, ...base, stock_no: 'SC-0101', vin: '1HGCM82633A004352', supplier_reference: 'HON-CB125-9901', image_hashes: ['a'.repeat(64)] };

test('same make/model/year without a strong reference stays uncertain, not overwritten', () => {
  const decision = rules.decideVehicleIdentity(base, [existing]);
  assert.equal(decision.kind, 'possible');
  assert.equal(decision.selected_vehicle_id, 101);
  assert.ok(decision.confidence < 1);
});

test('an exact VIN confirms the same vehicle', () => {
  const decision = rules.decideVehicleIdentity({ ...base, vin: existing.vin }, [existing]);
  assert.equal(decision.kind, 'confirmed');
  assert.equal(decision.selected_vehicle_id, 101);
  assert.match(decision.reasons.join(' '), /VIN/i);
});

test('a duplicated strong reference is ambiguous and never auto-confirmed', () => {
  const duplicate = { ...existing, id: 202, stock_no: 'SC-0202' };
  const decision = rules.decideVehicleIdentity({ ...base, vin: existing.vin }, [existing, duplicate]);
  assert.equal(decision.kind, 'possible');
  assert.match(decision.reasons.join(' '), /multiple vehicles/i);
});

test('an exact stock number confirms the same vehicle', () => {
  const decision = rules.decideVehicleIdentity({ ...base, stock_no: 'SC 0101' }, [existing]);
  assert.equal(decision.kind, 'confirmed');
  assert.match(decision.reasons.join(' '), /stock/i);
});

test('an exact image is only candidate evidence and cannot prove identity alone', () => {
  const decision = rules.decideVehicleIdentity({ ...base, image_hashes: ['a'.repeat(64)] }, [existing]);
  assert.equal(decision.kind, 'possible');
  assert.match(decision.reasons.join(' '), /image/i);
});

test('a perceptually similar image remains candidate evidence for review', () => {
  const decision = rules.decideVehicleIdentity({
    ...base, brand: 'Unknown', model: 'Unknown', model_year: null,
    perceptual_hashes: ['0000000000000000'],
  }, [{ ...existing, perceptual_hashes: ['0000000000000003'] }]);
  assert.equal(decision.kind, 'possible');
  assert.match(decision.reasons.join(' '), /similar image/i);
});

test('mileage units and prices normalize without converting non-USD currency', () => {
  assert.equal(rules.normalizeMileageKm('10,000 miles', 'mi'), 16093);
  assert.equal(rules.normalizeMileageKm('10,000', 'km'), 10000);
  assert.deepEqual(rules.normalizePrice('CNY 88,000', 'CNY'), { value: 88000, currency: 'CNY' });
  assert.deepEqual(rules.normalizePrice('$12,500', null), { value: 12500, currency: 'USD' });
});

test('original photo processing stores SHA-256 and a recompression-tolerant dHash', async () => {
  const sharp = require('sharp');
  const original = await sharp({
    create: { width: 80, height: 60, channels: 3, background: { r: 180, g: 60, b: 20 } },
  }).png().toBuffer();
  const recompressed = await sharp(original).resize(160, 120).jpeg({ quality: 72 }).toBuffer();
  const first = await imageFingerprints.fingerprintImage(original);
  const second = await imageFingerprints.fingerprintImage(recompressed);
  assert.match(first.sha256, /^[a-f0-9]{64}$/);
  assert.match(first.perceptual_hash, /^[a-f0-9]{16}$/);
  assert.notEqual(first.sha256, second.sha256);
  assert.ok(imageFingerprints.hashDistance(first.perceptual_hash, second.perceptual_hash) <= 6);
});

test('exact source message dedup and update approval are implemented durably', () => {
  const source = read('src/lib/group-import.ts');
  const memory = read('src/lib/inventory-memory.ts');
  assert.match(source, /inventory_message_ledger/);
  assert.match(source, /WHERE i\.source=\? AND i\.source_message_id=\?/);
  assert.match(memory, /inventory_change_proposals/);
  assert.match(source, /action==='apply_changes'/);
  assert.match(source, /proposeVehicleChanges/);
  assert.match(source, /proposeAdditionalPhotos/);
});

test('photo-only messages and uncertain matches remain reviewable', () => {
  const source = read('src/lib/group-import.ts');
  assert.match(source, /media\.length>0&&!!text&&!isQuestion/);
  assert.match(source, /mediaAiConfigured\(\)/);
  assert.match(source, /decision\.kind!=='confirmed'/);
  assert.match(source, /match_status/);
});

test('Facebook publication requires price/photo and reconciles uncertain responses', () => {
  const social = read('src/lib/social.ts');
  assert.match(social, /Number\(v\.price_usd\) > 0/);
  assert.match(social, /An approved original photo/);
  assert.match(social, /reconcileFacebookPublication/);
  assert.match(social, /status='uncertain'/);
  assert.match(social, /social_publications/);
  assert.match(social, /PRIMARY KEY\(vehicle_id,channel\)/);
});

test('sync success requires saved messages/media and a durable checkpoint', () => {
  const reader = read('src/lib/group-reader.ts');
  const bridge = read('tools/whatsapp-group-bridge/server.js');
  assert.match(reader, /p\.websiteSaved===true/);
  assert.match(reader, /p\.mediaComplete!==false/);
  assert.match(reader, /whatsapp_group_checkpoints/);
  assert.match(bridge, /READER_WINDOW_MINUTES/);
  assert.match(bridge, /fetchMessages\(\{ limit: 100 \}\)/);
  assert.match(bridge, /waitForOutbox/);
  assert.match(bridge, /acquireProcessLock/);
  assert.ok(fs.existsSync(path.join(root, 'tools/whatsapp-group-bridge/vps/skycars-group-reader.timer')));
});
