const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = path.join(__dirname, '..', '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const bridge = 'tools/whatsapp-group-bridge';

test('group reader worker is valid JavaScript', () => {
  const result = spawnSync(process.execPath, ['--check', path.join(root, bridge, 'server.js')], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
});

test('WhatsApp session and retry state live outside the repository', () => {
  const server = read(`${bridge}/server.js`);
  assert.match(server, /STATE_DIR/);
  assert.match(server, /dataPath:\s*sessionDir/);
  assert.match(server, /class DurableOutbox/);
  assert.match(server, /pendingFile/);
  assert.match(server, /restorePending/);
  assert.match(server, /persistPending/);
  assert.match(read(`${bridge}/.env.example`), /STATE_DIR=\/var\/lib\/skycars-group-reader/);
});

test('QR page is private, authenticated and local-only', () => {
  const server = read(`${bridge}/server.js`);
  assert.match(server, /QR_BIND_HOST.*127\.0\.0\.1/s);
  assert.match(server, /Refusing to start the QR page on a non-local address/);
  assert.match(server, /QR_ADMIN_TOKEN/);
  assert.match(server, /timingSafeEqual/);
  assert.match(server, /cache-control.*no-store/i);
});

test('authorized groups are pinned by exact WhatsApp ID', () => {
  const web = read('src/lib/group-reader.ts');
  const server = read(`${bridge}/server.js`);
  assert.match(web, /discoverAndLockGroups/);
  assert.match(web, /pinned\?!!gid&&pinned===gid:true/);
  assert.match(web, /Sky cars motorcycles/);
  assert.match(server, /group\.id\s*\?\s*group\.id\s*===\s*id\s*:\s*group\.name\s*===\s*name/);
  assert.ok(fs.existsSync(path.join(root, 'src/app/api/bridge/whatsapp-group/discover/route.ts')));
});

test('approved imports become AI-searchable and can publish once to Facebook', () => {
  const src = read('src/lib/group-import.ts');
  assert.match(src, /UPDATE vehicles SET ai_enabled=/);
  assert.match(src, /status='available',published_at=NOW\(\)/);
  assert.match(src, /publishVehicleToFacebook\(vehicleId,\{manual:false\}\)/);
  assert.match(src, /facebookConfigured\(\)/);
  const social = read('src/lib/social.ts');
  assert.match(social, /claimPublish/);
  assert.match(social, /social_publish_lock/);
});

test('Ubuntu service uses Node 22, systemd restarts and an unprivileged account', () => {
  const unit = read(`${bridge}/vps/skycars-group-reader.service`);
  assert.match(unit, /User=skycars-reader/);
  assert.match(unit, /Restart=on-failure/);
  assert.match(unit, /ReadWritePaths=\/var\/lib\/skycars-group-reader/);
  assert.match(read(`${bridge}/Dockerfile`), /FROM node:22/);
  assert.match(read(`${bridge}/package.json`), /"node":">=22\.12\.0"/);
  assert.ok(fs.existsSync(path.join(root, bridge, 'vps/install-ubuntu.sh')));
});

test('live integration diagnostics are secret-protected and never return credentials', () => {
  const route = read('src/app/api/bridge/whatsapp-group/diagnostics/route.ts');
  assert.match(route, /bridgeAuthorized\(req\)/);
  assert.match(route, /facebookStatus\(\)/);
  assert.match(route, /checkWhatsAppNumber\(\)/);
  assert.match(route, /checkDeepSeek\(\)/);
  assert.match(route, /messengerConnectedByThisCheck: false/);
  assert.doesNotMatch(route, /access_token|META_PAGE_ACCESS_TOKEN\s*\}/i);
});
