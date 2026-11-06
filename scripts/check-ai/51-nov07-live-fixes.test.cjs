// Nov 7 live failures: Yamaha MT-09 photos, "do you have pick up" -> "Let me confirm", repeated names,
// learning from staff replies.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.join(__dirname, '..', '..');
const B = (m) => require(path.join(root, '.check-build/src/lib', m));
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');

const inv = B('ai-rules/inventory-intent.js');
const pick = B('ai-rules/photo-pick.js');
const guard = B('ai-rules/answer-guard.js');
const pb = B('ai-rules/staff-playbook.js');
const match = B('ai-rules/match.js');

const yamaha = [
  { id: 10700, stock_no: '879', category: 'motorcycle', brand: 'Yamaha MT-09', model: 'Yamaha MT-09', model_year: 2018, price_usd: 6515 },
  { id: 10702, stock_no: '881', category: 'motorcycle', brand: 'Yamaha', model: 'MT-09', model_year: 2016, price_usd: 4833 },
  { id: 10698, stock_no: '878', category: 'motorcycle', brand: 'Yamaha', model: 'R1', model_year: 2016, price_usd: 9091 },
];

test('repeated brand/model never appears in inventory answers ("2018 Yamaha MT-09 Yamaha MT-09")', () => {
  assert.equal(inv.carTitle(yamaha[0]), '2018 Yamaha MT-09');
  const ans = inv.inventoryAnswer({ kind: 'brand', brand: 'Yamaha' }, yamaha, 'en', { totalAi: 100 });
  assert.doesNotMatch(ans.text, /MT-09 Yamaha MT-09/);
});

test('"do you have pick up" is an inventory question about pickups, not a model name', () => {
  for (const t of ['Hello do you have pick up', 'do you have pick-up', 'Any pickup?']) {
    const i = inv.inventoryIntent(t, ['Yamaha', 'Haval']);
    assert.equal(i && i.bodyType, 'pickup', t);
  }
  assert.equal(match.isGenericOnly('Hello do you have pick up'), true);
});

test('no pickup in stock -> honest "none listed, we can source" answer (never "Let me confirm")', () => {
  const a = inv.inventoryAnswer({ kind: 'category', bodyType: 'pickup' }, [], 'en', { totalAi: 170 });
  assert.match(a.text, /don't have a pickup listed right now/);
  assert.doesNotMatch(a.text, /Let me confirm/);
  assert.equal(a.needsStaff, false);
});

test('pickups are recognised by model name even without a body-type column', () => {
  assert.equal(inv.matchesBodyType({ model: 'Fengjun 7', trim_name: null }, 'pickup'), true);
  assert.equal(inv.matchesBodyType({ model: 'Hilux Revo' }, 'pickup'), true);
  assert.equal(inv.matchesBodyType({ model: 'Corolla' }, 'pickup'), false);
});

test('"Yamaha Mt09" narrows to the MT-09 units only (no R1) and they count as one model', () => {
  const units = pick.narrowToNamedModel(yamaha, 'Yamaha Mt09');
  assert.deepEqual(units.map((u) => u.stock_no).sort(), ['879', '881']);
  assert.equal(pick.namedSpecificModel(yamaha, units), true);
  assert.equal(pick.sameModel(units), true);
  assert.equal(pick.sameModel(yamaha), false);
});

test('a brand-only message keeps the whole brand list; R1 is matched by its own name', () => {
  assert.equal(pick.narrowToNamedModel(yamaha, 'Do you have Yamaha?').length, 3);
  assert.deepEqual(pick.narrowToNamedModel(yamaha, 'yamaha r1 price').map((u) => u.stock_no), ['878']);
});

test('"2016" after the photo request picks the 2016 MT-09', () => {
  const units = yamaha.slice(0, 2);
  assert.deepEqual(pick.narrowByYear(units, '2016').map((u) => u.stock_no), ['881']);
  assert.deepEqual(pick.narrowByYear(units, 'I asked you to send me the images', 'Yamaha Mt09 2016').map((u) => u.stock_no), ['881']);
  assert.equal(pick.narrowByYear(units, 'send pictures').length, 2);
});

test('replies are only held for unverified money amounts, not for ordinary questions', () => {
  const policy = 'Cars shipping $1,200-$2,000. Motorcycles $300-$500.';
  const ok = guard.decideHold({ reply: 'We are in Guangzhou, China, and we ship to your country.', wantsAnswer: true, grounded: false, verified: [policy] });
  assert.equal(ok.hold, false);
  const ranges = guard.decideHold({ reply: 'Car shipping is usually $1,200 to $2,000 depending on the port.', wantsAnswer: true, grounded: false, verified: [policy] });
  assert.equal(ranges.hold, false);
  const invented = guard.decideHold({ reply: 'Shipping to Lagos is $850.', wantsAnswer: true, grounded: false, verified: [policy] });
  assert.equal(invented.hold, true);
  assert.match(invented.flag, /\$850/);
  assert.equal(guard.decideHold({ reply: '', wantsAnswer: true, grounded: false, verified: [] }).hold, true);
  const unsure = guard.decideHold({ reply: 'Our team will confirm the exact port fees for you.', wantsAnswer: true, grounded: false, verified: [] });
  assert.equal(unsure.hold, false);
  assert.ok(unsure.flag);
});

test('staff playbook pairs customer questions with the staff answer and ignores broadcasts', () => {
  const t = (m) => `2026-11-0${m}`;
  const rows = [
    { id: 1, conversation_id: 1, sender: 'customer', message_type: 'text', body: 'Where are you located?', created_at: '2026-11-01 10:00:00' },
    { id: 2, conversation_id: 1, sender: 'human', message_type: 'text', body: 'We are located in Guangzhou China', created_at: '2026-11-01 10:05:00' },
    { id: 3, conversation_id: 2, sender: 'customer', message_type: 'text', body: 'How much shipping to Mombasa', created_at: '2026-11-01 10:00:00' },
    { id: 4, conversation_id: 2, sender: 'human', message_type: 'image', body: '[Staff sent a photo]', created_at: '2026-11-01 10:01:00' },
    { id: 5, conversation_id: 2, sender: 'human', message_type: 'text', body: 'Join our WhatsApp group', created_at: '2026-11-01 10:02:00' },
  ];
  for (let c = 10; c < 16; c++) rows.push({ id: 100 + c, conversation_id: c, sender: 'human', message_type: 'text', body: 'Join our WhatsApp group', created_at: '2026-11-01 09:00:00' });
  const pairs = pb.buildPairs(rows);
  assert.equal(pairs.length, 1);
  assert.equal(pairs[0].a, 'We are located in Guangzhou China');
  const hits = pb.similarPairs('where is your location', pairs, { k: 3, excludeConversationId: 99 });
  assert.equal(hits.length, 1);
  assert.equal(pb.similarPairs('where is your location', pairs, { excludeConversationId: 1 }).length, 0);
  assert.match(pb.playbookNote(hits), /HOW OUR STAFF ANSWERED/);
  assert.match(pb.playbookNote(hits), /never copy a price/);
});

test('compose path no longer replaces answers with the hold line just because no car was named', () => {
  const src = read('src/lib/sales-compose.ts');
  assert.match(src, /decideHold\(/);
  assert.doesNotMatch(src, /No verified answer in the database for this request - confirm before replying/);
  assert.match(src, /staffReferenceNote\(/);
  assert.match(src, /planPhotosForVehicles\(/);
});

test('photo sender delivers a second unit of the same model with its own caption', () => {
  const src = read('src/lib/whatsapp-photos.ts');
  assert.match(src, /plan\.more/);
  assert.match(src, /export async function planPhotosForVehicles/);
});
