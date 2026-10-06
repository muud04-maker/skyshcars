// PART 17 — the AI replies in the customer's detected language (Somali / Arabic / Chinese / English).
const test = require('node:test');
const assert = require('node:assert/strict');
const load = require('./lib.cjs');
const { detectLanguageCode, isShortAmbiguous, preferredToCode, resolveLanguage, languageName } = load('ai-rules/language.js');
const { holdingLine } = load('ai-rules/hold.js');
const { welcomeBlock, detectLanguage } = load('ai-rules/welcome.js');
const { runEngine, customerKey } = load('ai-rules/engine-core.js');

const SITE = 'https://skyshcars.com';
const GROUP = 'https://chat.whatsapp.com/EyGQRCZmdyhKUnXD2H1bIq?s=cl&p=a&mlu=4&ilr=4';
const CFG = { enabled: true, site: SITE, groupLink: GROUP, groupName: 'Sky second hand cars' };

test('1/2. a short Somali message is detected as Somali (the reported bug)', () => {
  assert.equal(detectLanguageCode('Gaari ma haysa'), 'so');
  assert.equal(detectLanguageCode('Gaari ma haysa?'), 'so');
  assert.equal(detectLanguageCode('Sawirada ii soo dir'), 'so');
  assert.equal(detectLanguage('Gaari ma haysa'), 'so');
});

test('3/4. Arabic script is detected', () => {
  assert.equal(detectLanguageCode('\u0645\u0631\u062d\u0628\u0627\u060c \u0647\u0644 \u0644\u062f\u064a\u0643\u0645 \u0633\u064a\u0627\u0631\u0627\u062a\u061f'), 'ar');
});

test('5/6. Chinese (CJK) is detected', () => {
  assert.equal(detectLanguageCode('\u4f60\u597d\uff0c\u6709\u8f66\u5417\uff1f'), 'zh');
  assert.equal(detectLanguageCode('\u4ef7\u683c\u662f\u591a\u5c11'), 'zh');
});

test('7. English stays English', () => {
  assert.equal(detectLanguageCode('Do you have cars'), 'en');
  assert.equal(detectLanguageCode('How much is this car?'), 'en');
});

test('8. a short "ok" does not decide the language (it inherits)', () => {
  assert.equal(detectLanguageCode('ok'), null);
  assert.equal(isShortAmbiguous('ok'), true);
  assert.equal(resolveLanguage({ latest: 'ok', recent: 'Gaari ma haysa' }), 'so');
});

test('9. a short "yes" inherits the English conversation', () => {
  assert.equal(detectLanguageCode('yes'), null);
  assert.equal(resolveLanguage({ latest: 'yes', recent: 'Do you have cars' }), 'en');
});

test('10. a mixed Somali + English message with Somali dominant is Somali', () => {
  assert.equal(resolveLanguage({ latest: 'Gaari ma haysa Toyota?' }), 'so');
});

test('11. an explicit admin language persists across short messages', () => {
  assert.equal(preferredToCode('Somali'), 'so');
  assert.equal(preferredToCode('Arabic'), 'ar');
  assert.equal(preferredToCode('Chinese'), 'zh');
  assert.equal(preferredToCode('Klingon'), null);
  assert.equal(resolveLanguage({ latest: 'ok', preferred: 'Somali' }), 'so');
  // the latest clear message outranks the stored preference (customer switched language)
  assert.equal(resolveLanguage({ latest: 'Do you have cars?', preferred: 'Somali' }), 'en');
});

test('12/13/14. the first-contact welcome is written in the customer language', () => {
  const so = welcomeBlock('so', CFG); assert.ok(so.includes(SITE) && so.includes(GROUP));
  const ar = welcomeBlock('ar', CFG); assert.ok(ar.includes(SITE) && ar.includes(GROUP));
  const zh = welcomeBlock('zh', CFG); assert.ok(zh.includes(SITE) && zh.includes(GROUP));
  assert.notEqual(so, welcomeBlock('en', CFG));
  assert.ok(/Baabuurta kale|Arag/.test(so) === false || true); // content check below
  assert.ok(so.includes('Arag'));
});

test('15. URLs are never translated or altered', () => {
  for (const lang of ['en', 'so', 'ar', 'zh']) {
    const block = welcomeBlock(lang, CFG);
    assert.ok(block.includes(SITE), `${lang} keeps the site URL`);
    assert.ok(block.includes(GROUP), `${lang} keeps the group URL`);
  }
});

test('16. hold messages are short and in the right language', () => {
  assert.equal(holdingLine('en'), 'Let me confirm that for you.');
  assert.equal(holdingLine('so'), 'Waan kuu xaqiijinayaa.');
  assert.ok(holdingLine('ar').length > 5);
  assert.ok(holdingLine('zh').length > 3);
  assert.equal(languageName('so'), 'Somali');
  assert.equal(languageName('zh'), 'Chinese');
});

// --------- live-flow behaviour via the real reply engine -------------------
function makeStore(extra = {}) {
  return {
    conv: { id: 1, channel: 'whatsapp', external_user_id: '255700000001', mode: 'ai', customer_id: 10 },
    messages: [], nextId: 1, answered: 0, pausedUntil: null, lock: null, welcomes: new Set(), sent: [], ...extra,
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
    holdForStaff: async () => {}, lastStaffBody: async () => null,
    welcomeConfig: async () => CFG,
    welcomeAlreadySent: async (key) => s.welcomes.has(key),
    claimWelcome: async (key) => { if (s.welcomes.has(key)) return false; s.welcomes.add(key); return true; },
    releaseWelcome: async (key) => { s.welcomes.delete(key); },
    compose: async (i) => ({ text: s.hold ? 'x' : `[${i.referral ? 'ref' : 'reply'}]`, lang: s.lang || 'so', model: 'deepseek-chat', photoPlan: null, allowedNames: s.hold ? [] : ['2024 Dongfeng Forthing T5'], needsStaff: s.hold ? 'no verified answer' : null }),
    sendText: async (_c, text) => { s.sent.push(text); s.lastOut = text; return 'wamid.out'; },
    storeOutbound: async (_i, text) => { s.messages.push({ id: s.nextId++, type: 'text', body: text, sender: 'ai', direction: 'outbound' }); },
    sendPhotos: async () => {}, flagStaff: async () => {}, event: async () => {},
  };
}
function inbound(s, body) { const id = s.nextId++; s.messages.push({ id, type: 'text', body, sender: 'customer', direction: 'inbound', external_message_id: 'in.' + id }); return id; }

test('17a. a Somali customer gets the Somali hold line', async () => {
  const s = makeStore({ hold: true, lang: 'so' }); inbound(s, 'Gaari ma haysa');
  await runEngine(makeDeps(s), 1, { trigger: 'webhook' });
  assert.ok(s.sent[0].startsWith('Waan kuu xaqiijinayaa.'), 'Somali hold');
  assert.ok(!s.sent[0].includes('Let me confirm'));
});

test('17b. a Somali first-contact reply carries the Somali welcome + the URLs', async () => {
  const s = makeStore({ lang: 'so' }); inbound(s, 'Gaari ma haysa');
  await runEngine(makeDeps(s), 1, { trigger: 'webhook' });
  assert.ok(s.sent[0].includes('Arag dhammaan baabuurtayada'), 'Somali website line');
  assert.ok(s.sent[0].includes(SITE) && s.sent[0].includes(GROUP));
});

test('17c. an Arabic customer gets the Arabic welcome; Chinese gets Chinese', async () => {
  const a = makeStore({ lang: 'ar' }); inbound(a, '\u0645\u0631\u062d\u0628\u0627');
  await runEngine(makeDeps(a), 1, { trigger: 'webhook' });
  assert.ok(a.sent[0].includes(SITE) && a.sent[0].includes(GROUP));
  const c = makeStore({ lang: 'zh' }); inbound(c, '\u4f60\u597d');
  await runEngine(makeDeps(c), 1, { trigger: 'webhook' });
  assert.ok(c.sent[0].includes(SITE) && c.sent[0].includes(GROUP));
  assert.notEqual(a.sent[0], c.sent[0], 'Arabic and Chinese welcomes differ');
  assert.ok(a.sent[0].includes('\u0634\u0627\u0647\u062f'), 'Arabic welcome line present');
  assert.ok(c.sent[0].includes('\u67e5\u770b'), 'Chinese welcome line present');
});

test('18. the welcome is still sent exactly once (no duplicate links)', async () => {
  const s = makeStore({ lang: 'so' }); inbound(s, 'Gaari ma haysa');
  await runEngine(makeDeps(s), 1, { trigger: 'webhook' });
  await runEngine(makeDeps(s), 1, { trigger: 'webhook' });
  assert.equal(s.sent.length, 1);
  assert.equal(s.welcomes.size, 1);
});
