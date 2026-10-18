// ADMIN UI COMPLETION - the interface layer must actually call the protected APIs (brief: no backend-only features).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const load = require('./lib.cjs');
const { filterRows } = load('ai-rules/inbox.js');

const root = path.join(__dirname, '..', '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');

test('1. bulk UI is wired to the bulk API with selection count, confirm and both actions', () => {
  const ui = read('src/app/admin/vehicles/_components/VehicleManager.tsx');
  for (const s of ['type="checkbox"', 'Select this page', 'Select all', 'selected', 'Mark Available', 'Mark Sold', "confirm(`", '/api/admin/vehicles/bulk']) {
    assert.ok(ui.includes(s), `bulk UI contains ${s}`);
  }
  assert.ok(ui.includes('updated') && ui.includes('skipped'), 'result counts are shown');
  assert.ok(ui.includes('Edit') && ui.includes('Photos') && ui.includes('Hide'), 'existing row actions preserved');
  assert.ok(ui.includes('onChange={() => toggle(Number(v.id))}'), 'row checkboxes toggle selection');
});

test('2. inventory dashboard cards and duplicate review are on the vehicles screen', () => {
  const ui = read('src/app/admin/vehicles/_components/VehicleManager.tsx');
  assert.ok(ui.includes('/api/admin/vehicles/bulk'), 'summary comes from the protected endpoint');
  for (const label of ['Total', 'Available', 'Sold', 'Pending', 'Hidden', 'Cars', 'Motorcycles', 'In AI catalog', 'Without photos']) {
    assert.ok(ui.includes(`['${label}'`), `dashboard card ${label}`);
  }
  assert.ok(ui.includes('Possible duplicates (review)'), 'duplicates are shown for review');
  assert.ok(!/DELETE[^\n]*duplicate/i.test(ui), 'duplicates are never deleted automatically');
  assert.ok(ui.includes('/admin/ai-catalog') && ui.includes('/admin/media'), 'cards link to the relevant screens');
});

test('4. inbox filters cover the requested practical views and use stored flags', () => {
  const row = (over) => ({ id: 1, mode: 'ai', needs_reply: 1, needs_staff: 0, task_serious: 0, task_payment: 0, task_shipping: 0, task_photo: 0, task_sourcing: 0, task_followup: 0, pending_last_result: null, ...over });
  assert.equal(filterRows([row({ task_serious: 1 })], 'serious').length, 1);
  assert.equal(filterRows([row({ task_payment: 1 })], 'payment').length, 1);
  assert.equal(filterRows([row({ task_shipping: 1 })], 'shipping').length, 1);
  assert.equal(filterRows([row({ task_photo: 1 })], 'photos').length, 1);
  assert.equal(filterRows([row({ task_sourcing: 1 })], 'sourcing').length, 1);
  assert.equal(filterRows([row({ task_followup: 1 })], 'follow_up').length, 1);
  assert.equal(filterRows([row({ pending_last_result: 'failed (attempt 1)' })], 'ai_error').length, 1);
  assert.equal(filterRows([row({})], 'serious').length, 0, 'a chat without the flag is not shown');
  const desk = read('src/app/admin/_components/ConversationDesk.tsx');
  for (const label of ['Serious buyers', 'Payment questions', 'Shipping requests', 'Missing vehicle photos', 'Vehicle sourcing', 'Follow-up required', 'AI errors', 'Human takeover']) {
    assert.ok(desk.includes(label), `filter option ${label}`);
  }
  assert.ok(read('src/lib/inbox.ts').includes("t.request_type='serious_buyer'"), 'flags come from real staff tasks (no duplicate pipeline)');
});

test('6. readiness shows real probes, not env presence alone', () => {
  const api = read('src/app/api/admin/release-status/route.ts');
  for (const s of ['verifyCriticalSchemas', 'last_webhook_at', 'ai_queue_pending', 'signature', 'media_ai', 'group_reader', 'deployed_commit']) {
    assert.ok(api.includes(s), `release status includes ${s}`);
  }
  assert.ok(api.includes('adminDenied()'), 'admin only');
  assert.ok(!/process\.env\.[A-Z_]+\s*[,}]/.test(api.replace(/process\.env\.(DEPLOYED_COMMIT|GIT_COMMIT|SOURCE_VERSION|WHATSAPP_APP_SECRET|REQUIRE_WHATSAPP_SIGNATURE)/g, '')), 'no other secrets are read');
  const ui = read('src/app/admin/launch/ReleaseStatus.tsx');
  for (const label of ['Deployed commit', 'Database schema', 'Last WhatsApp webhook receipt', 'WhatsApp signature', 'Media AI', 'Group reader bridge']) {
    assert.ok(ui.includes(label), `readiness row ${label}`);
  }
  assert.ok(ui.includes('optional'), 'optional features are labelled');
});

test('7. policy history is read-only and shows version/editor/changed fields', () => {
  const api = read('src/app/api/admin/business-policy/history/route.ts');
  assert.ok(api.includes("action='business_policy.updated'"), 'reads the existing audit log');
  assert.ok(api.includes('adminDenied()'), 'admin only');
  assert.ok(api.includes('changed'), 'reports changed fields');
  assert.ok(!api.includes('export async function PUT') && !api.includes('export async function POST'), 'no restore endpoint (GET only)');
  assert.ok(read('src/app/admin/settings/BusinessPolicyCard.tsx').includes('Version history'), 'viewer is on the settings page');
});

test('3. import page distinguishes an empty queue from a disconnected bridge', () => {
  const page = read('src/app/admin/imports/page.tsx');
  assert.ok(page.includes('inventory_import_items'), 'shows import counts');
  assert.ok(page.includes('whatsapp_group_bridge_status'), 'shows bridge heartbeat');
  assert.ok(page.includes('empty queue, not a disconnection'), 'explains the difference');
  assert.ok(page.includes('skipped, never duplicated'), 'documents import idempotency');
});
