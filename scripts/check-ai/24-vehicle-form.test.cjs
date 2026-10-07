// PART 24 — Add Vehicle is ONE page again, shared with Edit Vehicle.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.join(__dirname, '..', '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const exists = (p) => fs.existsSync(path.join(root, p));
const FORM = 'src/app/admin/vehicles/_components/VehicleForm.tsx';
const PAGE = 'src/app/admin/vehicles/new/page.tsx';
const MANAGER = 'src/app/admin/vehicles/_components/VehicleManager.tsx';

test('1/2. Add Vehicle is one page - no wizard and no step navigation', () => {
  assert.ok(exists(FORM), 'shared VehicleForm exists');
  assert.ok(read(PAGE).includes('VehicleForm mode="create"'), 'the page renders the single form');
  assert.ok(!exists('src/app/admin/vehicles/new/AddVehicleClient.tsx'), 'the 5-step wizard client is gone');
  const form = read(FORM);
  assert.ok(!/steps?\[|setStep\(|Next<\/button>|>&lt; Back/.test(form), 'no step state or Next/Back buttons');
  assert.ok(form.includes('Save Vehicle'), 'one primary save');
});

test('3/4/5. every section lives on the same page', () => {
  const form = read(FORM);
  for (const label of ['Basic information', 'Vehicle details', 'Pricing', 'Exact vehicle photos', 'Sales &']) assert.ok(form.includes(label), `section ${label}`);
  for (const field of ['Brand *', 'Model *', 'Year', 'Trim', 'Stock number', 'Category', 'Manufacturing date']) assert.ok(form.includes(field), `basic field ${field}`);
  for (const field of ['Mileage km', 'Engine', 'Fuel', 'Transmission', 'Steering', 'Color', 'Body type', 'Drivetrain']) assert.ok(form.includes(field), `detail field ${field}`);
  assert.ok(form.includes('Selling price USD') && form.includes('Location'), 'pricing fields');
  assert.ok(form.includes('Description'), 'description field');
});

test('6/7/8. photos, status and the AI Catalog switch are on the same form', () => {
  const form = read(FORM);
  const fileIdx = form.indexOf('type="file"');
  const saveIdx = form.indexOf('Save Vehicle');
  assert.ok(fileIdx > 0 && saveIdx > 0 && fileIdx < saveIdx, 'photo upload is inside the same form');
  for (const s of ['Available', 'Reserved', 'Sold', 'Pending verification', 'Hidden']) assert.ok(form.includes(s), `status ${s}`);
  assert.ok(form.includes('AI Catalog'), 'AI control present');
  assert.ok(form.includes('separate from the public website status'), 'public vs AI explained');
});

test('9/10. duplicate stock is blocked and a blank stock is auto-generated', () => {
  const form = read(FORM);
  assert.ok(form.includes('check-stock?stock_no='), 'pre-check endpoint used');
  assert.ok(form.includes("j.code === 'DUPLICATE_STOCK'"), 'server duplicate handled with the code');
  assert.ok(form.includes('already exists.'), 'friendly duplicate message');
  assert.ok(form.includes('Use another stock number') && form.includes('View existing vehicle'), 'safe next steps');
  assert.ok(form.includes('SC${String(Date.now()).slice(-6)}'), 'blank stock auto-generated (existing logic)');
});

test('11/12. one submit creates one vehicle; double-click cannot duplicate', () => {
  const form = read(FORM);
  assert.ok(form.includes("method: mode === 'create' ? 'POST' : 'PATCH'"), 'single create call');
  assert.ok((form.match(/method: mode === 'create' \? 'POST'/g) || []).length === 1, 'only one POST path');
  assert.ok(form.includes('busyRef.current'), 'submit guard');
  assert.ok(form.includes('if (busyRef.current) return'), 'second click ignored while saving');
});

test('13/14. success offers Add another and clears every previous value', () => {
  const form = read(FORM);
  assert.ok(form.includes('Vehicle saved successfully') && form.includes('Stock:'), 'success panel');
  assert.ok(form.includes('+ Add another vehicle'), 'Add another button');
  assert.ok(form.includes('View vehicle') && form.includes('Edit vehicle') && form.includes('Back to inventory'), 'follow-up links');
  const reset = form.slice(form.indexOf('function reset()'), form.indexOf('async function checkStock'));
  for (const cleared of ['setF({ ...EMPTY })', 'setPhotos([])', 'setCover(0)', 'setErrors({})', 'setDup(null)', 'setSaved(null)']) assert.ok(reset.includes(cleared), `reset clears ${cleared}`);
});

test('15. the form is responsive (3/2/1 columns), no per-step pages', () => {
  const css = read('src/app/inbox.css') + read('src/app/globals.css');
  assert.ok(css.includes('.formGrid'), 'shared responsive grid');
  assert.ok(/max-width:850px[^}]*formGrid|formGrid[^}]*grid-template-columns:1fr/.test(css.replace(/\s+/g, '')), 'grid collapses on small screens');
  assert.ok(read(FORM).includes('maxWidth: 1100'), 'sensible max width');
  assert.ok(read(FORM).includes("position: 'sticky'"), 'sticky save bar on long pages');
});

test('16. motorcycles can be created through the same form', () => {
  assert.ok(read(FORM).includes("'motorcycle'"), 'category list includes motorcycle');
});

test('17/18. errors appear next to the field and never as raw SQL', () => {
  const form = read(FORM);
  for (const e of ['errors.brand', 'errors.model', 'errors.model_year', 'errors.mileage_km', 'errors.price_usd', 'errors.photos', 'errors.stock_no']) assert.ok(form.includes(e), `field error ${e}`);
  assert.ok(!form.includes('sqlMessage'), 'no raw database text');
  assert.ok(form.includes("j.message || j.error"), 'friendly server message');
  assert.ok(!read('src/app/api/admin/vehicles/route.ts').includes('sqlMessage'), 'API stays clean');
});

test('19. photos are attached to the created vehicle id', () => {
  const form = read(FORM);
  assert.ok(form.includes("fd.set('vehicle_id', String(id))"), 'photos uploaded against the new vehicle id');
  assert.ok(form.includes("action: 'cover'"), 'cover photo respected');
  assert.ok(form.includes('outline: i === cover'), 'cover is visually obvious');
});

test('20. public visibility and AI-enabled stay separate controls', () => {
  const form = read(FORM);
  assert.ok(form.includes('Status (public website)'), 'status is labelled as public visibility');
  assert.ok(/ai_enabled: !!f\.ai_enabled/.test(form), 'AI flag sent separately');
  const api = read('src/app/api/admin/vehicles/route.ts');
  assert.ok(api.includes('setAiEnabled'), 'AI flag stored on its own');
});

test('21. Add and Edit share the same component', () => {
  assert.ok(read(FORM).includes("mode: 'create' | 'edit'"), 'one component, two modes');
  assert.ok(read(FORM).includes("mode === 'create' ? 'Save Vehicle' : 'Save changes'"), 'mode-specific save label');
  const mgr = read(MANAGER);
  assert.ok(mgr.includes('VehicleForm mode="edit"'), 'edit uses the shared form');
  assert.ok(!mgr.includes('className="vehicleForm card"'), 'the old separate edit form is gone');
});
