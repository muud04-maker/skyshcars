// PART 16 — live fixes: outbound photo transcript, welcome reliability, catalog UX, encoding,
// and the homepage "New Arrivals = Available + last 10 days" rule.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const load = require('./lib.cjs');
const { runEngine, customerKey } = load('ai-rules/engine-core.js');
const { selectNewArrivals, isRecentAvailable, ARRIVAL_DAYS, ARRIVAL_LIMIT } = load('ai-rules/arrivals.js');

const root = path.join(__dirname, '..', '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const SITE = 'https://skyshcars.com';
const GROUP = 'https://chat.whatsapp.com/EyGQRCZmdyhKUnXD2H1bIq?s=cl&p=a&mlu=4&ilr=4';

// ---------------------------------------------------------------- PHOTOS (A)
const PHOTOS = 'src/lib/whatsapp-photos.ts';

test('A1. each exact photo is stored as its own outbound message row', () => {
  const src = read(PHOTOS);
  assert.ok(/outbound\(conversationId, 'ai', caption, AI_MODEL, \{ type: 'image', mediaUrl: plan\.images\[i\]/.test(src), 'per-image outbound row with the media URL');
  assert.ok(src.includes('externalId: metaId'), 'Meta message id stored');
});

test('A2. only successfully delivered photos increment the count', () => {
  const src = read(PHOTOS);
  const tryBlock = src.slice(src.indexOf('for (let i = 0'), src.indexOf('if (sent)'));
  assert.ok(tryBlock.indexOf('await sendWhatsAppImage') < tryBlock.indexOf('sent++'), 'sent++ only after Meta accepts');
  assert.ok(!/sent\+\+[\s\S]*catch/.test(tryBlock.replace(/sent\+\+;/, '\n')), 'no count on failure');
});

test('A3. the success label reports the real sent count and never claims photos when none went', () => {
  const src = read(PHOTOS);
  assert.ok(/sentMarker\(plan\.stockNo \|\| ''\)\} \$\{sent\} photo/.test(src), 'label uses the actual count');
  assert.ok(src.includes('Sorry, the photos did not go through'), 'honest message when none were delivered');
});

test('A4. exact-photo rules are unchanged (only exact photos are planned)', () => {
  const src = read(PHOTOS);
  assert.ok(src.includes('if (!media.exact) return { ...base, status: \'no_exact_photos\', images: [] }'));
  assert.ok(src.includes('media.images'));
});

test('A5. the admin transcript renders stored media (own URL or Meta proxy)', () => {
  const desk = read('src/app/admin/_components/ConversationDesk.tsx');
  assert.ok(desk.includes('function mediaSrc('), 'resolves meta: ids vs stored URLs');
  assert.ok(desk.includes('mediaThumb') && desk.includes('loading="lazy"'));
  assert.ok(desk.includes('setLightbox(mediaSrc(m))'), 'click to enlarge');
  assert.ok(desk.includes("m.message_type === 'document'"), 'document open control');
});

// ---------------------------------------------------------------- WELCOME (C)
function makeStore(extra = {}) {
  return {
    conv: { id: 1, channel: 'whatsapp', external_user_id: '255700000001', mode: 'ai', customer_id: 10 },
    messages: [], nextId: 1, answered: 0, pausedUntil: null, lock: null,
    welcomes: new Set(), claimed: 0, sent: [], needsStaff: null, ...extra,
  };
}
function makeDeps(s) {
  const inbound = () => s.messages.filter((m) => m.direction === 'inbound');
  return {
    sleep: async () => {}, now: () => Date.now(),
    loadConversation: async () => ({ ...s.conv }),
    tryLock: async () => { if (s.lock) return null; s.lock = 'L'; return 'L'; }, unlock: async () => { s.lock = null; },
    getState: async () => ({ answered_through_id: s.answered, ai_paused_until: s.pausedUntil }),
    lastAnsweredOutboundId: async () => 0,
    burst: async (_i, afterId) => s.messages.filter((m) => m.direction === 'inbound' && m.id > afterId).map((m) => ({ id: m.id, message_type: m.type, body: m.body, external_message_id: m.external_message_id })),
    referralIds: async () => new Set(),
    isFirstContact: async (_c, firstId) => !inbound().some((m) => m.id < firstId),
    lastOutboundBody: async () => s.lastOut || null,
    hasNewerCustomerMessage: async (_i, afterId) => inbound().some((m) => m.id > afterId),
    markAnswered: async (_i, through) => { s.answered = Math.max(s.answered, through); },
    channelReady: () => true, resolveReferral: async () => null, setCurrentCar: async () => {},
    holdForStaff: async () => { s.held = (s.held || 0) + 1; }, lastStaffBody: async () => s.staffText || null,
    welcomeConfig: async () => ({ enabled: true, site: SITE, groupLink: GROUP, groupName: 'Sky second hand cars' }),
    welcomeAlreadySent: async (key) => s.welcomes.has(key),
    claimWelcome: async (key) => { s.claimed++; if (s.welcomes.has(key)) return false; s.welcomes.add(key); return true; },
    releaseWelcome: async (key) => { s.welcomes.delete(key); },
    compose: async () => ({ text: s.aiText || 'Yes, this Dongfeng Forthing T5 is available for $7,468.', lang: 'en', model: 'deepseek-chat', photoPlan: null, allowedNames: ['2024 Dongfeng Forthing T5'], needsStaff: s.needsStaff }),
    sendText: async (_c, text) => { if (s.failSend) throw new Error('meta down'); s.sent.push(text); s.lastOut = text; return 'wamid.out'; },
    storeOutbound: async (_i, text) => { s.messages.push({ id: s.nextId++, type: 'text', body: text, sender: 'ai', direction: 'outbound' }); },
    sendPhotos: async () => {}, flagStaff: async () => {},
    event: async () => {},
  };
}
function inbound(s, body) { const id = s.nextId++; s.messages.push({ id, type: 'text', body, sender: 'customer', direction: 'inbound', external_message_id: 'in.' + id }); return id; }
const KEY = () => customerKey('whatsapp', '255700000001');

test('C1. a brand-new customer gets website + group in the FIRST reply', async () => {
  const s = makeStore(); inbound(s, 'Do you have this car?');
  const r = await runEngine(makeDeps(s), 1, { trigger: 'webhook' });
  assert.equal(r.status, 'sent');
  assert.ok(s.sent[0].includes(SITE), 'website present');
  assert.ok(s.sent[0].includes(GROUP), 'configured group link present');
});

test('C2. a holding reply for a new customer ALSO carries the links', async () => {
  const s = makeStore({ needsStaff: 'no verified answer' }); inbound(s, 'Can you ship to Mombasa and what is the price?');
  const r = await runEngine(makeDeps(s), 1, { trigger: 'webhook' });
  assert.equal(r.status, 'sent');
  assert.ok(s.sent[0].startsWith('Let me confirm that for you.'), 'short holding line');
  assert.ok(s.sent[0].includes(SITE) && s.sent[0].includes(GROUP), 'links attached to the holding reply');
  assert.equal(s.welcomes.size, 1, 'welcome claimed once');
});

test('C3. later replies never repeat the links automatically', async () => {
  const s = makeStore({ welcomes: new Set([KEY()]) }); inbound(s, 'And how much is it?');
  const r = await runEngine(makeDeps(s), 1, { trigger: 'webhook' });
  assert.equal(r.status, 'sent');
  assert.ok(!s.sent[0].includes(GROUP) && !s.sent[0].includes('skyshcars.com'), 'no repeat links');
});

test('C4. a webhook retry never produces a second welcome', async () => {
  const s = makeStore(); inbound(s, 'Hello');
  await runEngine(makeDeps(s), 1, { trigger: 'webhook' });
  await runEngine(makeDeps(s), 1, { trigger: 'webhook' });
  assert.equal(s.sent.length, 1);
  assert.equal(s.welcomes.size, 1);
});

test('C5. a failed welcome delivery keeps the customer eligible (no burn)', async () => {
  const s = makeStore({ failSend: true }); inbound(s, 'Do you have this car?');
  const r = await runEngine(makeDeps(s), 1, { trigger: 'webhook' });
  assert.equal(r.status, 'failed');
  assert.equal(s.welcomes.size, 0, 'claim released');
});

test('C6. an existing backfilled customer gets no surprise welcome', async () => {
  const s = makeStore({ welcomes: new Set([KEY()]) }); inbound(s, 'hi, any Toyota?');
  await runEngine(makeDeps(s), 1, { trigger: 'webhook' });
  assert.ok(!s.sent[0].includes(GROUP));
});

test('C7. the website/group are allowed again when the customer explicitly asks', async () => {
  const s = makeStore({ welcomes: new Set([KEY()]), aiText: 'Sure: https://skyshcars.com and https://chat.whatsapp.com/ABC123' });
  inbound(s, 'send me the website and the group link please');
  const r = await runEngine(makeDeps(s), 1, { trigger: 'webhook' });
  assert.equal(r.status, 'sent');
  assert.ok(s.sent[0].includes('skyshcars.com') && s.sent[0].includes('chat.whatsapp.com'));
});

test('C8. the admin reset-welcome action exists, is guarded and documented in the UI', () => {
  const route = read('src/app/api/admin/conversations/[id]/reset-welcome/route.ts');
  assert.ok(route.includes('adminDenied') && route.includes('releaseWelcome'));
  const desk = read('src/app/admin/_components/ConversationDesk.tsx');
  assert.ok(desk.includes('reset-welcome'));
  assert.ok(desk.includes('eligible to send again'), 'confirmation wording');
  assert.ok(desk.includes("Welcome: {welcome?.sent_at"), 'drawer shows the welcome status');
});

// ---------------------------------------------------------------- CATALOG (B)
const CATALOG = 'src/app/admin/ai-catalog/AiCatalogClient.tsx';

test('B1. the selection toolbar only appears when rows are selected', () => {
  const src = read(CATALOG);
  assert.ok(/\{sel\.length \? <div className="bulkBar">/.test(src), 'bulk bar is conditional');
});

test('B2. selected rows expose bulk actions + clear', () => {
  const src = read(CATALOG);
  assert.ok(src.includes('Enable AI') && src.includes('Disable AI') && src.includes('>Clear</button>'));
});

test('B3. the Add vehicles picker shows only vehicles not yet in the AI', () => {
  assert.ok(read(CATALOG).includes("filter: 'off'"), 'picker filters to AI-off vehicles');
});

test('B4. dangerous global actions moved behind More + confirmation', () => {
  const src = read(CATALOG);
  assert.ok(src.includes('>More</button>'));
  assert.ok(/confirm|act\(\{ action: 'enable_all' \}, '/.test(src), 'confirmation text present');
  assert.ok(src.includes('Disable all AI vehicles'));
});

test('B5. the header is simple: counts, mode, two primary actions', () => {
  const src = read(CATALOG);
  assert.ok(src.includes('vehicles the AI can sell'));
  assert.ok(src.includes('+ Add vehicles') && src.includes('+ New vehicle'));
  assert.ok(src.includes('AI sells:'));
  assert.ok(src.includes('More filters'));
});

// ---------------------------------------------------------------- ENCODING (D)
test('D1. no mojibake sequences remain in source (no double-encoded UTF-8)', () => {
  const dirs = ['src', 'scripts', 'data'];
  const files = [];
  const walk = (d) => fs.readdirSync(path.join(root, d), { withFileTypes: true }).forEach((e) => {
    const rel = path.join(d, e.name);
    if (e.isDirectory()) { if (!['node_modules', '.next', '.git'].includes(e.name)) walk(rel); }
    else if (/\.(ts|tsx|js|mjs|cjs|css)$/.test(e.name)) files.push(rel);
  });
  dirs.forEach(walk);
  const bad = files.filter((f) => /[\u00e2\u20ac][\u201a\u009a\u00a2\u009d\u009c\u2122\u0094]|\u00c2\u00b7|\u00c3\u00a2\u00e2\u20ac/.test(read(f)));
  assert.deepEqual(bad, [], 'mojibake found in: ' + bad.join(', '));
});

test('D2. the vehicle photo caption uses plain ASCII separators', () => {
  const ai = read('src/lib/ai.ts');
  assert.ok(ai.includes('${v.stock_no ? ` | ${v.stock_no}` : \'\'}'), 'ASCII separator in the caption');
  assert.ok(!/\u2022/.test(ai), 'no bullet characters left in generated text');
});

// ---------------------------------------------------------------- HOMEPAGE (D1-D5)
const NOW = Date.parse('2026-10-07T12:00:00Z');
const daysAgo = (d) => new Date(NOW - d * 86400000).toISOString();
const cand = (over) => ({ id: Math.random(), status: 'available', created_at: daysAgo(1), ...over });

test('H1/H2. Available vehicles created today and 9 days ago appear', () => {
  const list = [cand({ id: 1, created_at: daysAgo(0) }), cand({ id: 2, created_at: daysAgo(9) })];
  assert.equal(selectNewArrivals(list, { nowMs: NOW }).length, 2);
  assert.equal(isRecentAvailable(list[0], NOW), true);
  assert.equal(isRecentAvailable(list[1], NOW), true);
});

test('H3. an Available vehicle created 11 days ago does NOT appear', () => {
  const list = [cand({ id: 3, created_at: daysAgo(11) })];
  assert.deepEqual(selectNewArrivals(list, { nowMs: NOW }), []);
  assert.equal(isRecentAvailable(list[0], NOW), false);
});

test('H4/H5/H6. Sold, reserved and hidden vehicles never appear (even from today)', () => {
  for (const status of ['sold', 'reserved', 'hidden', 'pending_verification']) {
    assert.deepEqual(selectNewArrivals([cand({ status, created_at: daysAgo(0) })], { nowMs: NOW }), [], status);
  }
});

test('H7. the homepage never falls back to old inventory', () => {
  const old = [cand({ id: 9, created_at: daysAgo(400) }), cand({ id: 10, created_at: daysAgo(30) })];
  assert.deepEqual(selectNewArrivals(old, { nowMs: NOW }), []);
});

test('H8. demo rows are excluded too', () => {
  assert.deepEqual(selectNewArrivals([cand({ source: 'demo_generated' }), cand({ stock_no: 'DEMO-1' })], { nowMs: NOW }), []);
});

test('H9. results are sorted newest first', () => {
  const list = [cand({ id: 1, created_at: daysAgo(8) }), cand({ id: 2, created_at: daysAgo(0) }), cand({ id: 3, created_at: daysAgo(4) })];
  assert.deepEqual(selectNewArrivals(list, { nowMs: NOW }).map((v) => v.id), [2, 3, 1]);
});

test('H10. the homepage limit is enforced (default 12)', () => {
  const many = Array.from({ length: 40 }, (_v, i) => cand({ id: i, created_at: daysAgo(0) }));
  assert.equal(ARRIVAL_LIMIT, 12);
  assert.equal(ARRIVAL_DAYS, 10);
  assert.equal(selectNewArrivals(many, { nowMs: NOW }).length, 12);
  assert.equal(selectNewArrivals(many, { nowMs: NOW, limit: 5 }).length, 5);
});

test('H11. homepage uses evergreen Available inventory and exposes no arrival dates', () => {
  const v = read('src/lib/vehicles.ts');
  assert.ok(v.includes('v.created_at DESC'), 'internal created_at ordering remains available privately');
  assert.ok(v.includes('publicStatusCondition'), 'public status rules remain in place');
  const home = read('src/app/page.tsx');
  assert.ok(home.includes("getVehicles({limit:12,onlyAvailable:true,sort:'created_desc'})"), 'homepage uses approved available stock');
  assert.ok(home.includes('Explore Our Vehicles'), 'evergreen heading present');
  assert.ok(home.includes('Browse available cars and motorcycles from our current collection.'), 'evergreen subtitle present');
  assert.ok(!home.includes('getNewArrivals'), 'homepage does not use the old arrival window');
  assert.ok(!/last 10 days|Recently added|NEW ARRIVALS|created_at/i.test(home), 'no public arrival-date disclosure');
  assert.ok(home.includes('<VehicleGrid list={featured}/>'), 'available inventory is still rendered');
});
