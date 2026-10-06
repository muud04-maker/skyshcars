// PART 11 — AI Catalog selection/bulk helpers (pure) + static checks on shipping artefacts.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const load = require('./lib.cjs');
const { toggleId, toggleAllIds, clearIds, countSelected } = load('ai-rules/selection.js');

test('PART 11: ticking a row adds/removes just that id', () => {
  assert.deepEqual(toggleId([], 5), [5]);
  assert.deepEqual(toggleId([5, 9], 9), [5]);
  assert.deepEqual(toggleId([5, 9], 7), [5, 9, 7]);
});

test('PART 11: select all visible toggles the whole visible page', () => {
  assert.deepEqual(toggleAllIds([], [1, 2, 3]), [1, 2, 3]);
  // all visible already selected -> untick them, keep other selections
  assert.deepEqual(toggleAllIds([1, 2, 3, 9], [1, 2, 3]), [9]);
  // partial selection -> add the rest
  assert.deepEqual(toggleAllIds([1], [1, 2, 3]), [1, 2, 3]);
  assert.deepEqual(toggleAllIds([], []), []);
});

test('PART 11: clear + count', () => {
  assert.deepEqual(clearIds(), []);
  assert.equal(countSelected([1, 2, 3]), 3);
});

test('PART 11: the admin PWA manifest is valid and points at /admin', () => {
  const file = path.join(__dirname, '..', '..', 'public', 'manifest-admin.webmanifest');
  const m = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.equal(m.start_url, '/admin');
  assert.equal(m.display, 'standalone');
  assert.ok(m.name && m.icons?.length);
  assert.ok(fs.existsSync(path.join(__dirname, '..', '..', 'public', 'icon-admin.svg')));
});

test('PART 11: the public vehicle API whitelists customer-facing fields only', () => {
  const file = path.join(__dirname, '..', '..', 'src', 'app', 'api', 'vehicles', 'route.ts');
  const src = fs.readFileSync(file, 'utf8');
  for (const leak of ['source', 'supplier', 'markup', 'margin', 'base_price']) {
    assert.ok(!new RegExp(`PUBLIC_FIELDS[^\\]]*${leak}`, 'i').test(src), `public API must not expose ${leak}`);
  }
  assert.ok(src.includes('PUBLIC_FIELDS'));
});

test('PART 11: the admin add-vehicle route exists and is protected', () => {
  const page = path.join(__dirname, '..', '..', 'src', 'app', 'admin', 'vehicles', 'new', 'page.tsx');
  const src = fs.readFileSync(page, 'utf8');
  assert.ok(src.includes('isAdmin'));
  const client = fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'app', 'admin', 'vehicles', 'new', 'AddVehicleClient.tsx'), 'utf8');
  for (const step of ['Basic', 'Details', 'Pricing', 'Photos', 'Sales']) assert.ok(client.includes(step), `missing step ${step}`);
  assert.ok(client.includes('motorcycle') === false || client.includes('CATS'), 'category list present');
});
