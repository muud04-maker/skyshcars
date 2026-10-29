const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..', '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

test('historical repair uses the verified Volkswagen anchor and separate motorcycle album', () => {
  const source = read('src/lib/telegram-repair.ts');
  assert.match(source, /14346142692990236/);
  assert.match(source, /14346127676388732/);
  assert.match(source, /anchor\.file_unique_id/);
  assert.match(source, /Volkswagen descriptions, duplicate photo anchor/);
  assert.match(source, /Triumph.*Bobber/s);
  assert.match(source, /price_value: 10125/);
  assert.match(source, /category: 'motorcycle'/);
});

test('source repair is in-place, additive and never publishes or deletes evidence', () => {
  const source = read('src/lib/telegram-repair.ts');
  assert.doesNotMatch(source, /INSERT INTO vehicles/);
  assert.doesNotMatch(source, /\bDELETE\s+FROM\b/i);
  assert.match(source, /review_status='rejected'/);
  assert.match(source, /source_association_superseded/);
  assert.match(source, /publications_made: 0/);
  assert.match(source, /price_usd=NULL/);
  assert.match(source, /attachImportOriginalPhotos/);
  assert.match(source, /private_content_included: false/);
});

test('source repair requires automation off and historical repairs stay in review', () => {
  const repair = read('src/lib/telegram-repair.ts');
  const automation = read('src/lib/telegram-automation.ts');
  assert.match(repair, /Disable Telegram automatic publication before repairing/);
  assert.match(repair, /repair_review_required: true/);
  assert.match(automation, /Historical source-association repair requires manual approval/);
});

test('the repair is exposed through the authenticated admin API', () => {
  const route = read('src/app/api/admin/telegram/route.ts');
  const ui = read('src/app/admin/telegram/TelegramAutomationClient.tsx');
  assert.match(route, /adminDenied/);
  assert.match(route, /repair_source_associations/);
  assert.match(route, /repairTelegramSourceAssociations/);
  assert.match(ui, /Repair mixed Telegram sources/);
  assert.match(ui, /Nothing was published/);
});
