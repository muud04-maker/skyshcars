// GOAL 1/2/8 - one all-history stream for every customer and channel, plus two streaming TXT exports.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const load = require('./lib.cjs');
const { historyBlock, historyHeader, EXPORT_BATCH, EXPORT_MAX, ROLE_LABEL } = load('all-history.js');

const root = path.join(__dirname, '..', '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const LIB = 'src/lib/all-history.ts';
const EXPORT = 'src/app/api/admin/all-history/export/route.ts';
const API = 'src/app/api/admin/all-history/route.ts';
const PAGE = 'src/app/admin/all-history/page.tsx';
const CLIENT = 'src/app/admin/all-history/AllHistoryClient.tsx';
const LEARN_EXPORT = 'src/app/api/admin/ai-learning/export/route.ts';

test('4/5/6/7. the stream is a UNION of every source, keyed on the real customer', () => {
  const src = read(LIB);
  for (const from of ['FROM messages m', 'FROM ai_agent_events e', 'FROM chat_referrals r', 'FROM quote_requests q', 'FROM staff_notes n', 'FROM customer_fact_events f', 'FROM ai_learning_events l']) {
    assert.ok(src.includes(from), `history includes ${from}`);
  }
  assert.ok(src.includes('LEFT JOIN customers cu ON cu.id=c.customer_id'), 'messages carry the customer identity');
  assert.ok(src.includes('cu.phone') && src.includes('cu.facebook_psid'), 'phone and PSID are shown');
  assert.ok(src.includes('c.channel'), 'the channel travels with every row');
  assert.ok(src.includes("'message' kind"), 'customer/AI/human messages are one kind with a role');
  assert.ok(src.includes('role') && src.includes("WHEN 'customer' THEN 'customer' WHEN 'human' THEN 'human' WHEN 'ai' THEN 'ai'"), 'AI, human and customer roles are preserved');
  // Isolation: a customer filter is a hard WHERE on customer_id, never a text match.
  assert.ok(src.includes("if (f.customerId) { w.push('customer_id = ?')"), 'customer filter is exact');
  assert.ok(!/JOIN customers cu ON[^\n]*OR/.test(src), 'no fuzzy customer join');
});

test('1. filters cover date, channel, customer, person, vehicle, stock, category and Facebook leads', () => {
  const src = read(LIB);
  for (const w of ["ts >= ?", "ts <= ?", 'channel = ?', 'customer_id = ?', "category = ?", '(stock_no LIKE ? OR body LIKE ?)']) {
    assert.ok(src.includes(w), `filter: ${w}`);
  }
  assert.ok(src.includes("f.role === 'staff' ? \"role IN ('human','staff')\" : 'role = ?'"), 'staff/human filter');
  assert.ok(src.includes('facebookOnly') && src.includes("(channel = 'facebook' OR kind = 'referral')"), 'Facebook-lead-only filter');
  const client = read(CLIENT);
  for (const f of ['From', 'To', 'Channel', 'Who', 'Event type', 'Vehicle type', 'Vehicle / stock', 'Customer #', 'Search', 'Facebook leads', 'Order']) {
    assert.ok(client.includes(f), `page filter ${f}`);
  }
  assert.ok(client.includes("value=\"desc\">Newest first") && client.includes('value="asc">Oldest first'), 'newest/oldest sorting');
  assert.ok(client.includes('Load more') && client.includes("cursor_ts"), 'large streams page with a keyset cursor');
});

test('2/4/8. the TXT export is one single streamed file over ALL matching history', () => {
  const src = read(EXPORT);
  assert.ok(src.includes('new ReadableStream'), 'streamed, not built in memory');
  assert.ok(src.includes('EXPORT_BATCH'), 'walked in batches');
  assert.ok(src.includes("order: 'asc'"), 'chronological file');
  assert.ok(src.includes('EXPORT_MAX'), 'a safety cap exists');
  assert.ok(src.includes('TRUNCATED AT'), 'hitting the cap says so - it never stops silently');
  assert.ok(src.includes("'content-disposition'") && src.includes('.txt"'), 'one .txt download');
  assert.ok(src.includes("text/plain; charset=utf-8"), 'plain text');
  assert.ok(!src.includes('forEach((c) =>') && !src.includes('for (const customer of'), 'never one file per customer');
  assert.ok(read(CLIENT).includes('Download All History (.txt)'), 'the button exists on the page');
  assert.ok(read(CLIENT).includes("'/api/admin/all-history/export?' + qs(filters)"), 'the download uses the same filters as the page');
  assert.equal(EXPORT_BATCH, 500);
  assert.ok(EXPORT_MAX >= 1000);
});

test('the exported block uses the required readable format with a blank line between events', () => {
  const block = historyBlock({
    ts: '2026-10-17 09:05:03', source_id: 'msg:9', kind: 'message', role: 'customer', channel: 'whatsapp',
    customer_id: 12, customer_name: 'Ali', phone: '255700000001', psid: null, conversation_id: 3,
    body: 'Do you have a CBR1000?', meta: 'text|delivered', vehicle_id: 5, stock_no: 'SC-859',
    category: 'motorcycle', brand: 'Honda', model: 'CBR1000', model_year: 2011,
  });
  assert.ok(block.startsWith('[2026-10-17 09:05:03] [WHATSAPP] [Ali] [CUSTOMER]'), block.split('\n')[0]);
  assert.ok(block.includes('Vehicle: 2011 Honda CBR1000 (motorcycle)'));
  assert.ok(block.includes('Stock: SC-859'));
  assert.ok(block.includes('Message: Do you have a CBR1000?'));
  assert.ok(block.endsWith('\n'), 'one blank line between events');
  const event = historyBlock({
    ts: '2026-10-17 09:00:00', source_id: 'evt:1', kind: 'system', role: 'system', channel: 'facebook',
    customer_id: 12, customer_name: null, phone: null, psid: '1234567890123456', conversation_id: 3,
    body: 'referral_matched (ok)', meta: 'referral_matched', vehicle_id: null, stock_no: null,
    category: null, brand: null, model: null, model_year: null,
  });
  assert.ok(event.startsWith('[2026-10-17 09:00:00] [FACEBOOK] [1234567890123456] [SYSTEM]'));
  assert.ok(event.includes('Type: SYSTEM'));
  const head = historyHeader({ from: '2026-10-01', channel: 'whatsapp', facebookOnly: true }, 42);
  assert.ok(head.includes('SKY CARS - ALL HISTORY EXPORT'));
  assert.ok(head.includes('Matching events: 42'));
  assert.ok(head.includes('from 2026-10-01') && head.includes('channel whatsapp') && head.includes('Facebook leads only'));
  assert.equal(ROLE_LABEL.customer, 'CUSTOMER');
});

test('3. the AI-learning TXT export contains the full lesson record', () => {
  const src = read(LEARN_EXPORT);
  assert.ok(src.includes('new ReadableStream'), 'streamed');
  assert.ok(src.includes('SKY CARS - AI LEARNING EXPORT'));
  for (const f of ['Question:', 'AI answer:', 'Human correction:', 'Reason:', 'Lesson:', 'Type:', 'Status:', 'Applies to:', 'Applied as:', 'Vehicle / referral context:']) {
    assert.ok(src.includes(f), `export includes ${f}`);
  }
  assert.ok(src.includes('Event #'), 'event id');
  assert.ok(src.includes('Timestamp:') && src.includes('Customer:') && src.includes('Conversation:'), 'identity + conversation');
  assert.ok(src.includes('TRUNCATED AT'), 'never truncates silently');
  assert.ok(read('src/app/admin/ai-learning/AiLearningClient.tsx').includes('Download AI Learning (.txt)'), 'button on the page');
  assert.ok(src.includes('ensureAiLearningSchema'), 'the table is created before reading');
});

test('1/30. the page and both endpoints are admin-only and never public', () => {
  assert.ok(read(PAGE).includes("redirect('/admin/login')"), 'page requires login');
  assert.ok(read(PAGE).includes('index: false'), 'noindex');
  assert.ok(read(API).includes('adminDenied()'), 'stream API is guarded');
  assert.ok(read(EXPORT).includes('getAdminSession') && read(EXPORT).includes("status: 401"), 'export API is guarded');
  assert.ok(read(LEARN_EXPORT).includes('getAdminSession'), 'learning export is guarded');
  assert.ok(!read('src/app/api/vehicles/route.ts').includes('all-history'), 'no public route exposes the stream');
});
