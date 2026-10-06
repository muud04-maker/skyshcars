// PART 20 — dynamic (any-language) customer language detection.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const load = require('./lib.cjs');
const {
  detectLanguageCode, detectScriptCode, needsModelClassification, parseClassifierResult,
  resolveLanguage, isHardcodedLang, languageName, HARDCODED_LANGS,
} = load('ai-rules/language.js');
const root = path.join(__dirname, '..', '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');

test('1. a French message is not decided locally, so the classifier is used and returns fr', () => {
  assert.equal(needsModelClassification('Je voudrais une voiture automatique'), true);
  assert.equal(parseClassifierResult('{"language_code":"fr","language_name":"French","confidence":0.98}').code, 'fr');
});

test('2/3/4. Swahili, Spanish and Portuguese go to the classifier too', () => {
  for (const t of ['Nataka gari', 'Quiero un coche automatico', 'Quero um carro barato']) {
    assert.equal(needsModelClassification(t), true, t);
  }
  assert.equal(parseClassifierResult('{"language_code":"sw","confidence":0.91}').code, 'sw');
  assert.equal(parseClassifierResult('{"language_code":"es","confidence":0.9}').code, 'es');
  assert.equal(parseClassifierResult('{"language_code":"pt","confidence":0.9}').code, 'pt');
});

test('5. Russian is detected deterministically from the Cyrillic script', () => {
  assert.equal(detectScriptCode('\u041f\u0440\u0438\u0432\u0435\u0442, \u0435\u0441\u0442\u044c \u043c\u0430\u0448\u0438\u043d\u044b?'), 'ru');
  assert.equal(detectLanguageCode('\u041f\u0440\u0438\u0432\u0435\u0442'), 'ru');
  assert.equal(needsModelClassification('\u041f\u0440\u0438\u0432\u0435\u0442'), false);
});

test('6. Urdu is recognised as Arabic script (no Latin guessing)', () => {
  assert.equal(detectScriptCode('\u06a9\u06cc\u0627 \u0622\u067e \u06a9\u06d2 \u067e\u0627\u0633 \u06af\u0627\u0691\u06cc\u0627\u06ba \u06c1\u06cc\u06ba\u061f'), 'ar');
});

test('7. an unknown Latin text either classifies or inherits (never invents English)', () => {
  assert.equal(parseClassifierResult('not json'), null);
  assert.equal(parseClassifierResult('{"language_code":"xx","confidence":0.2}'), null);
  assert.equal(parseClassifierResult('{"language_code":"fr","confidence":0.4}'), null, 'low confidence -> inherit');
  assert.equal(HARDCODED_LANGS.join(','), 'en,so,ar,zh');
  assert.equal(isHardcodedLang('fr'), false);
  assert.equal(isHardcodedLang('so'), true);
  assert.equal(languageName('sw'), 'Swahili');
  assert.equal(languageName('fr'), 'French');
});

test('8. a short "ok" still inherits the conversation language', () => {
  assert.equal(needsModelClassification('ok'), false);
  assert.equal(resolveLanguage({ latest: 'ok', recent: 'Gaari ma haysa' }), 'so');
});

test('9. the customer can switch language and the latest clear message wins', () => {
  assert.equal(resolveLanguage({ latest: 'Do you have Toyota?', recent: 'Gaari ma haysa' }), 'en');
  assert.equal(resolveLanguage({ latest: '\u0647\u0644 \u0644\u062f\u064a\u0643\u0645 \u0633\u064a\u0627\u0631\u0627\u062a\u061f', recent: 'Do you have Toyota?' }), 'ar');
});

test('10. the welcome is generated for any language (hardcoded first, then model + cache)', () => {
  const ld = read('src/lib/language-detect.ts');
  assert.ok(ld.includes('welcomeLinesFor'), 'dynamic welcome lines');
  assert.ok(ld.includes('ai_language_labels'), 'translations cached in MySQL (additive table)');
  assert.ok(ld.includes('isHardcodedLang'), 'fast path for en/so/ar/zh');
  const engine = read('src/lib/ai-rules/engine-core.ts');
  assert.ok(engine.includes('welcomeBlockText'), 'engine asks for the block in the customer language');
});

test('11. the hold line is generated for any language', () => {
  const ld = read('src/lib/language-detect.ts');
  assert.ok(ld.includes('holdTextFor'));
  assert.ok(ld.includes("'Let me confirm that for you.'"), 'model prompt translates the short line');
  const engine = read('src/lib/ai-rules/engine-core.ts');
  assert.ok(engine.includes('deps.holdText'), 'engine uses the dynamic hold when available');
});

test('12. an inventory answer uses the detected language', () => {
  const compose = read('src/lib/sales-compose.ts');
  assert.ok(compose.includes('detectCustomerLanguage'), 'language resolved with the classifier fallback');
  assert.ok(compose.includes('isHardcodedLang(lang)'), 'hardcoded languages answered directly');
  assert.ok(/Answer in \$\{languageName\(lang\)\}/.test(compose), 'other languages phrased by the model with the same facts');
  const ld = read('src/lib/language-detect.ts');
  assert.ok(ld.includes('classifyLanguage'), 'DeepSeek classifier');
  assert.ok(ld.includes('detected_language'), 'detected language stored on the conversation');
});

test('13. an admin-set preference is shown separately from the detected language', () => {
  const desk = read('src/app/admin/_components/ConversationDesk.tsx');
  assert.ok(desk.includes('Language: ${languageName'), 'preferred language line');
  assert.ok(desk.includes('Detected language: ${languageName'), 'detected language line');
});
