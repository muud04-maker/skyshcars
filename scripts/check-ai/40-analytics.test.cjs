// EXECUTIVE ANALYTICS: period maths, banding, source wiring and release safety.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const load = require('./lib.cjs');
const {resolveAnalyticsPeriod, analyticsChangePct, budgetBand, responseBand} = load('analytics.js');

const root = path.join(__dirname, '..', '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');

test('analytics periods resolve to inclusive ranges with a comparable previous window', () => {
  const now = new Date('2026-10-19T12:00:00Z');
  const d7 = resolveAnalyticsPeriod({range: '7d'}, now);
  assert.equal(d7.from, '2026-10-13');
  assert.equal(d7.to, '2026-10-19');
  assert.equal(d7.previousFrom, '2026-10-06');
  assert.equal(d7.previousTo, '2026-10-12');
  assert.equal(d7.days, 7);

  const month = resolveAnalyticsPeriod({range: 'this_month'}, now);
  assert.equal(month.from, '2026-10-01');
  assert.equal(month.to, '2026-10-19');
  assert.equal(month.previousTo, '2026-09-30');

  const prevMonth = resolveAnalyticsPeriod({range: 'previous_month'}, now);
  assert.equal(prevMonth.from, '2026-09-01');
  assert.equal(prevMonth.to, '2026-09-30');

  const custom = resolveAnalyticsPeriod({range: 'custom', from: '2026-01-10', to: '2026-01-01'}, now);
  assert.equal(custom.from, '2026-01-01');
  assert.equal(custom.to, '2026-01-10');

  const all = resolveAnalyticsPeriod({range: 'all'}, now);
  assert.equal(all.previousFrom, null);
  assert.equal(all.days, null);
});

test('analytics comparison and demand bands are deterministic', () => {
  assert.equal(analyticsChangePct(120, 100), 20);
  assert.equal(analyticsChangePct(80, 100), -20);
  assert.equal(analyticsChangePct(5, 0), null);
  assert.equal(analyticsChangePct(5, null), null);
  assert.equal(budgetBand(2800), '<= $3k');
  assert.equal(budgetBand('$8,500'), '$8k-$12k');
  assert.equal(budgetBand('not stated'), 'Not specified');
  assert.equal(responseBand(20), '< 1 min');
  assert.equal(responseBand(240), '1-5 min');
  assert.equal(responseBand(4000), '30-120 min');
  assert.equal(responseBand(null), 'No paired reply');
});

test('the dashboard and APIs are admin-only', () => {
  const page = read('src/app/admin/analytics/page.tsx');
  assert.ok(page.includes('isAdmin'));
  assert.ok(page.includes("redirect('/admin/login')"));
  assert.ok(page.includes('AnalyticsDashboard'));
  const print = read('src/app/admin/analytics/print/page.tsx');
  assert.ok(print.includes('isAdmin') && print.includes('printMode'));
  const api = read('src/app/api/admin/analytics/route.ts');
  assert.ok(api.includes('adminDenied'));
  const exp = read('src/app/api/admin/analytics/export/route.ts');
  assert.ok(exp.includes('getAdminSession'));
  assert.ok(exp.includes('export_analytics_'));
});

test('the executive dashboard exposes KPIs, charts, tables, filters and exports', () => {
  const ui = read('src/app/admin/analytics/_components/AnalyticsDashboard.tsx');
  for (const marker of ['analyticsKpiGrid', 'analyticsPanelGrid', 'analyticsTables', 'analyticsDefinitions', 'CSV', 'Excel', 'Print / PDF']) {
    assert.ok(ui.includes(marker), marker);
  }
  const shell = read('src/app/admin/_components/AdminShell.tsx');
  assert.ok(shell.includes('/admin/analytics'));
  const tabs = read('src/app/admin/_components/AdminTabBar.tsx');
  assert.ok(tabs.includes("'/admin/analytics', 'Reports'"));
});

test('real-data source rules and honest unavailable metrics are documented', () => {
  const source = read('src/lib/analytics.ts');
  assert.ok(source.includes('REAL_VEHICLE'));
  assert.ok(source.includes("NOT LIKE 'demo%'"));
  assert.ok(source.includes('conversation_vehicle_events'));
  assert.ok(source.includes('exactPhotoSql'));
  assert.ok(source.includes('No payments table'));
  assert.ok(source.includes('Not inferred from Sold inventory'));
  assert.ok(source.includes('responseBand'));
  assert.ok(source.includes('budgetBand'));
  assert.ok(read('src/app/api/admin/analytics/export/route.ts').includes('METRIC DEFINITIONS'));
});
