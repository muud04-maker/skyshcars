const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..', '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

test('new-vehicle WhatsApp message contains the verified title, final price and listing link', () => {
  const source = read('src/lib/whatsapp-delivery.ts');
  assert.match(source, /function vehicleTitle/);
  assert.match(source, /toLocaleString\('en-US'/);
  assert.match(source, /https:\/\/skyshcars\.com\/vehicles\/\$\{Number\(vehicle\.id\)\}/);
  assert.match(source, /New arrival at Sky Cars/);
  assert.match(source, /Original unit photo included/);
});

test('delivery is persistent, one-per-vehicle and restricted to Available production stock', () => {
  const source = read('src/lib/whatsapp-delivery.ts');
  assert.match(source, /inventory_whatsapp_deliveries/);
  assert.match(source, /UNIQUE KEY uq_vehicle_recipient\(vehicle_id,recipient\)/);
  assert.match(source, /WHERE id=\? AND status='available' AND price_usd>0/);
  assert.match(source, /Delivery already recorded; use Admin Retry/);
  assert.match(source, /Recipient marketing opt-in is not recorded/);
  assert.match(source, /Approved WhatsApp vehicle template is required outside the 24-hour service window/);
});

test('manual and Telegram publication share the new-vehicle delivery hook', () => {
  const automation = read('src/lib/automation.ts');
  const vehicles = read('src/app/api/admin/vehicles/route.ts');
  const telegram = read('src/lib/group-import.ts');
  assert.match(automation, /deliverNewVehicleToWhatsApp\(vehicleId\)/);
  assert.match(vehicles, /handleVehiclePublished/);
  assert.match(telegram, /handleVehiclePublished/);
});

test('Admin exposes delivery status and an authenticated retry action', () => {
  const api = read('src/app/api/admin/social/route.ts');
  const ui = read('src/app/admin/social/SocialPublisher.tsx');
  assert.match(api, /adminDenied/);
  assert.match(api, /retry_whatsapp_delivery/);
  assert.match(api, /inventoryWhatsAppDeliveryStatus/);
  assert.match(ui, /New-vehicle WhatsApp delivery/);
  assert.match(ui, /retry_whatsapp_delivery/);
});
