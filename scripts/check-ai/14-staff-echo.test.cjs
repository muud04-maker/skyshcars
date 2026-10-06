// PART 14 — staff echo parsing + waiting state (regression for the live "[staff message]" bug).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const load = require('./lib.cjs');
const { parseStaffEcho, isPlaceholderBody, mapMessageType, computeWaiting } = load('ai-rules/staff-echo.js');
const root = path.join(__dirname, '..', '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');

test('1. a text staff echo preserves the exact body', () => {
  const p = parseStaffEcho({ id: 'wamid.1', to: '255700000001', type: 'text', text: { body: 'We have this vehicle available.' } });
  assert.equal(p.body, 'We have this vehicle available.');
  assert.equal(p.hasText, true);
  assert.equal(p.type, 'text');
});

test('2. real text is never replaced with the old "[staff message]" placeholder', () => {
  const p = parseStaffEcho({ type: 'text', text: { body: 'We sold this car.' } });
  assert.notEqual(p.body, '[staff message]');
  assert.equal(p.body, 'We sold this car.');
});

test('3. duplicate webhook echo inserts once (the stored row is recognised by external id)', () => {
  const src = read('src/app/api/whatsapp/webhook/route.ts');
  assert.ok(/SELECT id,sender,body,message_type FROM messages WHERE external_message_id=\?/.test(src), 'existing row looked up by external id');
  assert.ok(src.includes('INSERT IGNORE INTO messages'), 'insert is deduped');
  assert.ok(src.includes('ignored_duplicate'), 'duplicate action recorded');
});

test('4. customer -> staff = NOT waiting', () => {
  assert.equal(computeWaiting([10], [11]), false);
});

test('5. customer -> staff -> customer = waiting', () => {
  assert.equal(computeWaiting([10, 12], [11]), true);
});

test('6. customer -> staff -> customer -> AI = NOT waiting', () => {
  assert.equal(computeWaiting([10, 12], [11, 13]), false);
});

test('7. a staff reply starts/refreshes the AI pause', () => {
  const src = read('src/app/api/whatsapp/webhook/route.ts');
  assert.ok(/pauseAi\(Number\(c\.id\), minutes, 'staff'\)/.test(src), 'pause refreshed on staff echo');
  assert.ok(/clearStaffFlag\(Number\(c\.id\)\)/.test(src), 'needs_staff cleared on staff reply');
  assert.ok(src.includes("UPDATE conversations SET last_message_at=NOW()"), 'last_message_at updated');
});

test('8. the staff sold message reaches the AI context with its real text', () => {
  const p = parseStaffEcho({ type: 'text', text: { body: 'We sold this car.' } });
  assert.equal(p.body, 'We sold this car.');
  const engine = read('src/lib/ai-rules/engine-core.ts');
  assert.ok(engine.includes('lastStaffBody'), 'engine reads the real staff body');
  const override = read('src/lib/ai-rules/staff-override.ts');
  assert.ok(override.includes('That one has been sold'), 'staff sold overrides availability claims');
});

test('9. an AI echo is never reclassified as staff', () => {
  const src = read('src/app/api/whatsapp/webhook/route.ts');
  // Reconciliation only updates body/type; the sender of an existing row is never rewritten.
  assert.ok(/UPDATE messages SET body=\?,message_type=\? WHERE id=\?/.test(src));
  assert.ok(!/UPDATE messages SET[^']*sender/.test(src), 'sender is never updated on reconcile');
});

test('10. an admin STAFF send followed by the Meta echo stays one row', () => {
  const src = read('src/app/api/whatsapp/webhook/route.ts');
  assert.ok(src.includes('INSERT IGNORE INTO messages'), 'echo cannot create a second row');
  const reply = read('src/app/api/admin/conversations/[id]/reply/route.ts');
  assert.ok(reply.includes("outbound(Number(id),'human',text)"), 'admin send stored as human/outbound');
});

test('11. an image echo keeps its caption', () => {
  const p = parseStaffEcho({ type: 'image', image: { id: 'MEDIA1', caption: 'Here is the car' } });
  assert.equal(p.body, 'Here is the car');
  assert.equal(p.hasText, true);
  assert.equal(p.mediaId, 'MEDIA1');
  assert.equal(mapMessageType(p.type), 'image');
});

test('12. an image without a caption gets a readable placeholder', () => {
  const p = parseStaffEcho({ type: 'image', image: { id: 'MEDIA2' } });
  assert.equal(p.body, '[Staff sent a photo]');
  assert.equal(p.hasText, false);
  assert.equal(isPlaceholderBody(p.body), true);
});

test('13. a document echo preserves the filename', () => {
  const p = parseStaffEcho({ type: 'document', document: { id: 'DOC1', filename: 'invoice-2291.pdf' } });
  assert.equal(p.body, '[Staff sent document: invoice-2291.pdf]');
  assert.equal(mapMessageType(p.type), 'document');
  const noName = parseStaffEcho({ type: 'document', document: { id: 'DOC2' } });
  assert.equal(noName.body, '[Staff sent a document]');
});

test('14. long / unusual staff text is stored safely and placeholders are reconcilable', () => {
  const long = 'A'.repeat(4000);
  assert.equal(parseStaffEcho({ type: 'text', text: { body: long } }).body.length, 4000);
  assert.equal(parseStaffEcho({ type: 'sticker', sticker: { id: 'S1' } }).body, '[Staff sent a sticker]');
  assert.equal(parseStaffEcho({ type: 'weird_new_type' }).body, '[Staff sent a weird_new_type]');
  assert.equal(parseStaffEcho({ type: 'voice' }).body, '[Staff sent a voice]');
  // an old placeholder row can be upgraded once the real text arrives
  assert.equal(isPlaceholderBody('[staff message]'), true);
  assert.equal(isPlaceholderBody('We have this vehicle available.'), false);
  assert.equal(mapMessageType('interactive'), 'other');
});

test('14b. a staff echo is recognised when Meta sends it as "from us to the customer"', () => {
  const { looksLikeBusinessEcho } = load('ai-rules/staff.js');
  const contacts = ['255700000001'];
  // staff echo: from = our business number, to = a known customer
  assert.equal(looksLikeBusinessEcho({ from: '8615778025441', to: '255700000001' }, contacts), true);
  // normal customer message: from = the known customer
  assert.equal(looksLikeBusinessEcho({ from: '255700000001', to: '8615778025441' }, contacts), false);
  // no contact list -> never treated as an echo
  assert.equal(looksLikeBusinessEcho({ from: '8615778025441', to: '255700000001' }, []), false);
  assert.equal(looksLikeBusinessEcho({}, contacts), false);
});
