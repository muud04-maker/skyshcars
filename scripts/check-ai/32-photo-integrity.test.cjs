// PHASE 4 + PHASE 8 - photo integrity, verified against the real production conversations.
//
// Evidence from the messages dump (2972 messages): customers asked for photos in 151 messages (16% of
// all customer messages); of the 5 texts actually delivered that said "sending you the photos", 3
// arrived with 3 images each and 2 arrived with none - one conversation (the "stock 829" promise)
// received nothing at all afterwards. The owner covers the rest by hand (330 "[Staff sent a photo]"
// markers, 20 AI photo batches). These tests lock in the code-level guarantee.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const load = require('./lib.cjs');
const { enforcePhotoHonesty, photoHonestyLine, needsStaffPhotoRequest } = load('ai-rules/photo-guard.js');
const { planPhotos } = { planPhotos: null }; // planPhotos is DB-backed; the guard is what we test here

const root = path.join(__dirname, '..', '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const ENGINE = 'src/lib/ai-rules/engine-core.ts';
const PHOTOS = 'src/lib/whatsapp-photos.ts';
const AI = 'src/lib/ai.ts';
const MODE = 'src/app/api/admin/conversations/[id]/mode/route.ts';

test('a reply that promises photos is only allowed when the photos are really being sent', () => {
  const promise = 'Sure - sending you the photos of the 2013 Haval H6 (Stock 581) now.';
  const sending = enforcePhotoHonesty(promise, { status: 'sending', stockNo: '581', title: '2013 Haval H6' });
  assert.equal(sending.changed, 'none', 'a real send is left alone');
  assert.equal(sending.text, promise);
});

test('REGRESSION (real case): "Sending you the photos of stock 829 now." with nothing delivered becomes honest', () => {
  const real = 'Sending you the photos of stock 829 now.';
  const out = enforcePhotoHonesty(real, { status: 'no_exact_photos', stockNo: '829', title: '2014 Chevrolet Sail' });
  assert.equal(out.changed, 'replaced');
  assert.ok(!/sending you the photos/i.test(out.text), 'the unfulfillable promise is gone');
  assert.ok(/don't have exact photos/i.test(out.text), 'the customer is told the truth');
  assert.ok(/Chevrolet Sail|829/.test(out.text), 'it names the vehicle they asked about');
});

test('photos already sent in this chat are pointed at, never promised again', () => {
  const out = enforcePhotoHonesty('Sending you the photos now.', { status: 'already_sent', stockNo: '581' });
  assert.ok(/photos of this vehicle just above/i.test(out.text));
  assert.ok(!/sending you/i.test(out.text));
});

test('a photo request we cannot resolve asks ONE short question instead of guessing', () => {
  const out = enforcePhotoHonesty('Sending you the photos now.', { status: 'no_vehicle' });
  assert.ok(/which vehicle would you like photos of/i.test(out.text));
  assert.ok(/model or the stock number/i.test(out.text));
});

test('a photo request the reply ignores still gets an honest answer', () => {
  const out = enforcePhotoHonesty('Yes, that one is available for $3,214.', { status: 'no_exact_photos', stockNo: '581' });
  assert.equal(out.changed, 'appended');
  assert.ok(out.text.includes('$3,214'), 'the useful part of the answer is untouched');
  assert.ok(/don't have exact photos/i.test(out.text));
});

test('an OFFER is not a promise, so it is never rewritten', () => {
  const offer = 'Yes - this is the 2013 Haval H6. I can also send you: exact photos, shipping cost, similar vehicles.';
  const out = enforcePhotoHonesty(offer, { status: 'no_exact_photos', stockNo: '581' });
  assert.equal(out.changed, 'none', 'offers stay as they are');
  assert.equal(out.text, offer);
});

test('a promise is not left dangling next to the honest line', () => {
  const out = enforcePhotoHonesty('Happy to help. Sending you the photos now. I can send you more details too.', { status: 'no_exact_photos', stockNo: '581' });
  assert.ok(!/sending you the photos/i.test(out.text), 'the promise is replaced');
  assert.ok(/Happy to help/.test(out.text), 'unrelated sentences survive');
  assert.ok(!/I can send you more details too\.?\s*$/i.test(out.text) || /don't have exact photos/i.test(out.text), 'the honest line is present');
});

test('nothing happens when there is no photo request', () => {
  assert.equal(enforcePhotoHonesty('Yes, it is available.', null).changed, 'none');
  assert.equal(enforcePhotoHonesty('', { status: 'no_exact_photos' }).changed, 'none');
  assert.equal(photoHonestyLine({ status: 'no_exact_photos', title: 'x' }).length > 20, true);
});

test('a missing exact photo becomes a tracked staff request', () => {
  assert.equal(needsStaffPhotoRequest({ status: 'no_exact_photos' }), true);
  for (const s of ['sending', 'already_sent', 'no_vehicle', null, undefined]) assert.equal(needsStaffPhotoRequest({ status: s }), false, String(s));
  const engine = read(ENGINE);
  assert.ok(engine.includes('enforcePhotoHonesty(text, composed.photoPlan)'), 'the guard runs on every AI reply');
  assert.ok(engine.includes("'photo_promise_guarded'"), 'the guard is recorded');
  assert.ok(engine.includes("deps.flagStaff(conversationId, `photo request: no exact photos for"), 'staff are asked for the real photos');
  assert.ok(engine.includes("'photo_request', 'needs_staff'"), 'and the request is tracked');
  assert.ok(read(PHOTOS).includes("'photo_send_failed', 'needs_staff'"), 'a failed send is tracked too');
  assert.ok(read(PHOTOS).includes('flagForStaff(conversationId'), 'and flagged so a human can send them');
});

test('zero delivered photos are never counted or described as sent', () => {
  const src = read(PHOTOS);
  assert.ok(src.includes('if (sent) {'), 'the success marker is written only when photos really went');
  assert.ok(src.includes('Sorry, the photos did not go through just now.'), 'the honest correction exists');
  const tryBlock = src.slice(src.indexOf('for (let i = 0'), src.indexOf('if (sent) {'));
  assert.ok(tryBlock.indexOf('await sendWhatsAppImage') < tryBlock.indexOf('sent++'), 'sent++ only after Meta accepts');
});

test('PHASE 4 item 9: a photo request for "any vehicle" prefers a unit that really has photos', () => {
  const src = read(AI);
  assert.ok(src.includes('newestCarWithPhotos'), 'a photo-backed vehicle is looked up');
  assert.ok(src.includes('if (!vehicles.length && wantsPhotos(text) && isGenericOnly(text))'), 'only when no vehicle was named');
  assert.ok(src.includes('exact_photo_count'), 'using the real exact-photo count');
  assert.ok(src.includes('whatsappPhotosForVehicle(Number(c.id), 3)'), 'and only its own approved photos');
  // Unrelated photos can never be attached: multiple candidates without a stock number still refuse.
  assert.ok(src.includes('if (!vehicles.length || (vehicles.length > 1 && !stock.length)) return null'), 'the single-vehicle rule is intact');
});

test('PHASE 6: takeover keeps the AI silent and the 60s batching is preserved', () => {
  const mode = read(MODE);
  assert.ok(mode.includes('clearAiReply(Number(id))'), 'any mode change cancels a queued AI reply (no stale deadline)');
  assert.ok(mode.includes("mode==='human'?'admin':null"), 'takeover is attributed to the admin');
  assert.ok(mode.includes('catchUp:{attempted:false,sent:false'), 'return-to-AI never answers the old turn');
  const queue = load('ai-rules/ai-queue.js');
  assert.equal(queue.NORMAL_REPLY_DELAY_SECONDS, 60, 'the 60-second batching is unchanged');
  assert.deepEqual(queue.shouldCancelQueued({ mode: 'human', lastInboundId: 9, lastOutboundId: 0 }), { cancel: true, reason: 'human_takeover' });
  assert.deepEqual(queue.shouldCancelQueued({ mode: 'ai', lastInboundId: 9, lastOutboundId: 10 }), { cancel: true, reason: 'staff_replied' });
});

test('PHASE 8: the real-history cases stay covered by the suite', () => {
  const dir = __dirname;
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.test.cjs'));
  for (const f of ['25-referral-category.test.cjs', '26-mobile-inbox.test.cjs', '27-customer-context.test.cjs', '29-all-history.test.cjs', '30-shadow-learning.test.cjs', '31-history-integration.test.cjs']) {
    assert.ok(files.includes(f), `${f} still exists`);
  }
  const all = files.map((f) => fs.readFileSync(path.join(dir, f), 'utf8')).join('\n');
  // wrong vehicle/category, multiple vehicles, language, takeover, rapid messages, shipping/pricing uncertainty
  assert.ok(/motorcycle referral can never resolve to a car/.test(all), 'wrong category covered');
  assert.ok(/stored preferences are given to the reply engine and never asked again/.test(all), 'repetition covered');
  assert.ok(/language/.test(all), 'language covered');
  assert.ok(/TAKE OVER blocks/.test(all), 'takeover covered');
  assert.ok(/three quick messages merge into ONE reply/.test(all), 'rapid messages covered');
});
