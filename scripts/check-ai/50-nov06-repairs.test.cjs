const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..', '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

test('stale chat requests cannot overwrite the newly selected conversation', () => {
  const source = read('src/app/admin/_components/ConversationDesk.tsx');
  assert.match(source, /activeRef\.current !== id/);
  assert.match(source, /activeRef\.current === conversationId/);
  assert.match(source, /detailRequest\.current\+\+/);
  assert.match(source, /setMsgs\(\[\]\)/);
});

test('admin chat supports size modes and searchable vehicle selection', () => {
  const ui = read('src/app/admin/_components/ConversationDesk.tsx');
  const css = read('src/app/inbox.css');
  assert.match(ui, /viewControls/);
  assert.match(ui, /Search make, model, year, stock or price/);
  assert.match(css, /\.inbox--full/);
  assert.match(css, /\.inbox--compact/);
  assert.match(css, /resize: vertical/);
  assert.match(read('src/lib/inbox.ts'), /EXISTS\(SELECT 1 FROM messages sm/);
  assert.match(read('src/app/api/admin/conversations/inbox/route.ts'), /q\.get\('q'\)/);
});

test('Add Vehicle exposes one final customer price while preserving private source fields', () => {
  const form = read('src/app/admin/vehicles/_components/VehicleForm.tsx');
  assert.match(form, /Final Vehicle Price \(USD\)/);
  assert.doesNotMatch(form, />Supplier source price</);
  assert.doesNotMatch(form, />Selling price USD</);
});

test('staff-sent exact photos keep the discussed vehicle in AI context', () => {
  const route = read('src/app/api/admin/conversations/[id]/photos/route.ts');
  assert.match(route, /setCurrentCar\(id, vehicleId, 'staff'\)/);
});

test('advertisement campaigns are durable and resolve only active ad references', () => {
  const ads = read('src/lib/ad-campaigns.ts');
  const referral = read('src/lib/referrals.ts');
  const api = read('src/app/api/admin/campaigns/route.ts');
  const ui = read('src/app/admin/campaigns/CampaignsClient.tsx');
  assert.match(ads, /ai_ad_campaigns/);
  assert.match(ads, /status='active'/);
  assert.match(referral, /activeAdVehicleForSource/);
  assert.match(referral, /method: 'campaign'/);
  assert.match(api, /save_ad/);
  assert.match(ui, /Today&apos;s Advertisements/);
  assert.match(ui, /Price|price/);
});

test('missing media AI configuration is reported without fabricating image or voice content', () => {
  const route = read('src/app/api/whatsapp/webhook/route.ts');
  assert.match(route, /configuration_required/);
  assert.match(route, /Transcription provider is not configured/);
  assert.match(route, /Automatic image analysis is not configured/);
  assert.match(route, /needsHuman:true/);
});

test('credentials pasted into chat are redacted before storage and in admin reads', () => {
  const conversations = read('src/lib/conversations.ts');
  const inbox = read('src/app/api/admin/conversations/inbox/route.ts');
  const detail = read('src/app/api/admin/conversations/[id]/route.ts');
  assert.match(conversations, /redactSensitiveText/);
  assert.match(conversations, /\[credential removed\]/);
  assert.match(inbox, /redactSensitiveText\(m\.body\)/);
  assert.match(detail, /redactSensitiveText\(m\.body\)/);
});

test('DeepSeek always receives staff replies and stored preferences, even without a custom note', () => {
  const ai = read('src/lib/ai.ts');
  assert.match(ai, /const contextNote = \[/);
  assert.match(ai, /humanRepliesNote\(pack\.humanReplies\)/);
  assert.match(ai, /AI CONTEXT NOTE:/);
});

test('public marketplace homepage uses the supplied orange, white and black responsive design', () => {
  const css = read('src/components/sky-cars-homepage/SkyCarsHomepage.module.css');
  const home = read('src/app/page.tsx');
  const component = read('src/components/sky-cars-homepage/SkyCarsHomepage.tsx');
  assert.match(css, /--orange:\s*#f36a08/);
  assert.match(css, /--ink:\s*#111111/);
  assert.match(css, /background:\s*#fff/);
  assert.match(css, /@media \(max-width: 620px\)/);
  assert.match(component, /Buy Cars &amp; Motorcycles/);
  assert.match(component, /Featured Vehicles/);
  assert.match(component, /Shipping to Africa/);
  assert.match(component, /What Our Customers Say/);
  assert.doesNotMatch(component, /Shop by Category|Popular Brands|Recommended for You/);
  assert.match(home, /category: 'car', limit: 60, onlyAvailable: true/);
  assert.match(home, /category: 'motorcycle', limit: 60, onlyAvailable: true/);
  assert.match(home, /vehicle\.price_usd/);
  assert.match(home, /exact_cover_url/);
  assert.match(home, /href: `\/vehicles\/\$\{vehicle\.id\}`/);
  assert.match(home, /heroImageUrl/);
});
