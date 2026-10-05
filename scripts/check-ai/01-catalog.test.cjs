const test = require('node:test'); const assert = require('node:assert/strict');
const load = require('./lib.cjs');
const { aiCarSqlFor } = load('ai-catalog.js');

test('PART 1 / B: selected mode only allows cars switched on in the AI Catalog', () => {
  const sql = aiCarSqlFor('selected', 'v');
  assert.match(sql, /v\.status='available'/);
  assert.match(sql, /v\.ai_enabled=1/);
});
test('PART 1: all mode allows every Available car', () => {
  const sql = aiCarSqlFor('all', 'v');
  assert.match(sql, /v\.status='available'/);
  assert.doesNotMatch(sql, /ai_enabled/);
});
