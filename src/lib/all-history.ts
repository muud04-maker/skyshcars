/*
  ONE chronological stream across ALL customers and ALL channels (admin only).

  The admin should never have to open customers one by one. Every source that matters is projected
  into one row shape (timestamp, kind, role, channel, customer, message, vehicle/stock) and read with
  keyset pagination, so the page can show a live stream and the TXT export can walk the whole history
  in batches without loading everything into memory.

  Read-only. No customer's rows are ever mixed into another customer's export.
*/
import { rows } from './db';

export type HistoryFilters = {
  from?: string; to?: string; channel?: string; role?: string; kind?: string;
  customerId?: number; q?: string; stock?: string; category?: string; facebookOnly?: boolean;
};
export type HistoryRow = {
  ts: string; source_id: string; kind: string; role: string; channel: string | null;
  customer_id: number | null; customer_name: string | null; phone: string | null; psid: string | null;
  conversation_id: number | null; body: string | null; meta: string | null;
  vehicle_id: number | null; stock_no: string | null; category: string | null;
  brand: string | null; model: string | null; model_year: number | null;
};
export type HistoryCursor = { ts: string; id: string } | null;

/**
  The UNION of every history source. Each branch carries the same column list so filters and ordering
  can be applied once, in the wrapper, and pagination stays stable.
*/
const SOURCES = `
  SELECT m.created_at ts, CONCAT('msg:',m.id) source_id, 'message' kind,
    CASE m.sender WHEN 'customer' THEN 'customer' WHEN 'human' THEN 'human' WHEN 'ai' THEN 'ai' ELSE 'system' END role,
    c.channel, cu.id customer_id, cu.full_name customer_name, cu.phone, cu.facebook_psid psid,
    c.id conversation_id, m.body, CONCAT(COALESCE(m.message_type,'text'),'|',COALESCE(m.delivery_status,'')) meta,
    v.id vehicle_id, v.stock_no, v.category, v.brand, v.model, v.model_year
  FROM messages m
  JOIN conversations c ON c.id=m.conversation_id
  LEFT JOIN customers cu ON cu.id=c.customer_id
  LEFT JOIN conversation_state s ON s.conversation_id=c.id
  LEFT JOIN vehicles v ON v.id=s.current_vehicle_id
  UNION ALL
  SELECT e.created_at ts, CONCAT('evt:',e.id) source_id, 'system' kind, 'system' role,
    c.channel, cu.id, cu.full_name, cu.phone, cu.facebook_psid,
    c.id, CONCAT(e.event_type,' (',e.status,')', CASE WHEN e.details IS NULL THEN '' ELSE CONCAT(': ', LEFT(e.details,300)) END),
    e.event_type, v.id, v.stock_no, v.category, v.brand, v.model, v.model_year
  FROM ai_agent_events e
  JOIN conversations c ON c.id=e.conversation_id
  LEFT JOIN customers cu ON cu.id=c.customer_id
  LEFT JOIN conversation_state s ON s.conversation_id=c.id
  LEFT JOIN vehicles v ON v.id=s.current_vehicle_id
  UNION ALL
  SELECT r.created_at ts, CONCAT('ref:',r.id) source_id, 'referral' kind, 'customer' role,
    r.channel, cu.id, cu.full_name, cu.phone, cu.facebook_psid,
    r.conversation_id, COALESCE(r.headline, r.body, r.source_id), CONCAT('method:',COALESCE(r.match_method,'none')),
    v.id, v.stock_no, v.category, v.brand, v.model, v.model_year
  FROM chat_referrals r
  LEFT JOIN conversations c ON c.id=r.conversation_id
  LEFT JOIN customers cu ON cu.id=c.customer_id
  LEFT JOIN vehicles v ON v.id=r.matched_vehicle_id
  UNION ALL
  SELECT q.created_at ts, CONCAT('quote:',q.id) source_id, 'quote' kind, 'system' role,
    NULL, cu.id, cu.full_name, cu.phone, cu.facebook_psid,
    NULL, CONCAT(COALESCE(q.reference,'quote'),' | ',COALESCE(q.status,'new'),' | total: ',COALESCE(q.quoted_total_usd,'-')),
    q.status, v.id, v.stock_no, v.category, v.brand, v.model, v.model_year
  FROM quote_requests q
  LEFT JOIN customers cu ON cu.id=q.customer_id
  LEFT JOIN vehicles v ON v.id=q.vehicle_id
  UNION ALL
  SELECT n.created_at ts, CONCAT('note:',n.id) source_id, 'note' kind, 'staff' role,
    NULL, cu.id, cu.full_name, cu.phone, cu.facebook_psid,
    NULL, CONCAT('STAFF NOTE by ',COALESCE(n.author,'staff'),': ',n.note), NULL,
    NULL, NULL, NULL, NULL, NULL, NULL
  FROM staff_notes n
  LEFT JOIN customers cu ON cu.id=n.customer_id
  WHERE n.active=1
  UNION ALL
  SELECT f.changed_at ts, CONCAT('mem:',f.id) source_id, 'memory' kind, 'system' role,
    NULL, cu.id, cu.full_name, cu.phone, cu.facebook_psid,
    NULL, CONCAT('memory ',f.action,' | ',f.fact_key,': ',COALESCE(f.old_value,'(none)'),' -> ',COALESCE(f.new_value,'(removed)')),
    f.source, NULL, NULL, NULL, NULL, NULL, NULL
  FROM customer_fact_events f
  LEFT JOIN customers cu ON cu.id=f.customer_id
  UNION ALL
  SELECT l.created_at ts, CONCAT('learn:',l.id) source_id, 'learning' kind, 'system' role,
    c.channel, cu.id, cu.full_name, cu.phone, cu.facebook_psid,
    l.conversation_id,
    CONCAT(COALESCE(l.event_type,'other'),' [',COALESCE(l.status,'pending'),']',
      CASE WHEN l.correction IS NULL THEN '' ELSE CONCAT(' | correction: ',LEFT(l.correction,300)) END),
    CONCAT('reason:',COALESCE(l.reason,'-'),'|applies_to:',COALESCE(l.applies_to,'global')),
    v.id, v.stock_no, v.category, v.brand, v.model, v.model_year
  FROM ai_learning_events l
  LEFT JOIN conversations c ON c.id=l.conversation_id
  LEFT JOIN customers cu ON cu.id=l.customer_id
  LEFT JOIN vehicles v ON v.id=JSON_EXTRACT(COALESCE(l.payload,'{}'), '$.vehicle_id')
`;

function whereFor(f: HistoryFilters, cursor: HistoryCursor, order: 'asc' | 'desc') {
  const w: string[] = ['ts IS NOT NULL']; const a: any[] = [];
  const from = String(f.from || '').trim(), to = String(f.to || '').trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(from)) { w.push('ts >= ?'); a.push(`${from} 00:00:00`); }
  if (/^\d{4}-\d{2}-\d{2}$/.test(to)) { w.push('ts <= ?'); a.push(`${to} 23:59:59`); }
  if (['whatsapp', 'facebook', 'website'].includes(String(f.channel))) { w.push('channel = ?'); a.push(f.channel); }
  if (['customer', 'ai', 'human', 'system', 'staff'].includes(String(f.role))) {
    w.push(f.role === 'staff' ? "role IN ('human','staff')" : 'role = ?');
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

const SELECT = `SELECT ts,source_id,kind,role,channel,customer_id,customer_name,phone,psid,conversation_id,body,meta,
  vehicle_id,stock_no,category,brand,model,model_year FROM (${SOURCES}) h`;

/** One page of the stream. `exhausted` tells the caller (and the exporter) there is nothing more. */
export async function historyPage(
  filters: HistoryFilters = {},
  opts: { limit?: number; order?: 'asc' | 'desc'; cursor?: HistoryCursor } = {},
) {
  const order = opts.order === 'asc' ? 'asc' : 'desc';
  const limit = Math.max(1, Math.min(1000, Number(opts.limit) || 100));
  const { where, args } = whereFor(filters, opts.cursor || null, order);
  const list = await rows<any>(`${SELECT} WHERE ${where} ORDER BY ts ${order.toUpperCase()}, source_id ${order.toUpperCase()} LIMIT ${limit}`, args).catch(() => []);
  const last = list[list.length - 1];
  return {
    rows: list.map(normRow),
    nextCursor: list.length === limit && last ? { ts: String(last.ts), id: String(last.source_id) } : null,
    exhausted: list.length < limit,
  };
}

/** How many events match (capped count, used for the page header and the export summary). */
export async function historyCount(filters: HistoryFilters = {}) {
  const { where, args } = whereFor(filters, null, 'desc');
  const r = await rows<any>(`SELECT COUNT(*) n FROM (SELECT ts FROM (${SOURCES}) h WHERE ${where} LIMIT 500000) x`, args).catch(() => []);
  return Number(r?.[0]?.n || 0);
}

function normRow(r: any): HistoryRow {
  return {
    ts: String(r.ts || ''), source_id: String(r.source_id || ''), kind: String(r.kind || ''), role: String(r.role || ''),
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

/** `[YYYY-MM-DD HH:mm:ss] [CHANNEL] [CUSTOMER] [ROLE]` plus Vehicle/Stock/Message and a blank line. */
export function historyBlock(r: HistoryRow) {
  const t = r.ts ? String(r.ts).replace('T', ' ').slice(0, 19) : 'unknown time';
  const channel = String(r.channel || r.kind || 'system').toUpperCase();
  const who = r.customer_name || r.phone || r.psid || (r.customer_id ? `customer #${r.customer_id}` : 'unknown customer');
  const role = r.role === 'customer' && r.kind !== 'message' ? KIND_LABEL[r.kind] || 'EVENT' : ROLE_LABEL[r.role] || String(r.role).toUpperCase();
  const vehicle = [r.model_year, r.brand, r.model].filter(Boolean).join(' ');
  const lines = [`[${t}] [${channel}] [${who}] [${role}]`];
  if (vehicle || r.stock_no || r.category) {
    lines.push(`Vehicle: ${vehicle || '-'}${r.category ? ` (${r.category})` : ''}`);
    lines.push(`Stock: ${r.stock_no || '-'}`);
  }
  if (r.kind !== 'message') lines.push(`Type: ${KIND_LABEL[r.kind] || r.kind}`);
  lines.push(`Message: ${String(r.body == null ? '' : r.body).replace(/\r?\n/g, ' ').trim() || '-'}`);
  return lines.join('\n') + '\n';
}

export function historyHeader(filters: HistoryFilters = {}, count?: number) {
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
    'Every customer, every channel, one chronological stream. Oldest first.',
    '='.repeat(72),
  ].filter((l) => l !== '').join('\n') + '\n\n';
}

/** Batch size for the streaming export (never loads the whole history at once). */
export const EXPORT_BATCH = 500;
/** Hard safety cap: if it is reached the export says so instead of stopping silently. */
export const EXPORT_MAX = Math.max(1000, Math.min(500000, Number(process.env.ALL_HISTORY_EXPORT_MAX) || 200000));
