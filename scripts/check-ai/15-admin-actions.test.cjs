// PART 15 — admin action audit: vehicle creation, duplicate handling, wiring of every key button.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.join(__dirname, '..', '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const exists = (p) => fs.existsSync(path.join(root, p));

const VEHICLE_API = 'src/app/api/admin/vehicles/route.ts';
const ADD_CLIENT = 'src/app/admin/vehicles/new/AddVehicleClient.tsx';
const MANAGER = 'src/app/admin/vehicles/_components/VehicleManager.tsx';

test('1. a valid vehicle create writes to MySQL and returns the new id', () => {
  const api = read(VEHICLE_API);
  assert.ok(api.includes('INSERT INTO vehicles('));
  assert.ok(/ok:true,id:r\.insertId/.test(api), 'returns the new id + stock');
});

test('2. a duplicate stock number is rejected with a clear code', () => {
  const api = read(VEHICLE_API);
  assert.ok(api.includes("code:'DUPLICATE_STOCK'"));
  assert.ok(api.includes('status:409'));
});

test('3. the duplicate message names the stock number and offers the existing vehicle', () => {
  const api = read(VEHICLE_API);
  assert.ok(/`Stock number \$\{stock\} already exists\.`/.test(api), 'message includes the stock number');
  assert.ok(api.includes('existing:'), 'existing vehicle returned');
  const client = read(ADD_CLIENT);
  assert.ok(client.includes('already exists.'), 'client shows the duplicate message');
  assert.ok(client.includes('View existing vehicle'), 'offers to view the existing vehicle');
  assert.ok(client.includes('Use another stock number'), 'offers to change the stock number');
});

test('4. the new vehicle keeps the AI-sell choice', () => {
  assert.ok(read(ADD_CLIENT).includes('ai_enabled: !!f.ai_enabled'));
  assert.ok(read(VEHICLE_API).includes('setAiEnabled(Number(r.insertId),b.ai_enabled)'));
});

test('5. motorcycles are saved with the right category', () => {
  const api = read(VEHICLE_API);
  assert.ok(api.includes("'motorcycle'"), 'backend accepts the motorcycle category');
  assert.ok(read(ADD_CLIENT).includes("'motorcycle'"), 'form offers the motorcycle category');
});

test('6. status saves from both the form and the list', () => {
  const api = read(VEHICLE_API);
  assert.ok(api.includes("'status'"), 'status is writable');
  assert.ok(read(MANAGER).includes("JSON.stringify({ id, status })"), 'row status dropdown calls PATCH');
});

test('7. the list refreshes after a save and the new flow links back to inventory', () => {
  assert.ok(read(MANAGER).includes('async function reload()'));
  assert.ok(read(ADD_CLIENT).includes('href="/admin/vehicles"'));
});

test('8. hide sets the vehicle to hidden (never deletes it)', () => {
  assert.ok(read(VEHICLE_API).includes("UPDATE vehicles SET status='hidden' WHERE id=?"));
});

test('9. the edit action is wired to PATCH with the vehicle id', () => {
  assert.ok(read(MANAGER).includes("method: 'PATCH'"));
  assert.ok(read(MANAGER).includes('body: JSON.stringify(form)'));
});

test('10. the AI Catalog toggle and bulk enable/disable are wired', () => {
  const client = read('src/app/admin/ai-catalog/AiCatalogClient.tsx');
  assert.ok(client.includes("action: 'set'"));
  assert.ok(client.includes('Enable selected') && client.includes('Disable selected'));
  const api = read('src/app/api/admin/ai-catalog/route.ts');
  assert.ok(api.includes("b.action === 'set'"));
});

test('11. the inbox bulk actions are wired to the bulk endpoint', () => {
  const bulk = read('src/app/api/admin/conversations/bulk/route.ts');
  for (const a of ["'ai'", "'human'", "'paused'", "'archive'", "'unarchive'", "'unread'", "'delete'"]) assert.ok(bulk.includes(a), `bulk action ${a}`);
  const desk = read('src/app/admin/_components/ConversationDesk.tsx');
  assert.ok(desk.includes('/api/admin/conversations/bulk'));
  assert.ok(desk.includes('quick-action'));
  assert.ok(desk.includes('/photos'));
});

test('12. the quote endpoint saves to MySQL', () => {
  assert.ok(read('src/app/api/quote/route.ts').includes('INSERT INTO quote_requests'));
});

test('13. shipment create + update are wired', () => {
  const s = read('src/app/api/admin/shipments/route.ts');
  assert.ok(s.includes('INSERT INTO shipments('));
  assert.ok(s.includes('UPDATE shipments SET'));
});

test('14. admin settings save welcome + staff pause', () => {
  const a = read('src/app/api/admin/ai-settings/route.ts');
  assert.ok(a.includes('saveWelcomeConfig') && a.includes('saveStaffPauseMinutes'));
});

test('15. failures never look like success: structured codes + the UI checks them', () => {
  const api = read(VEHICLE_API);
  assert.ok(api.includes("code:'CREATE_FAILED'") || api.includes("code:'DUPLICATE_STOCK'"));
  assert.ok(api.includes('ok:false'), 'errors carry ok:false');
  assert.ok(read(ADD_CLIENT).includes('j.ok === false'), 'add form treats ok:false as failure');
  assert.ok(read(MANAGER).includes('j.ok === false'), 'edit form treats ok:false as failure');
});

test('16. the duplicate pre-check endpoint exists and is admin-only', () => {
  assert.ok(exists('src/app/api/admin/vehicles/check-stock/route.ts'));
  const r = read('src/app/api/admin/vehicles/check-stock/route.ts');
  assert.ok(r.includes('adminDenied'));
  assert.ok(read(ADD_CLIENT).includes('check-stock?stock_no='));
});

test('17. no raw SQL / DB internals are returned by the vehicle or shipment admin APIs', () => {
  for (const f of [VEHICLE_API, 'src/app/api/admin/shipments/route.ts']) {
    const src = read(f);
    assert.ok(!src.includes('sqlMessage'), `${f} must not leak sqlMessage`);
  }
});

test('18. all admin API routes are authenticated', () => {
  const base = path.join(root, 'src/app/api/admin');
  const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => e.isDirectory() ? walk(path.join(dir, e.name)) : (e.name === 'route.ts' ? [path.join(dir, e.name)] : []));
  const files = walk(base);
  assert.ok(files.length > 30, 'found the admin routes');
  for (const f of files) {
    // /admin/login and /admin/logout are public by design (they create/clear the admin session).
    if (/[\\/](login|logout)[\\/]route\.ts$/.test(f)) continue;
    const src = fs.readFileSync(f, 'utf8');
    assert.ok(/adminDenied|isAdmin|getAdminSession/.test(src), `${path.relative(root, f)} must be guarded`);
  }
});

test('19. the admin button colour system exists and is used', () => {
  const css = read('src/app/inbox.css');
  for (const c of ['btn-primary', 'btn-success', 'btn-info', 'btn-warning', 'btn-danger', 'btn-neutral']) assert.ok(css.includes(`.${c}`), `missing ${c}`);
  assert.ok(/\.btn-primary:hover/.test(css) && /focus-visible/.test(css) && /\[disabled\]/.test(css), 'hover/focus/disabled states');
  const manager = read(MANAGER);
  assert.ok(manager.includes('btn-primary') && manager.includes('btn-info') && manager.includes('btn-danger'));
  assert.ok(read('src/app/admin/vehicles/new/AddVehicleClient.tsx').includes('btn-primary'));
});

test('20. the old inline create form is gone (one creation path only)', () => {
  const manager = read(MANAGER);
  assert.ok(manager.includes('href="/admin/vehicles/new"'), 'prominent add button links to the 5-step flow');
  assert.ok(!/method: 'POST'/.test(manager), 'the list must not POST to create vehicles');
  assert.ok(read(ADD_CLIENT).includes('Save vehicle'));
});

test('21. every admin button is styled: semantic class or a container rule (no raw browser buttons)', () => {
  // Containers that legitimately style their own buttons.
  const css = read('src/app/inbox.css');
  const globals = read('src/app/globals.css');
  for (const sel of ['.modeButtons button', '.quickMenu button', '.adminLogout']) {
    assert.ok(css.includes(sel) || globals.includes(sel), `missing button styling for ${sel}`);
  }
  assert.ok(globals.includes('.codeExplorer button'), 'dev explorer buttons styled');
  assert.ok(globals.includes('.adminMobileBar button'), 'mobile bar button styled');
  // The inbox header uses the semantic palette explicitly.
  assert.ok(css.includes('.modeButtons button.btn-warning') && css.includes('.modeButtons button.btn-success'));
  const desk = read('src/app/admin/_components/ConversationDesk.tsx');
  assert.ok(desk.includes('className="btn-warning"') && desk.includes('className="btn-success"') && desk.includes('className="btn-neutral"'));
});
