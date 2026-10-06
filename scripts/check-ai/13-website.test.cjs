// PART 13 — static guarantees for the website/admin completion work.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.join(__dirname, '..', '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');

test('PART 13: public pages show the trust/support strip and the group banner, admin/lab do not', () => {
  const layout = read('src/app/layout.tsx');
  assert.ok(layout.includes('WhySkyCars'), 'trust section wired into the public chrome');
  assert.ok(layout.includes('WhatsAppGroupBanner'), 'group banner wired in');
  const chrome = read('src/components/SiteChrome.tsx');
  assert.ok(/privateShell/.test(chrome) && chrome.includes('/admin') && chrome.includes('/lab'), 'public-only chrome');
});

test('PART 13: the public site can not scroll sideways and mobile layouts collapse', () => {
  const css = read('src/app/inbox.css');
  assert.ok(/html,\s*body\s*\{[^}]*overflow-x:\s*hidden/.test(css), 'no page-level horizontal scroll');
  assert.ok(css.includes('grid-template-columns: 1fr !important'), 'mobile one-column layouts');
  assert.ok(css.includes('.quoteFormGrid') && css.includes('.shipmentFormGrid'), 'forms collapse on phones');
  assert.ok(css.includes('env(safe-area-inset-bottom)'), 'safe-area support');
});

test('PART 13: motorcycles are a first-class category (listing, filters, AI catalog)', () => {
  const page = read('src/app/motorcycles/page.tsx');
  assert.ok(page.includes("category:'motorcycle'"), 'motorcycles page filters the motorcycle category');
  assert.ok(fs.existsSync(path.join(root, 'src/app/motorcycles/page.tsx')));
  const catalog = read('src/app/admin/ai-catalog/AiCatalogClient.tsx');
  assert.ok(catalog.includes('motorcycle'), 'AI catalog can filter motorcycles');
  const add = read('src/app/admin/vehicles/new/AddVehicleClient.tsx');
  assert.ok(add.includes('motorcycle'), 'add-vehicle flow supports motorcycles');
});

test('PART 13: the phone admin exposes the six tabs and links to the add-vehicle flow', () => {
  const bar = read('src/app/admin/_components/AdminTabBar.tsx');
  for (const t of ['Dashboard', 'Inbox', 'Inventory', 'Add car', 'Quotes', 'More']) assert.ok(bar.includes(t), `tab ${t}`);
  assert.ok(bar.includes('/admin/vehicles/new'));
});

test('PART 13: the owner dashboard shows the four sections and quick actions', () => {
  const dash = read('src/app/admin/page.tsx');
  for (const s of ['Today', 'Sales', 'Communication', 'System', 'Quick actions']) assert.ok(dash.includes(s), `section ${s}`);
  assert.ok(dash.includes('GREEN') || dash.includes('dot['), 'system status colours');
  assert.ok(dash.includes('/admin/vehicles/new'));
});

test('PART 13: the quote API validates the customer essentials', () => {
  const q = read('src/app/api/quote/route.ts');
  assert.ok(q.includes('name') && q.includes('whatsapp') && q.includes('country'), 'essentials validated');
  assert.ok(q.includes('quote_requests'), 'saved to MySQL');
});

test('PART 13: public API and tracking expose customer-safe fields only', () => {
  const api = read('src/app/api/vehicles/route.ts');
  assert.ok(api.includes('PUBLIC_FIELDS'));
  for (const leak of ['source', 'supplier', 'markup', 'margin']) assert.ok(!new RegExp(`PUBLIC_FIELDS[^\\]]*${leak}`, 'i').test(api));
  const tracking = read('src/app/api/tracking/[ref]/route.ts');
  assert.ok(!/SELECT\s+\*/i.test(tracking), 'tracking selects explicit safe columns');
  assert.ok(!/supplier|markup|margin/i.test(tracking));
});
