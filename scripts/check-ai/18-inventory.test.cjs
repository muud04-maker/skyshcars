// PART 18 — inventory questions are answered from the AI Catalog instead of the hold branch.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const load = require('./lib.cjs');
const { inventoryIntent, filterInventory, inventoryAnswer, carTitle } = load('ai-rules/inventory-intent.js');
const root = path.join(__dirname, '..', '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');

const FLEET = [
  { id: 1, brand: 'Dongfeng', model: 'Forthing T5', model_year: 2024, price_usd: 7468, category: 'car', trim_name: '', created_at: '2026-10-01T00:00:00Z' },
  { id: 2, brand: 'Toyota', model: 'Corolla', model_year: 2022, price_usd: 7634, category: 'car', trim_name: '', created_at: '2026-09-20T00:00:00Z' },
  { id: 3, brand: 'Toyota', model: 'RAV4', model_year: 2021, price_usd: 9200, category: 'car', trim_name: 'SUV', created_at: '2026-09-10T00:00:00Z' },
  { id: 4, brand: 'Toyota', model: 'Hilux', model_year: 2020, price_usd: 15000, category: 'car', trim_name: 'pickup', created_at: '2026-08-01T00:00:00Z' },
  { id: 5, brand: 'Honda', model: 'CB500', model_year: 2023, price_usd: 5200, category: 'motorcycle', trim_name: '', created_at: '2026-09-25T00:00:00Z' },
  { id: 6, brand: 'Toyota', model: 'Vitz', model_year: 2019, price_usd: 6500, category: 'car', trim_name: '', created_at: '2026-07-01T00:00:00Z' },
];
const answer = (text, lang = 'en', fleet = FLEET) => {
  const inv = inventoryIntent(text, [...new Set(fleet.map((c) => c.brand))]);
  assert.ok(inv, `intent detected for: ${text}`);
  return { inv, ...inventoryAnswer(inv, filterInventory(fleet, inv), lang, { totalAi: fleet.length }) };
};

test('1/2. "Do you have cars?" is answered from the catalog and never holds', () => {
  const a = answer('Do you have cars?');
  assert.equal(a.inv.kind, 'exists');
  assert.match(a.text, /Yes, we have 6/);
  assert.equal(a.needsStaff, false, 'no hold for a grounded inventory question');
});

test('3. Somali "Gaari ma haysa?" answers in Somali from the catalog', () => {
  const a = answer('Gaari ma haysa?', 'so');
  assert.equal(a.needsStaff, false);
  assert.match(a.text, /Haa, waxaan haynaa/);
});

test('4. an Arabic inventory question answers in Arabic', () => {
  const a = answer('\u0647\u0644 \u0644\u062f\u064a\u0643\u0645 \u0633\u064a\u0627\u0631\u0627\u062a\u061f', 'ar');
  assert.equal(a.needsStaff, false);
  assert.ok(/[\u0600-\u06FF]/.test(a.text), 'Arabic text');
});

test('5. a Chinese inventory question answers in Chinese', () => {
  const a = answer('\u6709\u8f66\u5417\uff1f', 'zh');
  assert.equal(a.needsStaff, false);
  assert.ok(/[\u4E00-\u9FFF]/.test(a.text), 'Chinese text');
});

test('6. "What cars do you have?" lists at most 3 real catalog cars', () => {
  const a = answer('What cars do you have?');
  const lines = a.text.split('\n').filter((l) => l.trim().startsWith('-'));
  assert.ok(lines.length > 0 && lines.length <= 3, `max 3 cars, got ${lines.length}`);
  const titles = FLEET.map(carTitle);
  for (const l of lines) assert.ok(titles.some((t) => l.includes(t)), `line from real stock: ${l}`);
});

test('7. "Any Toyota?" matches only Toyota', () => {
  const a = answer('Any Toyota?');
  assert.equal(a.inv.brand, 'Toyota');
  const matched = filterInventory(FLEET, a.inv);
  assert.equal(matched.length, 4);
  assert.ok(matched.every((c) => c.brand === 'Toyota'));
  assert.match(a.text, /4 Toyota/);
});

test('8. a brand with no stock gets an honest no-match answer (no hold)', () => {
  const fleet = FLEET.filter((c) => c.brand !== 'Toyota');
  const a = answer('Do you have Toyota?', 'en', fleet);
  assert.equal(a.needsStaff, false);
  assert.match(a.text, /don't currently have a Toyota/i);
});

test('9. "Do you have motorcycles?" searches the motorcycle category', () => {
  const a = answer('Do you have motorcycles?');
  assert.equal(a.inv.category, 'motorcycle');
  const matched = filterInventory(FLEET, a.inv);
  assert.deepEqual(matched.map((c) => c.id), [5]);
});

test('10. "SUV?" becomes a body-type/category filter', () => {
  const a = answer('SUV?');
  assert.equal(a.inv.kind, 'category');
  assert.equal(a.inv.bodyType, 'suv');
  assert.deepEqual(filterInventory(FLEET, a.inv).map((c) => c.id), [3]);
});

test('11. "cars under $7000" filters by price', () => {
  const a = answer('cars under $7000');
  assert.equal(a.inv.kind, 'budget');
  assert.equal(a.inv.maxPrice, 7000);
  const matched = filterInventory(FLEET, a.inv);
  assert.ok(matched.length >= 1 && matched.every((c) => Number(c.price_usd) <= 7000));
});

test('12/13. only AI-enabled Available rows can appear (catalog query is the source)', () => {
  const compose = read('src/lib/sales-compose.ts');
  assert.ok(compose.includes('loadAiCars(300)'), 'answers come from the AI catalog query');
  const catalog = read('src/lib/ai-catalog.ts');
  assert.ok(catalog.includes('aiCarSqlFor'), 'catalog mode + ai_enabled + Available enforced');
  // a car that is not in the passed list can never be returned
  assert.deepEqual(filterInventory(FLEET.filter((c) => c.id !== 5), { kind: 'category', category: 'motorcycle' }), []);
});

test('14. zero AI inventory is honest and asks staff', () => {
  const a = inventoryAnswer({ kind: 'exists' }, [], 'en', { totalAi: 0 });
  assert.equal(a.needsStaff, true);
  assert.match(a.text, /don't have any vehicles enabled/i);
  const so = inventoryAnswer({ kind: 'exists' }, [], 'so', { totalAi: 0 });
  assert.match(so.text, /ma jiro/);
});

test('15. a short follow-up "Toyota" uses the brand filter', () => {
  const a = answer('Toyota');
  assert.equal(a.inv.kind, 'brand');
  assert.ok(filterInventory(FLEET, a.inv).length === 4);
});

test('16. genuinely unknown questions (shipping/pricing detail) still use the hold path', () => {
  assert.equal(inventoryIntent('How much is shipping to Mombasa?'), null);
  assert.equal(inventoryIntent('Can you deliver a car to Kenya and what is the freight?'), null);
  assert.equal(inventoryIntent('track my shipment'), null);
});

test('17. the compose path returns the grounded answer BEFORE calling the model', () => {
  const src = read('src/lib/sales-compose.ts');
  const invIdx = src.indexOf('inventoryIntent(i.words');
  const modelIdx = src.indexOf('await salesReply(text');
  assert.ok(invIdx > 0 && modelIdx > 0 && invIdx < modelIdx, 'inventory branch runs first');
  assert.ok(src.includes('needsStaff: ans.needsStaff ?'), 'hold only when the catalog is empty');
});
