/*
  ONE chronological stream across ALL customers and ALL channels (admin only).

  The admin should never have to open customers one by one. Every source that matters is projected
  into one row shape (timestamp, kind, sender_role, channel, customer, message, vehicle/stock) and read
  with keyset pagination, so the page can show a live stream and the TXT export can walk the whole
  history in batches without loading everything into memory.

  Two hard-won rules are encoded here:
    1. The stream column is called `sender_role`. The word we used before it is a RESERVED keyword in
       MySQL 8 (it belongs to CREATE ROLE), so using it as a bare SQL alias is a syntax error that
       fails the whole UNION - which is exactly why this page once showed 0 events while Customer
       History showed 152 customers.
    2. A failing query must never look like "no data". Sources are probed first (so a table that has
       not been created yet cannot break the stream) and any remaining error is returned to the caller
       instead of being swallowed.

  Read-only. No customer's rows are ever mixed into another customer's export.
*/
import { rows } from './db';

export type HistoryFilters = {
  from?: string; to?: string; channel?: string; role?: string; kind?: string;
  customerId?: number; q?: string; stock?: string; category?: string; facebookOnly?: boolean;
};
export type HistoryRow = {
  ts: string; source_id: string; kind: string; sender_role: string; channel: string | null;
  customer_id: number | null; customer_name: string | null; phone: string | null; psid: string | null;
  conversation_id: number | null; body: string | null; meta: string | null;
  vehicle_id: number | null; stock_no: string | null; category: string | null;
  brand: string | null; model: string | null; model_year: number | null;
};
export type HistoryCursor = { ts: string; id: string } | null;

/* ---------------------------------------------------------------- source probing */
/* The tables the stream reads. Optional ones are only used when they really exist. */
export const HISTORY_TABLES = {
  messages: 'messages', conversations: 'conversations', customers: 'customers',
  state: 'conversation_state', vehicles: 'vehicles', events: 'ai_agent_events',
  referrals: 'chat_referrals', quotes: 'quote_requests', notes: 'staff_notes',
  facts: 'customer_fact_events', learning: 'ai_learning_events',
} as const;

let probe: { at: number; tables: Set<string> } | null = null;
const PROBE_MS = 60 * 1000;

/**
 * Make sure the optional tables exist (their own modules create them), then ask MySQL which of them
 * are really there. A table that is missing only drops its own branch - it can never blank the page.
 */
export async function ensureHistoryTables(): Promise<Set<string>> {
  if (probe && Date.now() - probe.at < PROBE_MS) return probe.tables;
  const ensure: Promise<any>[] = [];
  try { const m = await import('./conversation-state'); ensure.push(m.ensureConversationState()); } catch { /* optional */ }
  try { const m = await import('./referrals'); ensure.push(m.ensureReferralSchema()); } catch { /* optional */ }
  try { const m = await import('./agent-events'); ensure.push(m.ensureAgentEvents()); } catch { /* optional */ }
  try { const m = await import('./ai-learning'); ensure.push(m.ensureAiLearningSchema()); } catch { /* optional */ }
  try { const m = await import('./customer-facts'); ensure.push(m.ensureCustomerFactsSchema()); } catch { /* optional */ }
  try { const m = await import('./staff-notes'); ensure.push(m.ensureStaffNotesSchema()); } catch { /* optional */ }
  try { const m = await import('./vehicle-events'); ensure.push(m.ensureVehicleEventsSchema()); } catch { /* optional */ }
  await Promise.all(ensure.map((p) => Promise.resolve(p).catch(() => null)));
  const names = Object.values(HISTORY_TABLES);
  const found = await rows<any>(`SELECT TABLE_NAME n FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME IN (${names.map(() => '?').join(',')})`, names).catch(() => [] as any[]);
  const tables = new Set<string>(found.map((r: any) => String(r.n)));
  // Without these three the stream cannot work at all; treat them as present so the caller sees the
  // real SQL error instead of a silent empty list.
  for (const required of [HISTORY_TABLES.messages, HISTORY_TABLES.conversations, HISTORY_TABLES.customers]) tables.add(required);
  probe = { at: Date.now(), tables };
  return tables;
}

/** Reset the cached probe (used by tests / after a schema change). */
export function forgetHistoryTables() { probe = null; }

/**
 * Build the UNION from the sources that exist. PURE + testable: give it a set of table names and it
 * returns the SQL. Every branch projects the same column list, and `sender_role` is deliberately not
 * the MySQL-reserved word `role`.
 */
export function buildHistorySources(tables: Set<string>): string {
  const has = (t: string) => tables.has(t);
  const T = HISTORY_TABLES;
  const identity = `LEFT JOIN customers cu ON cu.id=c.customer_id`;
  const vehicleFromState = has(T.state) && has(T.vehicles);
  const stateJoin = has(T.state) ? `LEFT JOIN conversation_state s ON s.conversation_id=c.id` : '';
  const vehicleJoin = vehicleFromState ? `LEFT JOIN vehicles v ON v.id=s.current_vehicle_id` : '';
  const vehicleCols = vehicleFromState
    ? `v.id vehicle_id, v.stock_no, v.category, v.brand, v.model, v.model_year`
    : `NULL vehicle_id, NULL stock_no, NULL category, NULL brand, NULL model, NULL model_year`;
  const branches: string[] = [];

  if (has(T.messages) && has(T.conversations)) branches.push(`
  SELECT m.created_at ts, CONCAT('msg:',m.id) source_id, 'message' kind,
    CASE m.sender WHEN 'customer' THEN 'customer' WHEN 'human' THEN 'human' WHEN 'ai' THEN 'ai' ELSE 'system' END sender_role,
    c.channel, cu.id customer_id, cu.full_name customer_name, cu.phone, cu.facebook_psid psid,
    c.id conversation_id, CONCAT('msg:',m.id) ref, m.body,
    CONCAT('msg:',m.id,' | ',COALESCE(m.message_type,'text'),' | ',COALESCE(m.delivery_status,'-')) meta,
    ${vehicleCols}
  FROM messages m
  JOIN conversations c ON c.id=m.conversation_id
  ${identity}
  ${stateJoin}
  ${vehicleJoin}`);

  if (has(T.events) && has(T.conversations)) branches.push(`
  SELECT e.created_at ts, CONCAT('evt:',e.id) source_id, 'system' kind, 'system' sender_role,
    c.channel, cu.id, cu.full_name, cu.phone, cu.facebook_psid,
    c.id, CONCAT('evt:',e.id),
    CONCAT(e.event_type,' (',e.status,')', CASE WHEN e.details IS NULL THEN '' ELSE CONCAT(': ', LEFT(e.details,300)) END),
    e.event_type, ${vehicleCols}
  FROM ai_agent_events e
  JOIN conversations c ON c.id=e.conversation_id
  ${identity}
  ${stateJoin}
  ${vehicleJoin}`);

  if (has(T.referrals)) branches.push(`
  SELECT r.created_at ts, CONCAT('ref:',r.id) source_id, 'referral' kind, 'customer' sender_role,
    r.channel, cu.id, cu.full_name, cu.phone, cu.facebook_psid,
    r.conversation_id, CONCAT('ref:',r.id),
    COALESCE(r.headline, r.body, r.source_id) body,
    CONCAT('method:',COALESCE(r.match_method,'none')),
    rv.id vehicle_id, rv.stock_no, rv.category, rv.brand, rv.model, rv.model_year
  FROM chat_referrals r
  LEFT JOIN conversations c ON c.id=r.conversation_id
  ${identity}
  ${has(T.vehicles) ? 'LEFT JOIN vehicles rv ON rv.id=r.matched_vehicle_id' : ''}`);

  if (has(T.quotes)) branches.push(`
  SELECT q.created_at ts, CONCAT('quote:',q.id) source_id, 'quote' kind, 'system' sender_role,
    NULL, cu.id, cu.full_name, cu.phone, cu.facebook_psid,
    NULL, CONCAT('quote:',q.id),
    CONCAT(COALESCE(q.reference,'quote'),' | ',COALESCE(q.status,'new'),' | total: ',COALESCE(q.quoted_total_usd,'-')),
    q.status, qv.id, qv.stock_no, qv.category, qv.brand, qv.model, qv.model_year
  FROM quote_requests q
  ${identity}
  ${has(T.vehicles) ? 'LEFT JOIN vehicles qv ON qv.id=q.vehicle_id' : ''}`);

  if (has(T.notes)) branches.push(`
  SELECT n.created_at ts, CONCAT('note:',n.id) source_id, 'note' kind, 'staff' sender_role,
    NULL, cu.id, cu.full_name, cu.phone, cu.facebook_psid,
    NULL, CONCAT('note:',n.id),
    CONCAT('STAFF NOTE by ',COALESCE(n.author,'staff'),': ',n.note), NULL,
    NULL, NULL, NULL, NULL, NULL, NULL
  FROM staff_notes n
  ${identity}
  WHERE n.active=1`);

  if (has(T.facts)) branches.push(`
  SELECT f.changed_at ts, CONCAT('mem:',f.id) source_id, 'memory' kind, 'system' sender_role,
    NULL, cu.id, cu.full_name, cu.phone, cu.facebook_psid,
    NULL, CONCAT('mem:',f.id),
    CONCAT('memory ',f.action,' | ',f.fact_key,': ',COALESCE(f.old_value,'(none)'),' -> ',COALESCE(f.new_value,'(removed)')),
    f.source, NULL, NULL, NULL, NULL, NULL, NULL
  FROM customer_fact_events f
  ${identity}`);

  if (has(T.learning)) branches.push(`
  SELECT l.created_at ts, CONCAT('learn:',l.id) source_id, 'learning' kind, 'system' sender_role,
    c.channel, cu.id, cu.full_name, cu.phone, cu.facebook_psid,
    l.conversation_id, CONCAT('learn:',l.id),
    CONCAT(COALESCE(l.event_type,'other'),' [',COALESCE(l.status,'pending'),']',
      CASE WHEN l.correction IS NULL THEN '' ELSE CONCAT(' | correction: ',LEFT(l.correction,300)) END),
    CONCAT('reason:',COALESCE(l.reason,'-'),'|applies_to:',COALESCE(l.applies_to,'global')),
    ${has(T.vehicles) ? "lv.id, lv.stock_no, lv.category, lv.brand, lv.model, lv.model_year" : 'NULL, NULL, NULL, NULL, NULL, NULL'}
  FROM ai_learning_events l
  LEFT JOIN conversations c ON c.id=l.conversation_id
  ${identity}
  ${has(T.vehicles) ? "LEFT JOIN vehicles lv ON lv.id=JSON_EXTRACT(COALESCE(l.payload,'{}'), '$.vehicle_id')" : ''}`);

  return branches.join('\n  UNION ALL\n');
}

function whereFor(f: HistoryFilters, cursor: HistoryCursor, order: 'asc' | 'desc') {
  const w: string[] = ['ts IS NOT NULL']; const a: any[] = [];
  const from = String(f.from || '').trim(), to = String(f.to || '').trim();
  // Empty dates mean ALL dates; empty channel/role/kind mean no restriction at all.
  if (/^\d{4}-\d{2}-\d{2}$/.test(from)) { w.push('ts >= ?'); a.push(`${from} 00:00:00`); }
  if (/^\d{4}-\d{2}-\d{2}$/.test(to)) { w.push('ts <= ?'); a.push(`${to} 23:59:59`); }
  if (['whatsapp', 'facebook', 'website'].includes(String(f.channel))) { w.push('channel = ?'); a.push(f.channel); }
  if (['customer', 'ai', 'human', 'system', 'staff'].includes(String(f.role))) {
    w.push(f.role === 'staff' ? "sender_role IN ('human','staff')" : 'sender_role = ?');
    if (f.role !== 'staff') a.push(f.role);
  }
  if (['message', 'system', 'referral', 'quote', 'note', 'memory', 'learning'].includes(String(f.kind))) { w.push('kind = ?'); a.push(f.kind); }
  if (f.customerId) { w.push('customer_id = ?'); a.push(Number(f.customerId)); }
  if (f.category === 'car' || f.category === 'motorcycle') { w.push('category = ?'); a.push(f.category); }
  const stock = String(f.stock || '').trim();
  if (stock) { w.push('(stock_no LIKE ? OR body LIKE ?)'); a.push(`%${stock}%`, `%${stock}%`); }
  const q = String(f.q || '').trim();
  if (q) {
    w.push('(body LIKE ? OR customer_name LIKE ? OR phone LIKE ? OR psid LIKE ? OR stock_no LIKE ? OR brand LIKE ? OR model LIKE ?)');
    const like = `%${q}%`; a.push(like, like, like, like, like, like, like);
  }
  if (f.facebookOnly) w.push("(channel = 'facebook' OR kind = 'referral')");
  if (cursor?.ts) {
    if (order === 'asc') { w.push('(ts > ? OR (ts = ? AND source_id > ?))'); a.push(cursor.ts, cursor.ts, cursor.id); }
    else { w.push('(ts < ? OR (ts = ? AND source_id < ?))'); a.push(cursor.ts, cursor.ts, cursor.id); }
  }
  return { where: w.join(' AND '), args: a };
}

const selectFor = (sources: string) => `SELECT ts,source_id,kind,sender_role,channel,customer_id,customer_name,phone,psid,
  conversation_id,ref,body,meta,vehicle_id,stock_no,category,brand,model,model_year
  FROM (${sources}) h`;

/**
 * One page of the stream. `exhausted` tells the caller (and the exporter) there is nothing more.
 * A database error is RETURNED (never disguised as "no data"): `error` + `sources` are reported so the
 * admin page and the export can say what went wrong instead of showing an empty history.
 */
export async function historyPage(
  filters: HistoryFilters = {},
  opts: { limit?: number; order?: 'asc' | 'desc'; cursor?: HistoryCursor } = {},
) {
  const order = opts.order === 'asc' ? 'asc' : 'desc';
  const limit = Math.max(1, Math.min(1000, Number(opts.limit) || 100));
  const { where, args } = whereFor(filters, opts.cursor || null, order);
  const tables = await ensureHistoryTables();
  const sources = buildHistorySources(tables);
  let list: any[] = []; let error: string | null = null;
  try {
    list = await rows<any>(`${selectFor(sources)} WHERE ${where} ORDER BY ts ${order.toUpperCase()}, source_id ${order.toUpperCase()} LIMIT ${limit}`, args);
  } catch (e: any) {
    error = String(e?.sqlMessage || e?.message || e);
    console.error('ALL_HISTORY_QUERY', error);
  }
  const last = list[list.length - 1];
  return {
    rows: list.map(normRow),
    nextCursor: list.length === limit && last ? { ts: String(last.ts), id: String(last.source_id) } : null,
    exhausted: list.length < limit,
    error,
    sources: [...tables].sort(),
  };
}

/** How many events match (capped count, used for the page header and the export summary). */
export async function historyCount(filters: HistoryFilters = {}): Promise<{ count: number; error: string | null }> {
  const { where, args } = whereFor(filters, null, 'desc');
  const tables = await ensureHistoryTables();
  try {
    const r = await rows<any>(`SELECT COUNT(*) n FROM (SELECT ts FROM (${buildHistorySources(tables)}) h WHERE ${where} LIMIT 500000) x`, args);
    return { count: Number(r?.[0]?.n || 0), error: null };
  } catch (e: any) {
    const error = String(e?.sqlMessage || e?.message || e);
    console.error('ALL_HISTORY_COUNT', error);
    return { count: 0, error };
  }
}

/**
 * Per-source counts, so the admin can reconcile the page with the database (and see WHY the number of
 * customers is not the number of events: one customer can have hundreds of messages/events).
 */
export async function historyDiagnostics() {
  const tables = await ensureHistoryTables();
  const has = (t: string) => tables.has(t);
  const one = async (sql: string, args: any[] = []) => {
    try { const r = await rows<any>(sql, args); return Number(r?.[0]?.n || 0); } catch { return null; }
  };
  const counts = {
    customers: has('customers') ? await one('SELECT COUNT(*) n FROM customers') : null,
    customers_with_messages: has('customers') && has('conversations') && has('messages')
      ? await one(`SELECT COUNT(DISTINCT c.customer_id) n FROM messages m JOIN conversations c ON c.id=m.conversation_id WHERE c.customer_id IS NOT NULL`) : null,
    conversations: has('conversations') ? await one('SELECT COUNT(*) n FROM conversations') : null,
    messages: has('messages') ? await one('SELECT COUNT(*) n FROM messages') : null,
    messages_by_role: has('messages')
      ? await (async () => { try { return (await rows<any>(`SELECT sender, COUNT(*) n FROM messages GROUP BY sender`)).map((r: any) => ({ sender: String(r.sender), count: Number(r.n || 0) })); } catch { return null; } })()
      : null,
    messages_today: has('messages') ? await one(`SELECT COUNT(*) n FROM messages WHERE created_at >= CURDATE()`) : null,
    events: has('events') ? await one('SELECT COUNT(*) n FROM ai_agent_events') : null,
    referrals: has('referrals') ? await one('SELECT COUNT(*) n FROM chat_referrals') : null,
    quotes: has('quotes') ? await one('SELECT COUNT(*) n FROM quote_requests') : null,
    notes: has('notes') ? await one('SELECT COUNT(*) n FROM staff_notes WHERE active=1') : null,
    memory_changes: has('facts') ? await one('SELECT COUNT(*) n FROM customer_fact_events') : null,
    learning_events: has('learning') ? await one('SELECT COUNT(*) n FROM ai_learning_events') : null,
  };
  const totalEvents = Number(counts.messages || 0) + Number(counts.events || 0) + Number(counts.referrals || 0)
    + Number(counts.quotes || 0) + Number(counts.notes || 0) + Number(counts.memory_changes || 0) + Number(counts.learning_events || 0);
  return {
    tables: [...tables].sort(),
    counts,
    total_events: totalEvents,
    explanation: `${counts.customers_with_messages ?? 0} of ${counts.customers ?? 0} customers have at least one message; those messages alone are ${counts.messages ?? 0} history events, so the event total (${totalEvents}) is much larger than the customer count. Every message, AI reply, staff reply, referral, quote, note, memory change and learning event is ONE row in this stream.`,
  };
}

function normRow(r: any): HistoryRow {
  return {
    ts: String(r.ts || ''), source_id: String(r.source_id || ''), kind: String(r.kind || ''), sender_role: String(r.sender_role || ''),
    channel: r.channel == null ? null : String(r.channel),
    customer_id: r.customer_id == null ? null : Number(r.customer_id),
    customer_name: r.customer_name == null ? null : String(r.customer_name),
    phone: r.phone == null ? null : String(r.phone), psid: r.psid == null ? null : String(r.psid),
    conversation_id: r.conversation_id == null ? null : Number(r.conversation_id),
    body: r.body == null ? null : String(r.body), meta: r.meta == null ? null : String(r.meta),
    vehicle_id: r.vehicle_id == null ? null : Number(r.vehicle_id),
    stock_no: r.stock_no == null ? null : String(r.stock_no), category: r.category == null ? null : String(r.category),
    brand: r.brand == null ? null : String(r.brand), model: r.model == null ? null : String(r.model),
    model_year: r.model_year == null ? null : Number(r.model_year),
  };
}

// ---------------------------------------------------------------- text rendering (shared by the page + export)
export const ROLE_LABEL: Record<string, string> = { customer: 'CUSTOMER', ai: 'AI', human: 'STAFF', staff: 'STAFF', system: 'SYSTEM' };
export const KIND_LABEL: Record<string, string> = {
  message: 'MESSAGE', system: 'SYSTEM', referral: 'REFERRAL', quote: 'QUOTE', note: 'NOTE', memory: 'MEMORY', learning: 'LEARNING',
};
const pad = (n: number) => String(n).padStart(2, '0');

/**
 * `[YYYY-MM-DD HH:mm:ss] [CHANNEL] [CUSTOMER] [ROLE]` plus Vehicle/Stock/Ref/Message and a blank line.
 * The Ref line carries the database record id and the conversation reference, so any line in the
 * download can be traced back to the exact record it came from.
 */
export function historyBlock(r: HistoryRow & { ref?: string | null }) {
  const t = r.ts ? String(r.ts).replace('T', ' ').slice(0, 19) : 'unknown time';
  const channel = String(r.channel || r.kind || 'system').toUpperCase();
  const who = r.customer_name || r.phone || r.psid || (r.customer_id ? `customer #${r.customer_id}` : 'unknown customer');
  const label = r.sender_role === 'customer' && r.kind !== 'message' ? KIND_LABEL[r.kind] || 'EVENT' : ROLE_LABEL[r.sender_role] || String(r.sender_role).toUpperCase();
  const vehicle = [r.model_year, r.brand, r.model].filter(Boolean).join(' ');
  const lines = [`[${t}] [${channel}] [${who}] [${label}]`];
  if (vehicle || r.stock_no || r.category) {
    lines.push(`Vehicle: ${vehicle || '-'}${r.category ? ` (${r.category})` : ''}`);
    lines.push(`Stock: ${r.stock_no || '-'}`);
  }
  if (r.kind !== 'message') lines.push(`Type: ${KIND_LABEL[r.kind] || r.kind}`);
  const ref = (r as any).ref ? String((r as any).ref) : '';
  if (ref || r.conversation_id) lines.push(`Ref: ${ref || '-'}${r.conversation_id ? ` | conversation #${r.conversation_id}` : ''}${r.customer_id ? ` | customer #${r.customer_id}` : ''}`);
  lines.push(`Message: ${String(r.body == null ? '' : r.body).replace(/\r?\n/g, ' ').trim() || '-'}`);
  return lines.join('\n') + '\n';
}

export function historyHeader(filters: HistoryFilters = {}, count?: number, sources?: string[]) {
  const bits = [
    filters.from ? `from ${filters.from}` : null, filters.to ? `to ${filters.to}` : null,
    filters.channel ? `channel ${filters.channel}` : null, filters.role ? `role ${filters.role}` : null,
    filters.kind ? `type ${filters.kind}` : null, filters.customerId ? `customer #${filters.customerId}` : null,
    filters.stock ? `stock/vehicle ${filters.stock}` : null, filters.category ? `category ${filters.category}` : null,
    filters.q ? `search "${filters.q}"` : null, filters.facebookOnly ? 'Facebook leads only' : null,
  ].filter(Boolean) as string[];
  return [
    'SKY CARS - ALL HISTORY EXPORT',
    `Generated: ${new Date().toISOString().slice(0, 19).replace('T', ' ')} UTC`,
    `Filters: ${bits.length ? bits.join(', ') : 'none (everything)'}`,
    count == null ? '' : `Matching events: ${count}`,
    sources?.length ? `Sources: ${sources.join(', ')}` : '',
    'Every customer, every channel, one chronological stream. Oldest first.',
    '='.repeat(72),
  ].filter((l) => l !== '').join('\n') + '\n\n';
}

/** Batch size for the streaming export (never loads the whole history at once). */
export const EXPORT_BATCH = 500;
/** Hard safety cap: if it is reached the export says so instead of stopping silently. */
export const EXPORT_MAX = Math.max(1000, Math.min(500000, Number(process.env.ALL_HISTORY_EXPORT_MAX) || 200000));
