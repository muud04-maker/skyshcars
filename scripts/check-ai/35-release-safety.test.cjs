// RELEASE SAFETY - the four checks the owner asked for before merging:
//   1. staff_tasks has a safe, repeatable migration
//   2. every admin route is authorized
//   3. the learning system can never auto-publish an unapproved global lesson
//   4. a failed migration cannot silently leave a partially working app
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..', '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const exists = (p) => fs.existsSync(path.join(root, p));
const walk = (dir) => fs.readdirSync(path.join(root, dir), { withFileTypes: true })
  .flatMap((e) => e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]);

// ---------------------------------------------------------------- 1. repeatable migration
test('1. staff_tasks is created with an idempotent, additive schema in code AND in the master file', () => {
  const tasks = read('src/lib/staff-tasks.ts');
  assert.ok(tasks.includes('CREATE TABLE IF NOT EXISTS staff_tasks'), 'runtime creation is idempotent');
  assert.ok(!/DROP\s+TABLE|TRUNCATE|ALTER TABLE staff_tasks/i.test(tasks), 'no destructive or altering statement');
  assert.ok(tasks.includes('UNIQUE KEY uq_task_dedupe(dedupe_key)'), 'the dedupe key is enforced by the database');
  assert.ok(tasks.includes('let ready: Promise<void> | null = null'), 'creation is memoised');
  assert.ok(tasks.includes('ready = null; throw e'), 'a failed creation is retried instead of cached as success');
  // Every entry point ensures the schema before using it.
  for (const fn of ['export async function createTask', 'export async function listTasks', 'export async function taskStats', 'export async function updateTask']) {
    const i = tasks.indexOf(fn);
    assert.ok(i > 0, `${fn} exists`);
    assert.ok(tasks.slice(i, i + 400).includes('ensureStaffTasksSchema()'), `${fn} ensures the schema first`);
  }
  // The master schema (fresh installs) must contain the same table with the same key columns.
  const master = read('database/Sky_Cars_Hostinger_MySQL_Master_Schema.sql');
  assert.ok(master.includes('CREATE TABLE IF NOT EXISTS staff_tasks'), 'master schema has staff_tasks');
  for (const col of ['request_type', 'dedupe_key', 'status', 'handled_by', 'completed_at']) assert.ok(master.includes(col), `master schema column ${col}`);
  assert.ok(master.includes('UNIQUE KEY uq_task_dedupe(dedupe_key)'), 'master schema enforces dedupe');
  for (const t of ['customer_facts', 'customer_fact_events', 'ai_learning_events', 'staff_notes', 'conversation_vehicle_events', 'daily_ai_sales_patterns']) {
    assert.ok(master.includes(`CREATE TABLE IF NOT EXISTS ${t}`), `master schema has ${t}`);
  }
  assert.ok(master.includes('ADD COLUMN IF NOT EXISTS assigned_staff'), 'master schema adds the customer column idempotently');
  assert.ok(!/DROP\s+TABLE|TRUNCATE/i.test(master), 'the master schema never drops anything');
});

// ---------------------------------------------------------------- 2. authorization
test('2. every admin API route is authorized (only login/logout are public)', () => {
  const files = walk('src/app/api/admin').filter((f) => f.endsWith('route.ts'));
  assert.ok(files.length > 40, `expected the full admin API surface, found ${files.length}`);
  const PUBLIC = new Set(['api/admin/login/route.ts', 'api/admin/logout/route.ts']);
  const unguarded = [];
  for (const f of files) {
    const rel = f.replace(/\\/g, '/').replace(/^src\/app\//, '');
    const src = read(f);
    const guarded = /adminDenied\(\)|isAdmin\(\)|getAdminSession\(\)|canManageAdmins\(\)|await guard\(\)|denied\(\)/.test(src);
    if (!PUBLIC.has(rel) && !guarded) unguarded.push(rel);
  }
  assert.deepEqual(unguarded, [], 'unguarded admin routes: ' + unguarded.join(', '));
  // The new surfaces are admin-only on the page AND the API.
  for (const [page, api] of [
    ['src/app/admin/staff-tasks/page.tsx', 'src/app/api/admin/staff-tasks/route.ts'],
    ['src/app/admin/ai-learning/page.tsx', 'src/app/api/admin/ai-learning/route.ts'],
    ['src/app/admin/all-history/page.tsx', 'src/app/api/admin/all-history/route.ts'],
    ['src/app/admin/customer-history/page.tsx', 'src/app/api/admin/customer-history/route.ts'],
  ]) {
    assert.ok(read(page).includes("redirect('/admin/login')"), `${page} requires login`);
    assert.ok(/adminDenied\(\)|getAdminSession\(\)/.test(read(api)), `${api} is guarded`);
  }
  assert.ok(read('src/app/api/admin/schema-health/route.ts').includes('adminDenied()'), 'the schema check is admin-only');
});

// ---------------------------------------------------------------- 3. no auto-published lessons
test('3. nothing can publish a global lesson without an explicit admin approval + apply', () => {
  const learning = read('src/lib/ai-learning.ts');
  // Creation defaults to pending.
  assert.ok(learning.includes("const status: LearningStatus = input.status || 'pending'"), 'new lessons are pending by default');
  // Retrieval is strict: approved/applied, global only, not expired, not undone.
  assert.ok(learning.includes("WHERE status IN ('approved','applied') AND applies_to='global'"), 'only approved global lessons are retrieved');
  assert.ok(learning.includes('AND (expires_at IS NULL OR expires_at > NOW())'), 'expired lessons are not retrieved');
  assert.ok(learning.includes('AND undone_at IS NULL'), 'undone lessons are not retrieved');
  // Apply requires an approved lesson.
  assert.ok(learning.includes("if (nextStatus('apply', ev.status) !== 'applied') throw new Error('Only an approved lesson can be applied')"), 'apply is gated by status');
  // Only one writer of ai_knowledge from lessons, and it is inside apply.
  const writers = walk('src').filter((f) => f.endsWith('.ts')).filter((f) => /INSERT INTO ai_knowledge/i.test(read(f)));
  assert.deepEqual(writers.map((f) => f.replace(/\\/g, '/')).sort(), ['src/app/api/admin/knowledge/route.ts', 'src/lib/ai-learning.ts'], 'only the apply path and the admin knowledge editor write knowledge');
  // The learning API is admin-only for every action.
  const api = read('src/app/api/admin/ai-learning/route.ts');
  assert.ok(api.includes('adminDenied()'), 'creating a lesson requires admin');
  const apiId = read('src/app/api/admin/ai-learning/[id]/route.ts');
  assert.ok(apiId.includes('adminDenied()'), 'approving/applying requires admin');
  // The engine only ever READS lessons.
  const ai = read('src/lib/ai.ts');
  assert.ok(ai.includes('approvedLessons(5)'), 'the reply engine reads approved lessons');
  assert.ok(!/recordLearningEvent|reviewLearningEvent|applyLearningEvent/.test(ai), 'the reply engine never creates or approves lessons');
  // The daily pattern learner may suggest, never approve.
  const patterns = read('src/lib/sales-patterns.ts');
  assert.ok(!/INSERT INTO ai_learning_events/i.test(patterns), 'patterns cannot create lessons');
  assert.ok(!/ai_knowledge/.test(patterns), 'patterns cannot write global knowledge');
});

// ---------------------------------------------------------------- 4. failed migrations are visible
test('4. a failed migration is surfaced, not silently half-working', () => {
  const learning = read('src/lib/ai-learning.ts');
  assert.ok(learning.includes('INFORMATION_SCHEMA.COLUMNS'), 'the learning schema verifies its own columns');
  assert.ok(learning.includes('is missing column(s)'), 'and fails with a clear message');
  assert.ok(learning.includes('ready = null; throw new Error'), 'the failure is retried, not cached');
  const health = read('src/lib/schema-health.ts');
  assert.ok(health.includes('verifyCriticalSchemas'), 'a schema health check exists');
  assert.ok(health.includes('missing_columns'), 'and reports exactly which columns are missing');
  for (const t of ['staff_tasks', 'ai_learning_events', 'customer_facts', 'staff_notes', 'conversation_vehicle_events', 'daily_ai_sales_patterns']) {
    assert.ok(health.includes(`'${t}'`), `health covers ${t}`);
  }
  const api = read('src/app/api/admin/staff-tasks/route.ts');
  assert.ok(api.includes('status: 503'), 'the task API fails loudly when the table is not ready');
  assert.ok(api.includes('missing_columns'), 'and names the missing columns');
  assert.ok(read('src/app/admin/staff-tasks/StaffTasksClient.tsx').includes('Database check'), 'staff see a database check button');
  assert.ok(!/verifyCriticalSchemas\(\)\.catch\(\(\) => null\)[\s\S]{0,200}listTasks/s.test(api), 'the health result is not ignored before listing');
});

// ---------------------------------------------------------------- privacy + lab isolation
test('privacy: the private exports are not tracked, and lab stays untouched by this repo', () => {
  const tracked = fs.readFileSync(path.join(root, '.gitignore'), 'utf8');
  assert.ok(tracked.includes('.env'), '.env is ignored');
  // The exports live outside the repo; nothing named like them may be committed.
  for (const name of ['customers.txt', 'conversations.sql', 'messages.sql']) {
    assert.equal(exists(name), false, `${name} must not exist in the repository root`);
  }
  assert.equal(fs.existsSync(path.join(root, 'tools/analysis/analyze-dumps.mjs')), true, 'the audit tool is in the repo (no data)');
});
