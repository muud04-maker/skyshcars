const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const load = require('./lib.cjs');
const telegram = load('telegram-rules');

const root = path.join(__dirname, '..', '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

function withTelegramEnv(values, fn) {
  const old = {
    TELEGRAM_BOT_TOKEN: process.env.TELEGRAM_BOT_TOKEN,
    TELEGRAM_WEBHOOK_SECRET: process.env.TELEGRAM_WEBHOOK_SECRET,
    TELEGRAM_SOURCE_CHAT_ID: process.env.TELEGRAM_SOURCE_CHAT_ID,
  };
  for (const [key, value] of Object.entries(values)) {
    if (value == null) delete process.env[key];
    else process.env[key] = value;
  }
  try { return fn(); } finally {
    for (const [key, value] of Object.entries(old)) {
      if (value == null) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

test('Telegram uses the canonical secure environment names', () => {
  assert.deepEqual(telegram.TELEGRAM_ENV_NAMES, {
    botToken: 'TELEGRAM_BOT_TOKEN',
    webhookSecret: 'TELEGRAM_WEBHOOK_SECRET',
    sourceChatId: 'TELEGRAM_SOURCE_CHAT_ID',
  });
  const summary = withTelegramEnv({ TELEGRAM_BOT_TOKEN: 'x', TELEGRAM_WEBHOOK_SECRET: 's', TELEGRAM_SOURCE_CHAT_ID: '-1001' }, () => telegram.telegramConfigSummary());
  assert.equal(summary.configured, true);
  assert.deepEqual(summary.required_names, telegram.TELEGRAM_ENV_NAMES);
});

test('webhook secret comparison is exact and source chat IDs cannot be substituted', () => {
  withTelegramEnv({ TELEGRAM_WEBHOOK_SECRET: 'expected_secret', TELEGRAM_SOURCE_CHAT_ID: '-1001234567890' }, () => {
    assert.equal(telegram.telegramSecretMatches('expected_secret'), true);
    assert.equal(telegram.telegramSecretMatches('expected_secret '), false);
    assert.equal(telegram.telegramSecretMatches('wrong'), false);
    assert.equal(telegram.telegramChatAllowed({ id: -1001234567890 }), true);
    assert.equal(telegram.telegramChatAllowed({ id: -1009999999999 }), false);
    assert.equal(telegram.telegramChatApiId('SkyshcarsGroup'), '@SkyshcarsGroup');
    assert.equal(telegram.telegramChatApiId('@SkyshcarsGroup'), '@SkyshcarsGroup');
    assert.equal(telegram.telegramChatApiId('-1001234567890'), '-1001234567890');
  });
});

test('the largest Telegram album photo is selected', () => {
  const photo = telegram.largestTelegramPhoto({
    photo: [
      { file_id: 'small', file_unique_id: 'u1', width: 90, height: 90 },
      { file_id: 'large', file_unique_id: 'u2', width: 1280, height: 960 },
      { file_id: 'middle', file_unique_id: 'u3', width: 640, height: 480 },
    ],
  });
  assert.equal(photo.file_id, 'large');
  assert.equal(telegram.telegramMessageKind({ photo: [{ file_id: 'x', file_unique_id: 'u', width: 1, height: 1 }] }), 'photo');
});

test('complete new Telegram listings are eligible for automatic Sell Now publication', () => {
  const decision = telegram.decideTelegramAutoPublish({
    match_status: 'new', review_status: 'pending', extraction_confidence: 0.91,
    brand: 'Toyota', model: 'Hilux', model_year: 2022, category: 'car',
    price_value: 18500, price_currency: 'USD', mileage_km: 42000,
    text: 'Toyota Hilux 2022 USD 18500, mileage 42000 km, ready for shipment', photo_count: 4,
  });
  assert.equal(decision.eligible, true, decision.reasons.join(', '));
  assert.equal(decision.price_usd, 18500);
  assert.equal(decision.price_currency, 'USD');
});

test('incomplete, uncertain, non-USD or sold listings never auto-publish', () => {
  const base = {
    match_status: 'new', review_status: 'pending', extraction_confidence: 0.92,
    brand: 'Toyota', model: 'Hilux', model_year: 2022, category: 'car',
    price_value: 18500, price_currency: 'USD', photo_count: 3, text: 'Available now',
  };
  assert.equal(telegram.decideTelegramAutoPublish({ ...base, photo_count: 0 }).eligible, false);
  assert.equal(telegram.decideTelegramAutoPublish({ ...base, match_status: 'possible' }).eligible, false);
  assert.equal(telegram.decideTelegramAutoPublish({ ...base, category: 'other' }).eligible, false);
  assert.equal(telegram.decideTelegramAutoPublish({ ...base, extraction_confidence: 0.3 }).eligible, false);
  assert.equal(telegram.decideTelegramAutoPublish({ ...base, price_currency: 'CNY', price_value: 130000 }).eligible, false);
  assert.equal(telegram.decideTelegramAutoPublish({ ...base, text: 'This unit is already sold' }).eligible, false);
  assert.equal(telegram.decideTelegramAutoPublish({ ...base, text: 'Toyota Hilux 2022 is sold' }).eligible, false);
  assert.equal(telegram.decideTelegramAutoPublish({ ...base, price_value: 0 }).eligible, false);
});

test('webhook route enforces the Telegram secret and acknowledges through a durable after-job', () => {
  const route = read('src/app/api/integrations/telegram/webhook/route.ts');
  assert.match(route, /x-telegram-bot-api-secret-token/);
  assert.match(route, /telegramSecretMatches/);
  assert.match(route, /receiveTelegramUpdate/);
  assert.match(route, /after\(async/);
  assert.match(route, /processTelegramQueue/);
  assert.doesNotMatch(route, /cron/i);
});

test('webhook bootstrap accepts no secrets or target URL from the caller', () => {
  const route = read('src/app/api/integrations/telegram/bootstrap/route.ts');
  assert.match(route, /bootstrapTelegramWebhook/);
  assert.doesNotMatch(route, /POST\(req/);
  const automation = read('src/lib/telegram-automation.ts');
  assert.match(automation, /one attempt per minute/i);
  assert.match(automation, /setWebhook/);
  assert.doesNotMatch(route, /botToken|secret_token|TELEGRAM_BOT_TOKEN/);
});

test('private-group discovery uses Bot API updates and restores the webhook', () => {
  const route = read('src/app/api/integrations/telegram/discover/route.ts');
  const automation = read('src/lib/telegram-automation.ts');
  assert.match(route, /discoverTelegramSourceGroup/);
  assert.doesNotMatch(route, /POST\(req/);
  assert.match(automation, /deleteWebhook/);
  assert.match(automation, /getUpdates/);
  assert.match(automation, /setWebhook/);
  assert.match(automation, /telegram_source_pin/);
});

test('Telegram storage is idempotent and reuses V35 inventory and publication modules', () => {
  const automation = read('src/lib/telegram-automation.ts');
  const importer = read('src/lib/group-import.ts');
  const schema = read('database/Sky_Cars_Hostinger_MySQL_Master_Schema.sql');
  assert.match(automation, /INSERT IGNORE INTO telegram_updates/);
  assert.match(automation, /UNIQUE KEY uq_telegram_message/);
  assert.match(automation, /createGroupImport\(payload\)/);
  assert.match(automation, /reviewGroupImport/);
  assert.match(automation, /media_group_id/);
  assert.match(automation, /getFile/);
  assert.match(importer, /payload\.source==='telegram'/);
  assert.match(importer, /source IN \('whatsapp_group','telegram'\)/);
  assert.match(schema, /telegram_source_messages/);
  assert.match(schema, /source ENUM\('json','csv','whatsapp_group','manual','telegram'\)/);
});

test('WhatsApp group publishing stays explicitly disabled instead of using individual Cloud API sends', () => {
  const adapter = read('src/lib/whatsapp-group-publish.ts');
  assert.match(adapter, /120363429404519527@g\.us/);
  assert.match(adapter, /supported: false/);
  assert.match(adapter, /No authorized WhatsApp group-sending connection/);
  assert.doesNotMatch(adapter, /sendWhatsApp\(/);
  assert.doesNotMatch(adapter, /recipient_type:\s*['"]individual/);
});

test('Telegram admin API and page are protected and expose the required operational controls', () => {
  assert.match(read('src/app/admin/telegram/page.tsx'), /isAdmin/);
  assert.match(read('src/app/api/admin/telegram/route.ts'), /adminDenied/);
  const ui = read('src/app/admin/telegram/TelegramAutomationClient.tsx');
  assert.match(ui, /Register webhook/);
  assert.match(ui, /Retry failed jobs/);
  assert.match(ui, /Facebook publication history/);
  assert.match(ui, /WhatsApp group delivery/);
  assert.match(ui, /Run preflight/);
});
