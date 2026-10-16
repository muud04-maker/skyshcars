// PRODUCTION BUG: /admin/customer-history showed 152 customers while /admin/all-history showed 0
// events. Root cause: the UNION aliased a column as `role`, which is a RESERVED WORD in MySQL 8, so
// the whole query failed - and the failure was swallowed by .catch(() => []), which looked exactly
// like "no data". These tests pin both the cause and the cure.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const load = require('./lib.cjs');
const { buildHistorySources, HISTORY_TABLES, historyBlock } = load('all-history.js');

const root = path.join(__dirname, '..', '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const LIB = 'src/lib/all-history.ts';
const API = 'src/app/api/admin/all-history/route.ts';
const EXPORT = 'src/app/api/admin/all-history/export/route.ts';
const CLIENT = 'src/app/admin/all-history/AllHistoryClient.tsx';

function sqlLiterals(src) {
  return [...src.matchAll(/`([^`]*)`/g)].map((m) => m[1]).filter((s) => /\b(SELECT|INSERT|UPDATE|DELETE)\b/i.test(s));
}
/** Remove comments, string literals and backticked identifiers before looking for bare identifiers. */
function stripSqlNoise(sql) {
  return sql
    .replace(/--[^\n]*/g, ' ')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/'(?:[^']|'')*'/g, ' ')
    .replace(/`[^`]*`/g, ' ');
}
// MySQL 8 reserved words that are plausible column names - the trap this page fell into.
const RESERVED = ['role', 'rank', 'row', 'rows', 'groups', 'window', 'lead', 'lag', 'over', 'recursive', 'except', 'intersect', 'cube', 'function', 'member'];

test('ROOT CAUSE: no SQL anywhere uses a MySQL 8 reserved word as a bare identifier', () => {
  const files = [];
  const walk = (dir) => fs.readdirSync(path.join(root, dir), { withFileTypes: true }).forEach((e) => {
    const rel = path.join(dir, e.name);
    if (e.isDirectory()) { if (!['node_modules', '.next', '.check-build'].includes(e.name)) walk(rel); }
    else if (/\.(ts|tsx)$/.test(e.name)) files.push(rel);
  });
  ['src'].forEach(walk);
  const offenders = [];
  for (const file of files) {
    for (const sql of sqlLiterals(read(file))) {
      const clean = stripSqlNoise(sql);
      for (const w of RESERVED) {
        const pattern = new RegExp(`(?:(?:END|AS)\\s+${w}\\b)|(?:[,()]|\\s)${w}\\s*(?:,|=\\s*\\?|\\))`, 'i');
        if (pattern.test(clean)) offenders.push(`${file}: bare "${w}" in SQL`);
      }
    }
  }
  assert.deepEqual(offenders, [], 'reserved words must be renamed or backticked: ' + offenders.join(' | '));
});

test('ROOT CAUSE: the stream column is sender_role, never role', () => {
  const src = read(LIB);
  assert.ok(src.includes('sender_role'), 'the column exists under a safe name');
  assert.ok(!/END\s+role\b/.test(src), 'the old invalid alias is gone');
  assert.ok(!/SELECT[^`]*\brole\b[^`]*FROM/s.test(stripSqlNoise(src)), 'no bare role column in the wrapper select');
  const full = buildHistorySources(new Set(Object.values(HISTORY_TABLES)));
  const branches = full.split('UNION ALL').length;
  assert.equal((full.match(/sender_role/g) || []).length, branches, 'every branch projects sender_role');
  assert.ok(!/[^`'\w.]role\s*[,=]/.test(stripSqlNoise(full)), 'the built SQL has no bare role');
});

test('a failing query is never disguised as "no data"', () => {
  const src = read(LIB);
  assert.ok(src.includes('error = String('), 'the error is captured');
  assert.ok(src.includes("console.error('ALL_HISTORY_QUERY'"), 'and logged');
  const pageFn = src.slice(src.indexOf('export async function historyPage'), src.indexOf('export async function historyCount'));
  assert.ok(pageFn.includes('error,'), 'historyPage returns the error to the caller');
  assert.ok(!/rows<any>\([^)]*\)\.catch\(\(\) => \[\]\)/.test(pageFn), 'the main query is no longer swallowed by an empty-array catch');
  assert.ok(read(API).includes('status: 500'), 'the API answers 500 instead of an empty list');
  assert.ok(read(API).includes('Could not read the history from the database'), 'with a human-readable reason');
  assert.ok(read(CLIENT).includes("setMsg(j.error"), 'the page shows the error');
  const exp = read(EXPORT);
  assert.ok(exp.includes('THE DATABASE QUERY FAILED'), 'the download states a query failure');
  assert.ok(exp.includes('page.error'), 'and stops with an explicit line');
});

/**
 * A UNION with mismatched column lists is the other classic failure, and no database is needed to
 * catch it: count the projected columns per branch (paren-aware) and require them all to be equal.
 */
function projectedColumns(branchSql) {
  const body = branchSql.replace(/^\s*SELECT\s+/i, '').split(/\s+FROM\s+/i)[0];
  let depth = 0, count = 1;
  for (const ch of body) {
    if (ch === '(') depth++;
    else if (ch === ')') depth--;
    else if (ch === ',' && depth === 0) count++;
  }
  return count;
}

test('every UNION branch projects the same columns (no UNION column mismatch)', () => {
  const full = buildHistorySources(new Set(Object.values(HISTORY_TABLES)));
  const branches = full.split(/\bUNION ALL\b/).map((b) => b.trim()).filter(Boolean);
  assert.equal(branches.length, 7, 'all seven sources are present when every table exists');
  const counts = branches.map(projectedColumns);
  assert.deepEqual([...new Set(counts)], [19], `every branch must project the same 19 columns, got ${counts.join(',')}`);
  const wrapper = read(LIB).match(/SELECT ts,source_id,kind,sender_role[^`]*/);
  assert.ok(wrapper, 'the wrapper select exists');
  assert.equal(projectedColumns('SELECT ' + wrapper[0].split('FROM (')[0]), 19, 'the wrapper reads the same 19 columns');
  // Each branch reads exactly one base table: no accidental cross join.
  for (const t of ['messages m', 'ai_agent_events e', 'chat_referrals r', 'quote_requests q', 'staff_notes n', 'customer_fact_events f', 'ai_learning_events l']) {
    const branch = branches.find((b) => b.includes(`FROM ${t}`));
    assert.ok(branch, `branch for ${t}`);
    assert.equal((branch.match(/\bFROM\b/g) || []).length, 1, `only one FROM in the ${t} branch`);
  }
});

test('a missing optional table can only drop its own branch', () => {
  const minimal = buildHistorySources(new Set(['messages', 'conversations', 'customers']));
  assert.ok(minimal.includes('FROM messages m'), 'messages are always in the stream');
  assert.ok(!minimal.includes('staff_notes'), 'a table that does not exist is not referenced');
  assert.ok(!minimal.includes('conversation_state'), 'its joins are dropped too');
  assert.ok(minimal.includes('NULL vehicle_id'), 'the column list still lines up');
  const full = buildHistorySources(new Set(Object.values(HISTORY_TABLES)));
  for (const t of ['messages', 'ai_agent_events', 'chat_referrals', 'quote_requests', 'staff_notes', 'customer_fact_events', 'ai_learning_events']) {
    assert.ok(full.includes(t), `branch present when the table exists: ${t}`);
  }
  const src = read(LIB);
  assert.ok(src.includes('INFORMATION_SCHEMA.TABLES'), 'existing tables are probed in the database');
  assert.ok(src.includes('ensureHistoryTables'), 'and the optional schemas are created first');
  assert.ok(read(API).includes("diagnostics') === '1'"), 'diagnostics endpoint exists for reconciliation');
  assert.ok(src.includes('historyDiagnostics'), 'per-source counts are available');
  assert.ok(src.includes('customers_with_messages') && src.includes('explanation'), 'customers vs events is explained');
});

test('old customer messages appear in the stream and in the export, with no duplicates', () => {
  const src = read(LIB);
  // Same table and the same identity columns Customer History reads, so historical rows are the source.
  for (const col of ['m.created_at ts', 'm.body', 'c.id conversation_id', 'c.channel', 'cu.id customer_id', 'm.sender']) {
    assert.ok(src.includes(col), `stream reads ${col}`);
  }
  assert.ok(read('src/lib/customer-context.ts').includes('FROM messages m JOIN conversations c'), 'Customer History reads the same messages table');
  // Every branch namespaces its id, so (ts, source_id) is unique across the whole stream -> no duplicates.
  for (const prefix of ["'msg:'", "'evt:'", "'ref:'", "'quote:'", "'note:'", "'mem:'", "'learn:'"]) {
    assert.ok(src.includes(prefix), `unique id prefix ${prefix}`);
  }
  assert.ok(src.includes('ORDER BY ts ${order.toUpperCase()}, source_id ${order.toUpperCase()}'), 'stable ordering by (ts, source_id)');
  assert.ok(src.includes('(ts < ? OR (ts = ? AND source_id < ?))') && src.includes('(ts > ? OR (ts = ? AND source_id > ?))'), 'keyset pagination cannot repeat or skip a row');
  // The download walks the WHOLE match, not just the first page.
  const exp = read(EXPORT);
  assert.ok(exp.includes('for (;;)') && exp.includes('EXPORT_BATCH') && exp.includes('page.exhausted'), 'the export loops until the history is exhausted');
  assert.ok(exp.includes('cursor = page.nextCursor'), 'using the same keyset as the page');
  // A row keeps its database reference, so it can be checked against Customer History.
  const block = historyBlock({ ts: '2026-10-01 08:00:00', source_id: 'msg:4841', kind: 'message', sender_role: 'customer', channel: 'whatsapp', customer_id: 77, customer_name: 'Old Customer', phone: null, psid: null, conversation_id: 12, body: 'old message', meta: 'msg:4841 | text | delivered', vehicle_id: null, stock_no: null, category: null, brand: null, model: null, model_year: null, ref: 'msg:4841' });
  assert.ok(block.includes('Ref: msg:4841 | conversation #12 | customer #77'), 'the exported line carries the record id and conversation reference');
});

test('filters and ordering behave as the page promises', () => {
  const src = read(LIB);
  assert.ok(src.includes("const w: string[] = ['ts IS NOT NULL']"), 'only a null timestamp is excluded by default');
  assert.ok(src.includes('if (/^\\d{4}-\\d{2}-\\d{2}$/.test(from))'), 'an empty date means all dates');
  assert.ok(src.includes("if (['whatsapp', 'facebook', 'website'].includes(String(f.channel)))"), 'an empty channel means every channel');
  assert.ok(src.includes("if (['message', 'system', 'referral', 'quote', 'note', 'memory', 'learning'].includes(String(f.kind)))"), 'an empty event type means every event');
  assert.ok(src.includes("if (['customer', 'ai', 'human', 'system', 'staff'].includes(String(f.role)))"), 'an empty person means everyone');
  assert.ok(src.includes('sender_role IN (\'human\',\'staff\')'), 'Staff/human covers both labels');
  const client = read(CLIENT);
  assert.ok(client.includes("kind: '', q: ''") && client.includes("channel: ''") && client.includes("role: ''"), 'the page defaults to no filters');
  assert.ok(!client.includes("kind: 'message'"), 'the default is not restricted to one event type');
});
