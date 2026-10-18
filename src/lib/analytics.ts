/*
  Executive analytics aggregation. Every number is read from the existing Sky Cars tables and keeps
  its source/quality with it. No raw conversations are sent to the browser; the dashboard receives
  aggregate rows and short, admin-safe labels only.
*/
import { dbConfigured, one, rows, ping } from './db';
import { exactPhotoSql } from './exact-photos';
import { ensureConversationState } from './conversation-state';
import { ensureStaffTasksSchema } from './staff-tasks';
import { ensureAiLearningSchema, detectContradictions } from './ai-learning';
import { ensureCustomerFactsSchema } from './customer-facts';
import { ensureVehicleEventsSchema } from './vehicle-events';
import { ensureAgentEvents } from './agent-events';
import { verifyCriticalSchemas } from './schema-health';

export type Quality = 'verified' | 'inferred' | 'heuristic' | 'untracked' | 'unavailable';
export type RangeKey = 'today' | '7d' | '30d' | 'this_month' | 'previous_month' | 'this_year' | 'all' | 'custom';

export type AnalyticsPeriod = {
  key: RangeKey;
  label: string;
  from: string;
  to: string;
  fromTs: string;
  toTs: string;
  days: number | null;
  previousFrom: string | null;
  previousTo: string | null;
  previousFromTs: string | null;
  previousToTs: string | null;
  comparisonLabel: string;
};

export type AnalyticsInput = { range?: string | null; from?: string | null; to?: string | null };

export type Kpi = {
  key: string;
  label: string;
  value: number | string;
  unit?: string;
  change: number | null;
  current?: boolean;
  quality: Quality;
  source: string;
  method: string;
  href?: string;
  tone?: 'navy' | 'gold' | 'emerald' | 'blue' | 'red' | 'slate';
};

export type Series = { name: string; color: string; values: number[] };
export type ChartItem = { label: string; value: number; color?: string; href?: string; title?: string };
export type FunnelStep = { label: string; value: number; note?: string };
export type TableColumn = { key: string; label: string; align?: 'left' | 'right' };
export type TableRow = Record<string, any>;

export type Panel = {
  key: string;
  title: string;
  question: string;
  kind: 'bars' | 'stacked' | 'line' | 'donut' | 'funnel' | 'table' | 'status';
  span?: 1 | 2 | 3;
  data: any;
  source: string;
  method: string;
  quality: Quality;
  note?: string;
  error?: string | null;
  href?: string;
};

export type ReportTable = {
  key: string;
  title: string;
  description: string;
  columns: TableColumn[];
  rows: TableRow[];
  source: string;
  quality: Quality;
  error?: string | null;
};

export type ActionRow = { priority: string; need: string; detail: string; href: string };

export type Definition = {
  metric: string;
  source: string;
  period: string;
  method: string;
  quality: Quality;
  limitation: string;
};

export type AnalyticsReport = {
  generatedAt: string;
  databaseConfigured: boolean;
  databaseError: string | null;
  period: AnalyticsPeriod;
  kpis: Kpi[];
  panels: Panel[];
  tables: ReportTable[];
  definitions: Definition[];
  alerts: ActionRow[];
  alertCount: number;
};

const REAL_VEHICLE = `COALESCE(v.source,'') NOT LIKE 'demo%' AND COALESCE(v.stock_no,'') NOT LIKE 'DEMO-%'`;
const ACTIONABLE = (a: string) =>
  `COALESCE(${a}.body,'') NOT LIKE '[Unsupported message: reaction]%' AND COALESCE(${a}.body,'') NOT LIKE '[Unsupported message: edit]%'`;
const DAY = 86400000;
const fmtDate = (d: Date) => d.toISOString().slice(0, 10);
const startOfUtcDay = (d: Date) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
const addDays = (d: Date, n: number) => new Date(d.getTime() + n * DAY);
const firstOfMonth = (d: Date) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
const addMonths = (d: Date, n: number) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + n, 1));
const endOfMonth = (d: Date) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0));
const safeDate = (value: unknown) => {
  const s = String(value || '').trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s + 'T00:00:00Z')) ? s : null;
};
const periodTs = (date: string, end = false) => `${date} ${end ? '23:59:59' : '00:00:00'}`;
export function analyticsChangePct(current: number, previous: number | null | undefined) {
  if (previous == null || !Number.isFinite(Number(previous)) || Number(previous) <= 0) return null;
  return Math.round(((Number(current) - Number(previous)) / Number(previous)) * 1000) / 10;
}
const changePct = analyticsChangePct;
const n = (value: any) => Number(value || 0);
const errorText = (e: any) => String(e?.sqlMessage || e?.message || e || 'Query failed');

export function budgetBand(input: unknown) {
  const value = Number(String(input ?? '').replace(/[^\d.]/g, ''));
  if (!Number.isFinite(value) || value <= 0) return 'Not specified';
  return value <= 3000 ? '<= $3k' : value <= 5000 ? '$3k-$5k' : value <= 8000 ? '$5k-$8k' : value <= 12000 ? '$8k-$12k' : value <= 20000 ? '$12k-$20k' : '> $20k';
}

export function responseBand(seconds: unknown) {
  if (seconds == null || seconds === '') return 'No paired reply';
  const sec = Number(seconds);
  if (!Number.isFinite(sec) || sec < 0) return 'No paired reply';
  return sec < 60 ? '< 1 min' : sec < 300 ? '1-5 min' : sec < 1800 ? '5-30 min' : sec < 7200 ? '30-120 min' : '> 2 hours';
}

/** Resolve a dashboard range to inclusive date boundaries plus an equal-length comparison window. */
export function resolveAnalyticsPeriod(input: AnalyticsInput = {}, now = new Date()): AnalyticsPeriod {
  const today = startOfUtcDay(now);
  const requested = String(input.range || '30d');
  const allowed: RangeKey[] = ['today', '7d', '30d', 'this_month', 'previous_month', 'this_year', 'all', 'custom'];
  const key: RangeKey = (allowed as string[]).includes(requested) ? requested as RangeKey : '30d';
  let from = addDays(today, -29);
  let to = today;
  let label = 'Last 30 days';
  let comparisonLabel = 'vs previous 30 days';

  if (key === 'today') {
    from = today; to = today; label = 'Today'; comparisonLabel = 'vs yesterday';
  } else if (key === '7d') {
    from = addDays(today, -6); to = today; label = 'Last 7 days'; comparisonLabel = 'vs previous 7 days';
  } else if (key === 'this_month') {
    from = firstOfMonth(today); to = today; label = 'This month'; comparisonLabel = 'vs previous month';
  } else if (key === 'previous_month') {
    from = addMonths(firstOfMonth(today), -1); to = endOfMonth(from); label = 'Previous month'; comparisonLabel = 'vs month before';
  } else if (key === 'this_year') {
    from = new Date(Date.UTC(today.getUTCFullYear(), 0, 1)); to = today; label = 'This year'; comparisonLabel = 'vs same period last year';
  } else if (key === 'all') {
    from = new Date(Date.UTC(1970, 0, 1)); to = today; label = 'All time'; comparisonLabel = 'no comparison';
  } else if (key === 'custom') {
    const f = safeDate(input.from); const t = safeDate(input.to);
    if (f) from = new Date(f + 'T00:00:00Z');
    if (t) to = new Date(t + 'T00:00:00Z');
    if (to < from) { const swap = from; from = to; to = swap; }
    label = `${fmtDate(from)} to ${fmtDate(to)}`; comparisonLabel = 'vs previous equal-length period';
  }

  const fromDate = fmtDate(from), toDate = fmtDate(to);
  const days = key === 'all' ? null : Math.max(1, Math.round((to.getTime() - from.getTime()) / DAY) + 1);
  let previousFrom: string | null = null, previousTo: string | null = null;
  if (key === 'this_year') {
    const py = new Date(Date.UTC(from.getUTCFullYear() - 1, from.getUTCMonth(), from.getUTCDate()));
    const pt = new Date(Date.UTC(to.getUTCFullYear() - 1, to.getUTCMonth(), to.getUTCDate()));
    previousFrom = fmtDate(py); previousTo = fmtDate(pt);
  } else if (key !== 'all') {
    const prevTo = addDays(from, -1);
    const prevFrom = addDays(prevTo, -(Math.max(1, days || 1) - 1));
    previousFrom = fmtDate(prevFrom); previousTo = fmtDate(prevTo);
  }
  return {
    key, label, from: fromDate, to: toDate, fromTs: periodTs(fromDate), toTs: periodTs(toDate, true), days,
    previousFrom, previousTo,
    previousFromTs: previousFrom ? periodTs(previousFrom) : null,
    previousToTs: previousTo ? periodTs(previousTo, true) : null,
    comparisonLabel,
  };
}

function periodFromQuery(input: URLSearchParams | Record<string, any>): AnalyticsInput {
  if (input instanceof URLSearchParams) return { range: input.get('range'), from: input.get('from'), to: input.get('to') };
  return { range: String(input?.range || ''), from: String(input?.from || ''), to: String(input?.to || '') };
}

async function safeRows(sql: string, args: any[] = []): Promise<{ data: any[]; error: string | null }> {
  try { return { data: await rows<any>(sql, args), error: null }; }
  catch (e: any) { console.error('ANALYTICS_QUERY', e?.code || e?.message || e); return { data: [], error: errorText(e) }; }
}
async function safeOne(sql: string, args: any[] = []): Promise<{ data: any | null; error: string | null }> {
  try { return { data: await one<any>(sql, args), error: null }; }
  catch (e: any) { console.error('ANALYTICS_QUERY', e?.code || e?.message || e); return { data: null, error: errorText(e) }; }
}

type Summary = {
  totalVehicles: number; available: number; sold: number; carsAvailable: number; motorcyclesAvailable: number;
  totalCustomers: number; newCustomers: number; inquiries: number; quotes: number; ordersCreated: number;
  completedShipments: number; aiReplies: number; humanReplies: number; customerMessages: number;
};

async function summaryFor(from: string, to: string): Promise<{ data: Summary; error: string | null }> {
  const r = await safeOne(`SELECT
    (SELECT COUNT(*) FROM vehicles v WHERE ${REAL_VEHICLE}) total_vehicles,
    (SELECT COUNT(*) FROM vehicles v WHERE ${REAL_VEHICLE} AND v.status='available') available,
    (SELECT COUNT(*) FROM vehicles v WHERE ${REAL_VEHICLE} AND v.status='sold') sold,
    (SELECT COUNT(*) FROM vehicles v WHERE ${REAL_VEHICLE} AND v.status='available' AND v.category='car') cars_available,
    (SELECT COUNT(*) FROM vehicles v WHERE ${REAL_VEHICLE} AND v.status='available' AND v.category='motorcycle') motorcycles_available,
    (SELECT COUNT(*) FROM customers) total_customers,
    (SELECT COUNT(*) FROM customers WHERE created_at BETWEEN ? AND ?) new_customers,
    (SELECT COUNT(DISTINCT m.conversation_id) FROM messages m WHERE m.sender='customer' AND m.direction='inbound' AND ${ACTIONABLE('m')} AND m.created_at BETWEEN ? AND ?) inquiries,
    (SELECT COUNT(*) FROM quote_requests WHERE created_at BETWEEN ? AND ?) quotes,
    (SELECT COUNT(*) FROM shipments WHERE created_at BETWEEN ? AND ?) orders_created,
    (SELECT COUNT(*) FROM shipments WHERE current_status='completed' AND updated_at BETWEEN ? AND ?) completed_shipments,
    (SELECT COUNT(*) FROM messages WHERE sender='ai' AND direction='outbound' AND created_at BETWEEN ? AND ?) ai_replies,
    (SELECT COUNT(*) FROM messages WHERE sender='human' AND direction='outbound' AND created_at BETWEEN ? AND ?) human_replies,
    (SELECT COUNT(*) FROM messages WHERE sender='customer' AND direction='inbound' AND created_at BETWEEN ? AND ?) customer_messages`,
    [from, to, from, to, from, to, from, to, from, to, from, to, from, to, from, to]);
  const x: any = r.data || {};
  return {
    error: r.error,
    data: {
      totalVehicles: n(x.total_vehicles), available: n(x.available), sold: n(x.sold),
      carsAvailable: n(x.cars_available), motorcyclesAvailable: n(x.motorcycles_available),
      totalCustomers: n(x.total_customers), newCustomers: n(x.new_customers), inquiries: n(x.inquiries),
      quotes: n(x.quotes), ordersCreated: n(x.orders_created), completedShipments: n(x.completed_shipments),
      aiReplies: n(x.ai_replies), humanReplies: n(x.human_replies), customerMessages: n(x.customer_messages),
    },
  };
}

const COLORS = ['#f4b942', '#2f80ed', '#16a085', '#7c5cff', '#e05d5d', '#6b7f93', '#00a3a3', '#b7791f'];
function panel(input: Panel): Panel { return input; }
function bars(title: string, question: string, items: ChartItem[], source: string, method: string, quality: Quality, opts: Partial<Panel> = {}): Panel {
  return panel({ key: opts.key || title.toLowerCase().replace(/[^a-z0-9]+/g, '-'), title, question, kind: 'bars', data: { items }, source, method, quality, ...opts });
}
function donut(title: string, question: string, items: ChartItem[], source: string, method: string, quality: Quality, opts: Partial<Panel> = {}): Panel {
  return panel({ key: opts.key || title.toLowerCase().replace(/[^a-z0-9]+/g, '-'), title, question, kind: 'donut', data: { items }, source, method, quality, ...opts });
}
function seriesPanel(kind: 'line' | 'stacked', title: string, question: string, labels: string[], series: Series[], source: string, method: string, quality: Quality, opts: Partial<Panel> = {}): Panel {
  return panel({ key: opts.key || title.toLowerCase().replace(/[^a-z0-9]+/g, '-'), title, question, kind, data: { labels, series }, source, method, quality, ...opts });
}
function funnel(title: string, question: string, steps: FunnelStep[], source: string, method: string, quality: Quality, opts: Partial<Panel> = {}): Panel {
  return panel({ key: opts.key || title.toLowerCase().replace(/[^a-z0-9]+/g, '-'), title, question, kind: 'funnel', data: { steps }, source, method, quality, ...opts });
}
function tablePanel(title: string, question: string, columns: TableColumn[], rowData: TableRow[], source: string, method: string, quality: Quality, opts: Partial<Panel> = {}): Panel {
  return panel({ key: opts.key || title.toLowerCase().replace(/[^a-z0-9]+/g, '-'), title, question, kind: 'table', data: { columns, rows: rowData }, source, method, quality, ...opts });
}
function statusPanel(title: string, question: string, items: ChartItem[], source: string, method: string, quality: Quality, opts: Partial<Panel> = {}): Panel {
  return panel({ key: opts.key || title.toLowerCase().replace(/[^a-z0-9]+/g, '-'), title, question, kind: 'status', data: { items }, source, method, quality, ...opts });
}

function emptyKpis(period: AnalyticsPeriod, untracked = false): Kpi[] {
  const source = untracked ? 'Database not configured' : 'Existing Sky Cars tables';
  const q: Quality = untracked ? 'untracked' : 'verified';
  return [
    { key: 'total_vehicles', label: 'Total vehicles', value: untracked ? 'Not tracked' : 0, current: true, change: null, quality: q, source, method: 'Current inventory snapshot', href: '/admin/vehicles', tone: 'navy' },
    { key: 'available', label: 'Available vehicles', value: untracked ? 'Not tracked' : 0, current: true, change: null, quality: q, source, method: 'status=available', href: '/admin/vehicles', tone: 'emerald' },
    { key: 'sold', label: 'Vehicles marked Sold', value: untracked ? 'Not tracked' : 0, current: true, change: null, quality: q, source, method: 'status=sold; not a completed sale', href: '/admin/vehicles', tone: 'slate' },
    { key: 'cars_available', label: 'Cars available', value: untracked ? 'Not tracked' : 0, current: true, change: null, quality: q, source, method: 'category=car + status=available', href: '/admin/vehicles?category=car', tone: 'blue' },
    { key: 'motos_available', label: 'Motorcycles available', value: untracked ? 'Not tracked' : 0, current: true, change: null, quality: q, source, method: 'category=motorcycle + status=available', href: '/admin/vehicles?category=motorcycle', tone: 'gold' },
    { key: 'total_customers', label: 'Total customers', value: untracked ? 'Not tracked' : 0, current: true, change: null, quality: q, source, method: 'customers table', href: '/admin/customers', tone: 'navy' },
    { key: 'new_customers', label: 'New customers', value: untracked ? 'Not tracked' : 0, change: null, quality: q, source, method: `created_at in ${period.label}`, href: '/admin/customers', tone: 'blue' },
    { key: 'inquiries', label: 'Customer inquiries', value: untracked ? 'Not tracked' : 0, change: null, quality: q, source, method: 'distinct conversations with actionable inbound messages', href: '/admin/whatsapp', tone: 'gold' },
    { key: 'serious', label: 'Serious buying inquiries', value: untracked ? 'Not tracked' : 0, change: null, quality: q, source, method: 'staff_tasks request_type=serious_buyer', href: '/admin/staff-tasks', tone: 'emerald' },
    { key: 'quotes', label: 'Quote requests', value: untracked ? 'Not tracked' : 0, change: null, quality: q, source, method: 'quote_requests.created_at', href: '/admin/quotes', tone: 'gold' },
    { key: 'orders', label: 'Completed shipments / orders', value: untracked ? 'Not tracked' : 0, change: null, quality: q, source, method: 'shipments.current_status=completed; recorded fulfilment, not payment proof', href: '/admin/shipments', tone: 'emerald' },
    { key: 'revenue', label: 'Verified sales revenue', value: 'Not tracked', change: null, quality: 'untracked', source: 'No payments table', method: 'Not inferred from Sold inventory', tone: 'slate' },
    { key: 'gross_profit', label: 'Verified gross profit', value: 'Not tracked', change: null, quality: 'untracked', source: 'No cost or payment table', method: 'Not inferred', tone: 'slate' },
    { key: 'ai_replies', label: 'AI replies', value: untracked ? 'Not tracked' : 0, change: null, quality: q, source, method: 'messages.sender=ai + outbound', href: '/admin/agent-health', tone: 'emerald' },
    { key: 'human_replies', label: 'Human staff replies', value: untracked ? 'Not tracked' : 0, change: null, quality: q, source, method: 'messages.sender=human + outbound', href: '/admin/whatsapp', tone: 'blue' },
    { key: 'unanswered', label: 'Unanswered actionable chats', value: untracked ? 'Not tracked' : 0, current: true, change: null, quality: q, source, method: 'latest actionable inbound > latest outbound', href: '/admin/whatsapp?filter=waiting', tone: 'red' },
  ];
}

function buildDateSeries(rowsIn: any[], mode: 'day' | 'month' = 'day', max = 14) {
  const labels: string[] = [];
  const map = new Map<string, any>();
  for (const r of rowsIn || []) {
    const label = String(r.day || r.month || r.label || '');
    if (!label) continue;
    if (!map.has(label)) { map.set(label, {}); labels.push(label); }
    map.set(label, { ...map.get(label), ...r });
  }
  return { labels: labels.slice(-max), map };
}

const DEFINITIONS: Definition[] = [
  { metric: 'Inventory snapshot KPIs', source: 'vehicles', period: 'Current state', method: 'COUNT(*) by status/category; demo/test listings excluded', quality: 'verified', limitation: 'Current state, not period activity.' },
  { metric: 'Sold count', source: 'vehicles.status', period: 'Current state', method: 'status="sold"', quality: 'verified', limitation: 'Sold is an inventory status, not proof of a paid sale.' },
  { metric: 'New customers', source: 'customers.created_at', period: 'Selected period', method: 'COUNT(*) between inclusive dates; compared with equal-length prior period', quality: 'verified', limitation: 'A customer is counted once by the customer record date.' },
  { metric: 'Customer inquiries', source: 'messages', period: 'Selected period', method: 'COUNT(DISTINCT conversation_id) where sender=customer, direction=inbound and actionable', quality: 'verified', limitation: 'Reaction/edit placeholders are excluded; one conversation counts once.' },
  { metric: 'AI / human replies', source: 'messages', period: 'Selected period', method: 'COUNT(*) sender=ai/human and direction=outbound', quality: 'verified', limitation: 'Counts stored messages; a failed delivery is still a reply attempt unless delivery_status says otherwise.' },
  { metric: 'Serious buying inquiries', source: 'staff_tasks request_type=serious_buyer', period: 'Selected period', method: 'COUNT(*) created_at in period', quality: 'heuristic', limitation: 'Creates only from detected buying signals; not every serious buyer says a trigger phrase.' },
  { metric: 'Quote requests', source: 'quote_requests.created_at', period: 'Selected period', method: 'COUNT(*)', quality: 'verified', limitation: 'A request is not a confirmed order.' },
  { metric: 'Completed shipments / orders', source: 'shipments', period: 'Selected period', method: 'current_status=completed, updated_at in period', quality: 'verified', limitation: 'Recorded fulfilment status, not a payment or revenue record.' },
  { metric: 'Verified sales revenue / gross profit', source: 'No source table', period: 'N/A', method: 'Not tracked', quality: 'untracked', limitation: 'Never inferred from Sold inventory or vehicle prices.' },
  { metric: 'Monthly / daily activity', source: 'customers, messages, quote_requests, shipments', period: 'Selected period, bucketed by day or month', method: 'Server-side GROUP BY; distinct conversations for inquiries', quality: 'verified', limitation: 'Empty buckets are shown as zero; timezone follows database/server time.' },
  { metric: 'Inventory by price / year', source: 'vehicles', period: 'Current Available inventory', method: 'GROUP BY price band and model_year; NULL price shown as Not priced', quality: 'verified', limitation: 'Listed USD price, not a landed cost.' },
  { metric: 'Top brands / models / stock', source: 'vehicles + conversation_vehicle_events + quote_requests', period: 'Selected period', method: 'Distinct conversations per vehicle; demand evidence from current-vehicle events and quotes', quality: 'inferred', limitation: 'Only vehicles that were attached to a conversation/quote are counted; free-text mentions without a stored vehicle link are not.' },
  { metric: 'Customer budget demand', source: 'customer_facts budget_max', period: 'Selected period', method: 'Count active facts updated in period, grouped into USD bands', quality: 'verified', limitation: 'Only explicitly extracted budgets; no budget is invented.' },
  { metric: 'Customer language', source: 'customers.preferred_language', period: 'Current customer snapshot', method: 'GROUP BY normalized preference; blank = Unknown', quality: 'inferred', limitation: 'Preferred language can be unset for older customers.' },
  { metric: 'Channels', source: 'conversations.channel', period: 'Last message in selected period', method: 'COUNT(*) by whatsapp/facebook/website', quality: 'verified', limitation: 'A conversation is assigned to its stored channel.' },
  { metric: 'Response-time performance', source: 'messages', period: 'Selected period', method: 'Pair each actionable inbound with the first later ai/human outbound in the same conversation', quality: 'heuristic', limitation: 'Does not prove the reply answered that exact question; unpaired messages show as no reply.' },
  { metric: 'Sales inquiry funnel', source: 'messages, leads, staff_tasks, quote_requests, shipments', period: 'Selected period', method: 'Distinct inquiry conversations → qualified lead/serious task → quote → shipment record → completed shipment', quality: 'inferred', limitation: 'Stages are different records; they are not a person-level conversion join.' },
  { metric: 'Shipping destination demand', source: 'quote_requests + customer_facts.destination_country', period: 'Selected period', method: 'Count quote destinations and remembered customer destinations separately', quality: 'inferred', limitation: 'Only stored destinations; free-text destinations without extraction are not counted.' },
  { metric: 'Freight workload', source: 'staff_tasks + quote_requests.shipping_method', period: 'Selected period', method: 'Task types/statuses and shipping-method counts', quality: 'verified', limitation: 'Task counts show workload, not revenue.' },
  { metric: 'Photo completeness', source: 'vehicles + vehicle_media', period: 'Current Available inventory', method: 'COUNT exact approved photos per vehicle; buckets 0 / 1-4 / 5+', quality: 'verified', limitation: 'Representative and demo images are not counted as exact stock photos.' },
  { metric: 'Photo request fulfilment', source: 'staff_tasks + ai_agent_events', period: 'Selected period', method: 'Task statuses plus photo-related agent events', quality: 'heuristic', limitation: 'Event names describe the workflow; a delivered attempt is not a customer acknowledgement.' },
  { metric: 'Staff task performance', source: 'staff_tasks', period: 'All stored tasks', method: 'GROUP BY request_type and status', quality: 'verified', limitation: 'No SLA target is assumed.' },
  { metric: 'AI learning progress', source: 'ai_learning_events', period: 'All stored lessons', method: 'Status counts, expired/undone counts; contradictions from approved/applied lesson text', quality: 'verified', limitation: 'Contradictions are a similarity warning, not an automatic correctness decision.' },
  { metric: 'AI failure categories', source: 'ai_agent_events + ai_learning_events', period: 'Selected period for events; all-time learning counts', method: 'Failed event types and correction types', quality: 'heuristic', limitation: 'Failure taxonomy follows stored event names; unlogged failures are invisible.' },
  { metric: 'System operations', source: 'schema-health + ai_agent_events + conversation_state', period: 'Current state', method: 'Schema verification, last webhook, queue count and last failed AI event', quality: 'verified', limitation: 'Configuration presence is not the same as an external integration test.' },
];

const PANEL_BLUEPRINT: Array<Pick<Panel, 'key' | 'title' | 'question' | 'kind' | 'span' | 'source' | 'method'>> = [
  { key: 'activity', title: 'Monthly business activity', question: 'How are customers, inquiries, quotes and shipment records moving?', kind: 'line', span: 2, source: 'customers, messages, quote_requests, shipments', method: 'Server-side period aggregation' },
  { key: 'inventory-status', title: 'Inventory status', question: 'Where is the current stock?', kind: 'donut', source: 'vehicles.status', method: 'Current snapshot' },
  { key: 'category', title: 'Cars vs motorcycles', question: 'Which category carries the current inventory?', kind: 'stacked', source: 'vehicles.category + vehicles.status', method: 'Current snapshot split by status' },
  { key: 'brands', title: 'Top vehicle brands', question: 'Which brands are strongest in stock and demand?', kind: 'bars', source: 'vehicles + conversation_vehicle_events', method: 'Stock and stored demand events' },
  { key: 'models', title: 'Top requested models', question: 'Which models are customers actually discussing?', kind: 'table', span: 2, source: 'conversation_vehicle_events + quote_requests', method: 'Distinct conversations per vehicle' },
  { key: 'stock-demand', title: 'Most requested stock numbers', question: 'Which exact units are attracting the most conversations?', kind: 'table', source: 'conversation_vehicle_events + quote_requests', method: 'Distinct conversations per exact vehicle' },
  { key: 'price-bands', title: 'Available inventory by price band', question: 'How is the sellable catalogue distributed by listed price?', kind: 'bars', source: 'vehicles.price_usd', method: 'Current Available inventory' },
  { key: 'years', title: 'Available inventory by model year', question: 'How old is the current sellable stock?', kind: 'bars', source: 'vehicles.model_year', method: 'Current Available inventory' },
  { key: 'budget', title: 'Customer budget demand', question: 'What budgets have customers explicitly stated?', kind: 'bars', source: 'customer_facts.budget_max', method: 'Active facts in selected period' },
  { key: 'languages', title: 'Customer language mix', question: 'Which languages are represented in the customer base?', kind: 'donut', source: 'customers.preferred_language', method: 'Current customer snapshot' },
  { key: 'channels', title: 'Communication channels', question: 'Which channels are carrying conversations?', kind: 'donut', source: 'conversations.channel', method: 'Last message in selected period' },
  { key: 'daily-messages', title: 'Daily message activity', question: 'When are customers and the team most active?', kind: 'line', span: 2, source: 'messages', method: 'Daily counts by sender' },
  { key: 'reply-mix', title: 'AI versus human replies', question: 'Who is doing the customer-facing work?', kind: 'donut', source: 'messages', method: 'Sender totals in selected period' },
  { key: 'modes', title: 'Takeover modes', question: 'How many chats are currently AI, human or both?', kind: 'donut', source: 'conversations.mode', method: 'Current conversation snapshot' },
  { key: 'takeover-events', title: 'Recorded takeover events', question: 'When did staff explicitly take over a conversation?', kind: 'bars', source: 'conversations.takeover_at', method: 'Takeover timestamp in selected period' },
  { key: 'response', title: 'Response-time distribution', question: 'How quickly are actionable customer messages answered?', kind: 'bars', source: 'messages', method: 'Heuristic inbound/outbound pairing' },
  { key: 'funnel', title: 'Sales inquiry funnel', question: 'Where do inquiry records stop progressing?', kind: 'funnel', span: 2, source: 'messages + leads + staff_tasks + quote_requests + shipments', method: 'Stored stages; not a person-level join' },
  { key: 'destinations', title: 'Shipping destination demand', question: 'Which destinations are customers asking about?', kind: 'table', span: 2, source: 'quote_requests + customer_facts.destination_country', method: 'Stored destinations and remembered facts' },
  { key: 'freight-workload', title: 'Freight and sourcing workload', question: 'What human work is waiting?', kind: 'bars', source: 'staff_tasks', method: 'Open tasks by request type' },
  { key: 'shipping-methods', title: 'Quote shipping methods', question: 'Which shipping methods are customers requesting?', kind: 'bars', source: 'quote_requests.shipping_method', method: 'Selected period' },
  { key: 'photo-completeness', title: 'Photo completeness', question: 'How many Available vehicles have useful exact photos?', kind: 'donut', source: 'vehicles + vehicle_media', method: 'Exact approved stock photos only' },
  { key: 'photo-events', title: 'Photo request fulfilment', question: 'What happened to photo requests?', kind: 'bars', source: 'ai_agent_events', method: 'Photo-related event names/status' },
  { key: 'task-performance', title: 'Staff task performance', question: 'Which tasks are pending, in progress, done or declined?', kind: 'stacked', span: 2, source: 'staff_tasks', method: 'Grouped by request type and status' },
  { key: 'learning', title: 'AI learning progress', question: 'How much supervised learning is waiting or active?', kind: 'bars', source: 'ai_learning_events', method: 'Status counts and contradiction warnings' },
  { key: 'failures', title: 'AI failure categories', question: 'Which AI problems are being recorded?', kind: 'bars', source: 'ai_agent_events.status=failed', method: 'Failed event types' },
  { key: 'system', title: 'System operations', question: 'Are the reporting foundations healthy?', kind: 'status', span: 2, source: 'schema-health + ai_agent_events + conversation_state', method: 'Current diagnostics' },
  { key: 'priorities', title: 'Business action priorities', question: 'What should the team do next?', kind: 'table', span: 2, source: 'operational queues', method: 'Ranked open work' },
];

const TABLE_BLUEPRINT: Array<Pick<ReportTable, 'key' | 'title' | 'description' | 'columns' | 'source'>> = [
  { key: 'inventory-no-photo', title: 'Inventory needing photographs', description: 'Available vehicles with no exact approved stock photo.', source: 'vehicles + vehicle_media', columns: [{ key: 'stock_no', label: 'Stock' }, { key: 'brand', label: 'Brand' }, { key: 'model', label: 'Model' }, { key: 'model_year', label: 'Year' }, { key: 'updated_at', label: 'Updated' }] },
  { key: 'inventory-missing-info', title: 'Vehicles missing important information', description: 'Available vehicles with a missing price, year, brand/model or core specification.', source: 'vehicles', columns: [{ key: 'stock_no', label: 'Stock' }, { key: 'price_usd', label: 'Price' }, { key: 'mileage_km', label: 'Mileage' }, { key: 'fuel_type', label: 'Fuel' }] },
  { key: 'status-audit', title: 'Recent inventory updates', description: 'Audited vehicle updates when available; otherwise recent vehicle rows by update time.', source: 'audit_logs + vehicles.updated_at', columns: [{ key: 'created_at', label: 'Time' }, { key: 'actor', label: 'Actor' }, { key: 'action', label: 'Action' }, { key: 'entity_id', label: 'Entity' }] },
  { key: 'follow-up', title: 'Customers needing follow-up', description: 'Open conversations with an unanswered actionable customer message.', source: 'conversations + messages', columns: [{ key: 'customer_name', label: 'Customer' }, { key: 'channel', label: 'Channel' }, { key: 'mode', label: 'Mode' }, { key: 'last_message_at', label: 'Last message' }] },
  { key: 'open-shipping', title: 'Open shipping / freight work', description: 'Open freight and sourcing tasks from the staff workflow.', source: 'staff_tasks', columns: [{ key: 'request_type', label: 'Type' }, { key: 'stock_no', label: 'Stock' }, { key: 'reason', label: 'Reason' }, { key: 'priority', label: 'Priority' }] },
  { key: 'open-quotes', title: 'Open quote requests', description: 'New, reviewing or quoted requests that still need a decision.', source: 'quote_requests', columns: [{ key: 'reference', label: 'Reference' }, { key: 'status', label: 'Status' }, { key: 'shipping_method', label: 'Method' }, { key: 'created_at', label: 'Created' }] },
  { key: 'ai-errors', title: 'AI errors requiring review', description: 'Recent failed AI events linked to the review screen.', source: 'ai_agent_events', columns: [{ key: 'event_type', label: 'Event' }, { key: 'status', label: 'Status' }, { key: 'created_at', label: 'Time' }] },
  { key: 'staff-tasks', title: 'Staff tasks requiring completion', description: 'Open tasks in priority order.', source: 'staff_tasks', columns: [{ key: 'request_type', label: 'Type' }, { key: 'stock_no', label: 'Stock' }, { key: 'reason', label: 'Reason' }, { key: 'priority', label: 'Priority' }] },
];

function unavailablePanels(reason: string): Panel[] {
  return PANEL_BLUEPRINT.map((p) => ({ ...p, data: { items: [], labels: [], series: [], steps: [], columns: [], rows: [] }, quality: 'unavailable', error: reason }));
}
function unavailableTables(reason: string): ReportTable[] {
  return TABLE_BLUEPRINT.map((t) => ({ ...t, rows: [], quality: 'unavailable', error: reason }));
}

export async function getAnalytics(input: AnalyticsInput = {}): Promise<AnalyticsReport> {
  const period = resolveAnalyticsPeriod(input);
  if (!dbConfigured()) {
    return {
      generatedAt: new Date().toISOString(), databaseConfigured: false, databaseError: 'Database settings are not configured.',
      period, kpis: emptyKpis(period, true), panels: unavailablePanels('Database settings are not configured.'), tables: unavailableTables('Database settings are not configured.'), definitions: DEFINITIONS, alerts: [], alertCount: 0,
    };
  }

  await Promise.all([
    ensureConversationState().catch(() => null), ensureStaffTasksSchema().catch(() => null),
    ensureAiLearningSchema().catch(() => null), ensureCustomerFactsSchema().catch(() => null),
    ensureVehicleEventsSchema().catch(() => null), ensureAgentEvents().catch(() => null),
  ]);
  const prevFrom = period.previousFromTs, prevTo = period.previousToTs;
  const [summary, previous, statusRows, categoryRows, brandRows, demandRows, quoteVehicleRows, budgetRows, languageRows, channelRows, dailyRows, monthlyActivity, takeoverRows, modeRows, responseRows, qualifiedLead, seriousTasks, destinationQuoteRows, destinationFactRows, taskRows, quoteMethodRows, photoRows, photoEventRows, learningRows, failureRows, webhook, lastAi, queue, lastFailure, missingPhotoRows, missingInfoRows, auditRows, waitingQuery, openQuoteRows, openTaskRows, pendingLearningRows, previousSerious, schemaCheck] = await Promise.all([
    summaryFor(period.fromTs, period.toTs),
    prevFrom && prevTo ? summaryFor(prevFrom, prevTo) : Promise.resolve({ data: null, error: null } as any),
    safeRows(`SELECT status label, COUNT(*) n FROM vehicles v WHERE ${REAL_VEHICLE} GROUP BY status ORDER BY n DESC`),
    safeRows(`SELECT category label, SUM(status='available') available, SUM(status='sold') sold, COUNT(*) total FROM vehicles v WHERE ${REAL_VEHICLE} GROUP BY category ORDER BY total DESC`),
    safeRows(`SELECT v.brand label, COUNT(*) stock, SUM(v.status='available') available, SUM(v.status='sold') sold FROM vehicles v WHERE ${REAL_VEHICLE} AND TRIM(COALESCE(v.brand,''))<>'' GROUP BY v.brand ORDER BY available DESC, stock DESC LIMIT 12`),
    safeRows(`SELECT v.brand, COUNT(DISTINCT e.conversation_id) demand FROM conversation_vehicle_events e JOIN vehicles v ON v.id=e.vehicle_id WHERE e.created_at BETWEEN ? AND ? AND TRIM(COALESCE(v.brand,''))<>'' GROUP BY v.brand ORDER BY demand DESC LIMIT 30`, [period.fromTs, period.toTs]),
    safeRows(`SELECT v.id,v.stock_no,v.brand,v.model,v.model_year,COUNT(DISTINCT e.conversation_id) inquiries,(SELECT COUNT(*) FROM quote_requests q WHERE q.vehicle_id=v.id AND q.created_at BETWEEN ? AND ?) quotes FROM conversation_vehicle_events e JOIN vehicles v ON v.id=e.vehicle_id WHERE e.created_at BETWEEN ? AND ? GROUP BY v.id,v.stock_no,v.brand,v.model,v.model_year ORDER BY inquiries DESC,quotes DESC LIMIT 10`, [period.fromTs, period.toTs, period.fromTs, period.toTs]),
    safeRows(`SELECT fact_value FROM customer_facts WHERE fact_key='budget_max' AND active=1 AND updated_at BETWEEN ? AND ?`, [period.fromTs, period.toTs]),
    safeRows(`SELECT COALESCE(NULLIF(TRIM(preferred_language),''),'Unknown') label, COUNT(*) n FROM customers GROUP BY label ORDER BY n DESC`),
    safeRows(`SELECT channel label, COUNT(*) n FROM conversations WHERE COALESCE(last_message_at,created_at) BETWEEN ? AND ? GROUP BY channel ORDER BY n DESC`, [period.fromTs, period.toTs]),
    safeRows(`SELECT DATE_FORMAT(created_at,'%Y-%m-%d') day, SUM(sender='customer') customer, SUM(sender='ai') ai, SUM(sender='human') human FROM messages WHERE created_at BETWEEN ? AND ? GROUP BY day ORDER BY day`, [period.fromTs, period.toTs]),
    safeRows(`SELECT metric,bucket,SUM(value) value FROM (
      SELECT 'customers' metric,DATE_FORMAT(created_at,'%Y-%m') bucket,COUNT(*) value FROM customers WHERE created_at BETWEEN ? AND ? GROUP BY bucket
      UNION ALL SELECT 'quotes' metric,DATE_FORMAT(created_at,'%Y-%m') bucket,COUNT(*) value FROM quote_requests WHERE created_at BETWEEN ? AND ? GROUP BY bucket
      UNION ALL SELECT 'orders' metric,DATE_FORMAT(created_at,'%Y-%m') bucket,COUNT(*) value FROM shipments WHERE created_at BETWEEN ? AND ? GROUP BY bucket
      UNION ALL SELECT 'inquiries',bucket,value FROM (SELECT DATE_FORMAT(m.created_at,'%Y-%m') bucket,COUNT(DISTINCT m.conversation_id) value FROM messages m WHERE m.sender='customer' AND m.direction='inbound' AND ${ACTIONABLE('m')} AND m.created_at BETWEEN ? AND ? GROUP BY bucket) i
    ) x GROUP BY metric,bucket ORDER BY bucket`, [period.fromTs, period.toTs, period.fromTs, period.toTs, period.fromTs, period.toTs, period.fromTs, period.toTs]),
    safeRows(`SELECT DATE_FORMAT(takeover_at,'%Y-%m-%d') day, COUNT(*) n FROM conversations WHERE takeover_at BETWEEN ? AND ? GROUP BY day ORDER BY day`, [period.fromTs, period.toTs]),
    safeRows(`SELECT COALESCE(mode,'ai') label, COUNT(*) n FROM conversations GROUP BY label ORDER BY n DESC`),
    safeRows(`SELECT TIMESTAMPDIFF(SECOND,m.created_at,(SELECT MIN(o.created_at) FROM messages o WHERE o.conversation_id=m.conversation_id AND o.direction='outbound' AND o.sender IN ('ai','human') AND o.id>m.id)) seconds FROM messages m WHERE m.sender='customer' AND m.direction='inbound' AND ${ACTIONABLE('m')} AND m.created_at BETWEEN ? AND ? ORDER BY m.id DESC LIMIT 5000`, [period.fromTs, period.toTs]),
    safeOne(`SELECT COUNT(*) n FROM leads WHERE status IN ('qualified','converted') AND created_at BETWEEN ? AND ?`, [period.fromTs, period.toTs]),
    safeOne(`SELECT COUNT(*) n FROM staff_tasks WHERE request_type='serious_buyer' AND created_at BETWEEN ? AND ?`, [period.fromTs, period.toTs]),
    safeRows(`SELECT COALESCE(co.name,'Not specified') label, COUNT(*) n FROM quote_requests q LEFT JOIN countries co ON co.id=q.country_id WHERE q.created_at BETWEEN ? AND ? GROUP BY label ORDER BY n DESC LIMIT 10`, [period.fromTs, period.toTs]),
    safeRows(`SELECT COALESCE(NULLIF(TRIM(fact_value),''),'Unknown') label, COUNT(*) n FROM customer_facts WHERE fact_key='destination_country' AND active=1 AND updated_at BETWEEN ? AND ? GROUP BY label ORDER BY n DESC LIMIT 10`, [period.fromTs, period.toTs]),
    safeRows(`SELECT request_type,status,COUNT(*) n FROM staff_tasks GROUP BY request_type,status ORDER BY request_type,status`),
    safeRows(`SELECT COALESCE(NULLIF(TRIM(shipping_method),''),'Not specified') label, COUNT(*) n FROM quote_requests WHERE created_at BETWEEN ? AND ? GROUP BY label ORDER BY n DESC`, [period.fromTs, period.toTs]),
    safeRows(`SELECT CASE WHEN c=0 THEN '0 photos' WHEN c BETWEEN 1 AND 4 THEN '1-4 photos' ELSE '5+ photos' END label, COUNT(*) n FROM (SELECT v.id,COUNT(m.id) c FROM vehicles v LEFT JOIN vehicle_media m ON m.vehicle_id=v.id AND ${exactPhotoSql('m')} WHERE ${REAL_VEHICLE} AND v.status='available' GROUP BY v.id) x GROUP BY label`),
    safeRows(`SELECT event_type,status,COUNT(*) n FROM ai_agent_events WHERE created_at BETWEEN ? AND ? AND (event_type LIKE '%photo%' OR event_type LIKE 'photo%') GROUP BY event_type,status ORDER BY n DESC`, [period.fromTs, period.toTs]),
    safeRows(`SELECT status,COUNT(*) n,SUM(expires_at IS NOT NULL AND expires_at<NOW()) expired,SUM(undone_at IS NOT NULL) undone FROM ai_learning_events GROUP BY status`),
    safeRows(`SELECT event_type,MAX(created_at) created_at,COUNT(*) n FROM ai_agent_events WHERE status='failed' AND created_at BETWEEN ? AND ? GROUP BY event_type ORDER BY n DESC LIMIT 12`, [period.fromTs, period.toTs]),
    safeOne(`SELECT MAX(created_at) at FROM ai_agent_events WHERE event_type='webhook_received' AND status='ok'`),
    safeOne(`SELECT MAX(created_at) at FROM ai_agent_events WHERE event_type IN ('reply','ai_queued')`),
    safeOne(`SELECT COUNT(*) n FROM conversation_state WHERE pending_ai_reply_at IS NOT NULL`),
    safeOne(`SELECT event_type,created_at FROM ai_agent_events WHERE status='failed' ORDER BY id DESC LIMIT 1`),
    safeRows(`SELECT v.id,v.stock_no,v.brand,v.model,v.model_year,v.updated_at FROM vehicles v WHERE ${REAL_VEHICLE} AND v.status='available' AND NOT EXISTS(SELECT 1 FROM vehicle_media m WHERE m.vehicle_id=v.id AND ${exactPhotoSql('m')}) ORDER BY v.updated_at DESC LIMIT 15`),
    safeRows(`SELECT v.id,v.stock_no,v.brand,v.model,v.model_year,v.price_usd,v.mileage_km,v.fuel_type,v.transmission,v.color FROM vehicles v WHERE ${REAL_VEHICLE} AND v.status='available' AND (v.price_usd IS NULL OR v.price_usd<=0 OR v.model_year IS NULL OR TRIM(COALESCE(v.brand,''))='' OR TRIM(COALESCE(v.model,''))='' OR v.mileage_km IS NULL OR v.fuel_type IS NULL OR v.transmission IS NULL) ORDER BY v.updated_at DESC LIMIT 15`),
    safeRows(`SELECT id,actor,action,entity_type,entity_id,details,created_at FROM audit_logs WHERE (action LIKE 'vehicles.%' OR (entity_type='vehicles' AND action IN ('update','create'))) ORDER BY created_at DESC LIMIT 15`),
    safeRows(`SELECT co.id,cu.full_name customer_name,co.channel,co.last_message_at,co.mode FROM conversations co LEFT JOIN customers cu ON cu.id=co.customer_id WHERE COALESCE(co.archived_at,'1970-01-01')='1970-01-01' AND (SELECT COALESCE(MAX(m1.id),0) FROM messages m1 WHERE m1.conversation_id=co.id AND m1.sender='customer' AND m1.direction='inbound' AND ${ACTIONABLE('m1')}) > (SELECT COALESCE(MAX(m2.id),0) FROM messages m2 WHERE m2.conversation_id=co.id AND m2.sender IN ('ai','human') AND m2.direction='outbound') ORDER BY co.last_message_at ASC LIMIT 12`),
    safeRows(`SELECT reference,status,shipping_method,quoted_total_usd,created_at FROM quote_requests WHERE status IN ('new','reviewing','quoted') ORDER BY created_at ASC LIMIT 15`),
    safeRows(`SELECT id,request_type,status,priority,stock_no,reason,created_at FROM staff_tasks WHERE status IN ('pending','in_progress') ORDER BY priority ASC,created_at ASC LIMIT 15`),
    safeRows(`SELECT id,event_type,status,lesson,created_at FROM ai_learning_events WHERE status='pending' ORDER BY created_at ASC LIMIT 10`),
    prevFrom && prevTo ? safeOne(`SELECT COUNT(*) n FROM staff_tasks WHERE request_type='serious_buyer' AND created_at BETWEEN ? AND ?`, [prevFrom, prevTo]) : Promise.resolve({ data: null, error: null } as any),
    verifyCriticalSchemas().catch(() => null),
  ]);

  const s: Summary = summary.data;
  const prev: Summary | null = previous.data;
  const unansweredQuery = await safeOne(`SELECT COUNT(*) n FROM conversations co WHERE COALESCE(co.archived_at,'1970-01-01')='1970-01-01' AND (SELECT COALESCE(MAX(m1.id),0) FROM messages m1 WHERE m1.conversation_id=co.id AND m1.sender='customer' AND m1.direction='inbound' AND ${ACTIONABLE('m1')}) > (SELECT COALESCE(MAX(m2.id),0) FROM messages m2 WHERE m2.conversation_id=co.id AND m2.sender IN ('ai','human') AND m2.direction='outbound')`);
  const sq: Quality = summary.error ? 'unavailable' : 'verified';
  const sv = (value: any) => summary.error ? 'Not tracked' : value;
  const kpis: Kpi[] = [
    { key: 'total_vehicles', label: 'Total vehicles', value: sv(s.totalVehicles), current: true, change: null, quality: sq, source: 'vehicles', method: 'Current snapshot; demo/test listings excluded', href: '/admin/vehicles', tone: 'navy' },
    { key: 'available', label: 'Available vehicles', value: sv(s.available), current: true, change: null, quality: sq, source: 'vehicles.status', method: 'status=available', href: '/admin/vehicles', tone: 'emerald' },
    { key: 'sold', label: 'Vehicles marked Sold', value: sv(s.sold), current: true, change: null, quality: sq, source: 'vehicles.status', method: 'status=sold; not a completed sale', href: '/admin/vehicles', tone: 'slate' },
    { key: 'cars_available', label: 'Cars available', value: sv(s.carsAvailable), current: true, change: null, quality: sq, source: 'vehicles', method: 'category=car + status=available', href: '/admin/vehicles?category=car', tone: 'blue' },
    { key: 'motos_available', label: 'Motorcycles available', value: sv(s.motorcyclesAvailable), current: true, change: null, quality: sq, source: 'vehicles', method: 'category=motorcycle + status=available', href: '/admin/vehicles?category=motorcycle', tone: 'gold' },
    { key: 'total_customers', label: 'Total customers', value: sv(s.totalCustomers), current: true, change: null, quality: sq, source: 'customers', method: 'Current snapshot', href: '/admin/customers', tone: 'navy' },
    { key: 'new_customers', label: 'New customers', value: sv(s.newCustomers), change: changePct(s.newCustomers, prev?.newCustomers), quality: sq, source: 'customers.created_at', method: period.comparisonLabel, href: '/admin/customers', tone: 'blue' },
    { key: 'inquiries', label: 'Customer inquiries', value: sv(s.inquiries), change: changePct(s.inquiries, prev?.inquiries), quality: sq, source: 'messages', method: 'Distinct actionable inbound conversations', href: '/admin/whatsapp', tone: 'gold' },
    { key: 'serious', label: 'Serious buying inquiries', value: seriousTasks.error ? 'Not tracked' : n(seriousTasks.data?.n), change: seriousTasks.error ? null : changePct(n(seriousTasks.data?.n), n(previousSerious.data?.n)), quality: seriousTasks.error ? 'unavailable' : 'heuristic', source: 'staff_tasks serious_buyer', method: 'Detected buying-signal tasks', href: '/admin/staff-tasks', tone: 'emerald' },
    { key: 'quotes', label: 'Quote requests', value: sv(s.quotes), change: changePct(s.quotes, prev?.quotes), quality: sq, source: 'quote_requests.created_at', method: period.comparisonLabel, href: '/admin/quotes', tone: 'gold' },
    { key: 'orders', label: 'Completed shipments / orders', value: sv(s.completedShipments), change: changePct(s.completedShipments, prev?.completedShipments), quality: sq, source: 'shipments', method: 'Completed fulfilment records; not payment proof', href: '/admin/shipments', tone: 'emerald' },
    { key: 'revenue', label: 'Verified sales revenue', value: 'Not tracked', change: null, quality: 'untracked', source: 'No payments table', method: 'Never inferred from Sold inventory', tone: 'slate' },
    { key: 'gross_profit', label: 'Verified gross profit', value: 'Not tracked', change: null, quality: 'untracked', source: 'No cost/payment table', method: 'Not inferred', tone: 'slate' },
    { key: 'ai_replies', label: 'AI replies', value: sv(s.aiReplies), change: changePct(s.aiReplies, prev?.aiReplies), quality: sq, source: 'messages.sender=ai', method: period.comparisonLabel, href: '/admin/agent-health', tone: 'emerald' },
    { key: 'human_replies', label: 'Human staff replies', value: sv(s.humanReplies), change: changePct(s.humanReplies, prev?.humanReplies), quality: sq, source: 'messages.sender=human', method: period.comparisonLabel, href: '/admin/whatsapp', tone: 'blue' },
    { key: 'unanswered', label: 'Unanswered actionable chats', value: unansweredQuery.error ? 'Not tracked' : n(unansweredQuery.data?.n), current: true, change: null, quality: unansweredQuery.error ? 'unavailable' : 'verified', source: 'messages + conversations', method: 'Latest actionable inbound > latest outbound', href: '/admin/whatsapp?filter=waiting', tone: 'red' },
  ];

  const statusItems: ChartItem[] = (statusRows.data || []).map((r: any, i: number) => ({ label: String(r.label || 'Unknown'), value: n(r.n), color: COLORS[i % COLORS.length], title: `${r.label}: ${n(r.n)}` }));
  const categoryLabels = (categoryRows.data || []).map((r: any) => String(r.label || 'other'));
  const categorySeries: Series[] = [
    { name: 'Available', color: '#16a085', values: (categoryRows.data || []).map((r: any) => n(r.available)) },
    { name: 'Sold', color: '#6b7f93', values: (categoryRows.data || []).map((r: any) => n(r.sold)) },
    { name: 'Other status', color: '#2f80ed', values: (categoryRows.data || []).map((r: any) => Math.max(0, n(r.total) - n(r.available) - n(r.sold))) },
  ];
  const demandMap = new Map((demandRows.data || []).map((r: any) => [String(r.brand || ''), n(r.demand)]));
  const brandItems = (brandRows.data || []).map((r: any) => ({ label: String(r.label || 'Unknown'), value: n(r.available), demand: demandMap.get(String(r.label || '')) || 0, href: '/admin/vehicles?brand=' + encodeURIComponent(String(r.label || '')), title: `${r.label}: ${n(r.available)} available, ${demandMap.get(String(r.label || '')) || 0} demand events` }));
  const priceBands = new Map<string, number>();
  const priceRows = await safeRows(`SELECT CASE WHEN price_usd IS NULL OR price_usd<=0 THEN 'Not priced' WHEN price_usd<3000 THEN '< $3k' WHEN price_usd<5000 THEN '$3k-$5k' WHEN price_usd<8000 THEN '$5k-$8k' WHEN price_usd<12000 THEN '$8k-$12k' ELSE '$12k+' END label,COUNT(*) n FROM vehicles v WHERE ${REAL_VEHICLE} AND v.status='available' GROUP BY label`);
  for (const r of priceRows.data || []) priceBands.set(String(r.label), n(r.n));
  const yearRows = await safeRows(`SELECT model_year label,COUNT(*) n FROM vehicles v WHERE ${REAL_VEHICLE} AND v.status='available' AND model_year IS NOT NULL GROUP BY model_year ORDER BY model_year DESC LIMIT 15`);
  const budgetBuckets = new Map<string, number>([['<= $3k', 0], ['$3k-$5k', 0], ['$5k-$8k', 0], ['$8k-$12k', 0], ['$12k-$20k', 0], ['> $20k', 0]]);
  for (const r of budgetRows.data || []) {
    const label = budgetBand(r.fact_value);
    budgetBuckets.set(label, (budgetBuckets.get(label) || 0) + 1);
  }
  const languageItems = (languageRows.data || []).map((r: any, i: number) => ({ label: String(r.label || 'Unknown'), value: n(r.n), color: COLORS[i % COLORS.length] }));
  const channelItems = (channelRows.data || []).map((r: any, i: number) => ({ label: String(r.label || 'Unknown'), value: n(r.n), color: COLORS[i % COLORS.length] }));
  const daily = buildDateSeries(dailyRows.data || [], 'day', 31);
  const monthlyLabels = [...new Set((monthlyActivity.data || []).map((r: any) => String(r.bucket || '')))].filter(Boolean).sort().slice(-12);
  const monthlyMap = new Map((monthlyActivity.data || []).map((r: any) => [`${r.metric}|${r.bucket}`, n(r.value)]));
  const monthlyValue = (metric: string, label: string) => monthlyMap.get(`${metric}|${label}`) || 0;
  const monthlySeries: Series[] = [
    { name: 'New customers', color: '#2f80ed', values: monthlyLabels.map((l) => monthlyValue('customers', l)) },
    { name: 'Inquiry conversations', color: '#f4b942', values: monthlyLabels.map((l) => monthlyValue('inquiries', l)) },
    { name: 'Quote requests', color: '#7c5cff', values: monthlyLabels.map((l) => monthlyValue('quotes', l)) },
    { name: 'Shipment records', color: '#16a085', values: monthlyLabels.map((l) => monthlyValue('orders', l)) },
  ];
  const takeover = buildDateSeries(takeoverRows.data || [], 'day', 31);
  const modeItems = (modeRows.data || []).map((r: any, i: number) => ({ label: String(r.label || 'Unknown'), value: n(r.n), color: COLORS[i % COLORS.length] }));
  const responseSeconds = (responseRows.data || []).map((r: any) => Number(r.seconds)).filter((x: number) => Number.isFinite(x) && x >= 0).sort((a: number, b: number) => a - b);
  const responseCounts = new Map<string, number>([['< 1 min', 0], ['1-5 min', 0], ['5-30 min', 0], ['30-120 min', 0], ['> 2 hours', 0]]);
  for (const sec of responseSeconds) responseCounts.set(responseBand(sec), (responseCounts.get(responseBand(sec)) || 0) + 1);
  const responseNoReply = (responseRows.data || []).filter((r: any) => r.seconds == null).length;
  const percentiles = (arr: number[], p: number) => arr.length ? arr[Math.min(arr.length - 1, Math.floor((arr.length - 1) * p))] : null;
  const median = percentiles(responseSeconds, 0.5), p90 = percentiles(responseSeconds, 0.9);
  const funnelInquiry = s.inquiries;
  const qualified = Math.max(n(qualifiedLead.data?.n), n(seriousTasks.data?.n));
  const funnelSteps: FunnelStep[] = [
    { label: 'Inquiries', value: funnelInquiry, note: 'Distinct conversations with actionable customer messages' },
    { label: 'Qualified / serious', value: qualified, note: 'Qualified leads or detected serious-buyer tasks' },
    { label: 'Quotes', value: s.quotes, note: 'Quote requests created in period' },
    { label: 'Orders / shipments', value: s.ordersCreated, note: 'Shipment records created in period' },
    { label: 'Completed fulfilment', value: s.completedShipments, note: 'Shipments marked completed; not payment proof' },
  ];
  const destinationQuoteItems = (destinationQuoteRows.data || []).map((r: any) => ({ label: String(r.label || 'Unknown'), value: n(r.n) }));
  const destinationFactItems = (destinationFactRows.data || []).map((r: any) => ({ label: String(r.label || 'Unknown'), value: n(r.n) }));
  const taskMap = new Map<string, Record<string, number>>();
  for (const r of taskRows.data || []) {
    const type = String(r.request_type || 'other');
    if (!taskMap.has(type)) taskMap.set(type, {});
    taskMap.get(type)![String(r.status || 'unknown')] = n(r.n);
  }
  const taskStatuses = ['pending', 'in_progress', 'done', 'declined'];
  const taskSeries: Series[] = taskStatuses.map((status, i) => ({ name: status.replace(/_/g, ' '), color: COLORS[i], values: [...taskMap.keys()].map((type) => taskMap.get(type)?.[status] || 0) }));
  const quoteMethodItems = (quoteMethodRows.data || []).map((r: any, i: number) => ({ label: String(r.label || 'Unknown'), value: n(r.n), color: COLORS[i % COLORS.length] }));
  const photoItems = (photoRows.data || []).map((r: any, i: number) => ({ label: String(r.label || 'Unknown'), value: n(r.n), color: COLORS[i % COLORS.length] }));
  const photoEventMap = new Map<string, number>();
  for (const r of photoEventRows.data || []) photoEventMap.set(`${r.event_type} (${r.status})`, n(r.n));
  const learningMap = new Map<string, number>();
  for (const r of learningRows.data || []) learningMap.set(String(r.status || 'unknown'), n(r.n));
  let contradictions: any[] = [];
  if (!learningRows.error) {
    try {
      const lessons = await rows<any>(`SELECT id,event_type,lesson,question FROM ai_learning_events WHERE status IN ('approved','applied') AND COALESCE(lesson,'')<>'' ORDER BY id DESC LIMIT 200`);
      contradictions = detectContradictions(lessons);
    } catch { /* optional */ }
  }
  const failureItems = (failureRows.data || []).map((r: any) => ({ label: String(r.event_type || 'Unknown'), value: n(r.n) }));
  const systemItems: ChartItem[] = [
    { label: 'Schema', value: schemaCheck?.ok ? 1 : 0, title: schemaCheck?.ok ? 'Core schemas present' : 'Schema check needs attention', href: '/api/admin/schema-health' },
    { label: 'Webhook', value: webhook.data?.at ? 1 : 0, title: webhook.data?.at ? `Last webhook: ${webhook.data.at}` : 'No webhook event recorded', href: '/admin/whatsapp-health' },
    { label: 'Last AI activity', value: lastAi.data?.at ? 1 : 0, title: lastAi.data?.at ? `Last AI activity: ${lastAi.data.at}` : 'No AI activity recorded', href: '/admin/agent-health' },
    { label: 'AI queue', value: n(queue.data?.n), title: `${n(queue.data?.n)} pending AI reply(ies)`, href: '/admin/agent-health' },
    { label: 'Last AI error', value: lastFailure.data ? 1 : 0, title: lastFailure.data ? `${lastFailure.data.event_type} at ${lastFailure.data.created_at}` : 'No failed AI event recorded', href: '/admin/agent-health' },
  ];
  const openTasks = (openTaskRows.data || []).map((r: any) => ({ ...r, href: '/admin/staff-tasks' }));
  const pendingLearning = (pendingLearningRows.data || []).map((r: any) => ({ ...r, href: '/admin/ai-learning' }));
  const waitingRows = (waitingQuery.data || []).map((r: any) => ({ ...r, href: '/admin/whatsapp?filter=waiting' }));
  const openQuotes = (openQuoteRows.data || []).map((r: any) => ({ ...r, href: '/admin/quotes' }));
  const missingPhotos = (missingPhotoRows.data || []).map((r: any) => ({ ...r, href: '/admin/photo-check' }));
  const missingInfo = (missingInfoRows.data || []).map((r: any) => ({ ...r, href: '/admin/vehicles' }));
  const recentVehicleRows = await safeRows(`SELECT id,stock_no,brand,model,status,updated_at FROM vehicles v WHERE ${REAL_VEHICLE} ORDER BY updated_at DESC LIMIT 15`);
  const alerts = [
    ...waitingRows.slice(0, 5).map((r: any) => ({ priority: 'P1', need: 'Customer waiting for staff', detail: `${r.customer_name || 'Customer'} · ${r.channel || 'chat'}`, href: r.href })),
    ...openTasks.slice(0, 5).map((r: any) => ({ priority: r.priority <= 2 ? 'P1' : 'P2', need: `${String(r.request_type || 'task').replace(/_/g, ' ')} task open`, detail: r.stock_no || r.reason || 'Staff task', href: '/admin/staff-tasks' })),
    ...openQuotes.slice(0, 5).map((r: any) => ({ priority: 'P2', need: 'Quote awaiting action', detail: r.reference || 'Quote request', href: '/admin/quotes' })),
    ...missingPhotos.slice(0, 5).map((r: any) => ({ priority: 'P3', need: 'Available vehicle has no exact photo', detail: `${r.stock_no || ''} ${r.brand || ''} ${r.model || ''}`.trim() || 'Vehicle', href: '/admin/photo-check' })),
    ...pendingLearning.slice(0, 3).map((r: any) => ({ priority: 'P3', need: 'AI lesson pending review', detail: String(r.event_type || 'learning'), href: '/admin/ai-learning' })),
  ].slice(0, 15);
  const panels: Panel[] = [
    seriesPanel('line', 'Monthly business activity', 'How are customers, inquiries, quotes and shipment records moving?', monthlyLabels, monthlySeries, 'customers + messages + quote_requests + shipments', 'Monthly buckets; inquiries are distinct actionable conversations', 'verified', { span: 2, key: 'activity', note: 'Shipment records are orders in the workflow, not payment proof.' }),
    donut('Inventory status', 'Where is the current stock?', statusItems, 'vehicles.status', 'Current snapshot; demo/test listings excluded', 'verified', { key: 'inventory-status', note: 'Sold is an inventory status, not payment proof.' }),
    seriesPanel('stacked', 'Cars vs motorcycles', 'Which category carries the current inventory?', categoryLabels, categorySeries, 'vehicles.category + vehicles.status', 'Current snapshot split by Available, Sold and other statuses', 'verified', { key: 'category', note: 'Sold is an inventory status, not payment proof.' }),
    bars('Top vehicle brands', 'Which brands are strongest in stock and demand?', brandItems, 'vehicles + conversation_vehicle_events', 'Available stock; demand = distinct conversations attached to a vehicle', 'inferred', { key: 'brands', note: 'Demand is only counted when the vehicle was stored against a conversation.' }),
    tablePanel('Top requested models', 'Which models are customers actually discussing?', [{ key: 'stock_no', label: 'Stock' }, { key: 'model', label: 'Vehicle' }, { key: 'inquiries', label: 'Inquiries', align: 'right' }, { key: 'quotes', label: 'Quotes', align: 'right' }], (quoteVehicleRows.data || []).map((r: any) => ({ ...r, model: [r.model_year, r.brand, r.model].filter(Boolean).join(' '), href: '/admin/all-history?stock=' + encodeURIComponent(String(r.stock_no || '')) })), 'conversation_vehicle_events + quote_requests', 'Distinct conversations; demand evidence stored against a vehicle', 'inferred', { key: 'models', span: 2, note: 'Free-text model mentions without a vehicle link are not counted.' }),
    tablePanel('Most requested stock numbers', 'Which exact units are attracting the most conversations?', [{ key: 'stock_no', label: 'Stock' }, { key: 'brand', label: 'Brand' }, { key: 'inquiries', label: 'Inquiries', align: 'right' }, { key: 'quotes', label: 'Quotes', align: 'right' }], (quoteVehicleRows.data || []).map((r: any) => ({ ...r, href: '/admin/all-history?stock=' + encodeURIComponent(String(r.stock_no || '')) })), 'conversation_vehicle_events + quote_requests', 'Distinct conversation count per exact vehicle', 'inferred', { key: 'stock-demand', note: 'One conversation counts once per vehicle.' }),
    bars('Available inventory by price band', 'How is the sellable catalogue distributed by listed price?', [...priceBands.entries()].map(([label, value]) => ({ label, value, href: '/admin/vehicles?maxPrice=' + (label === '< $3k' ? 3000 : label === '$3k-$5k' ? 5000 : label === '$5k-$8k' ? 8000 : label === '$8k-$12k' ? 12000 : 999999) })), 'vehicles.price_usd', 'Current Available inventory grouped into USD bands', 'verified', { key: 'price-bands', note: 'Listed vehicle price, not landed cost.' }),
    bars('Available inventory by model year', 'How old is the current sellable stock?', (yearRows.data || []).map((r: any) => ({ label: String(r.label), value: n(r.n) })), 'vehicles.model_year', 'Current Available inventory; count by production year', 'verified', { key: 'years' }),
    bars('Customer budget demand', 'What budgets have customers explicitly stated?', [...budgetBuckets.entries()].map(([label, value]) => ({ label, value })), 'customer_facts.budget_max', 'Active facts updated in the selected period', 'verified', { key: 'budget', note: 'Only extracted/explicit budgets; missing budgets are not invented.' }),
    donut('Customer language mix', 'Which languages are represented in the customer base?', languageItems, 'customers.preferred_language', 'Current customer snapshot; blank values are Unknown', 'inferred', { key: 'languages' }),
    donut('Communication channels', 'Which channels are carrying conversations?', channelItems, 'conversations.channel', 'Conversations with last_message_at in the selected period', 'verified', { key: 'channels' }),
    seriesPanel('line', 'Daily message activity', 'When are customers and the team most active?', daily.labels, [
      { name: 'Customer', color: '#2f80ed', values: daily.labels.map((l) => n(daily.map.get(l)?.customer)) },
      { name: 'AI', color: '#16a085', values: daily.labels.map((l) => n(daily.map.get(l)?.ai)) },
      { name: 'Staff', color: '#f4b942', values: daily.labels.map((l) => n(daily.map.get(l)?.human)) },
    ], 'messages', 'Daily counts by sender', 'verified', { span: 2, key: 'daily-messages' }),
    donut('AI versus human replies', 'Who is doing the customer-facing work?', [
      { label: 'AI replies', value: s.aiReplies, color: '#16a085' }, { label: 'Human replies', value: s.humanReplies, color: '#f4b942' },
      { label: 'Customer messages', value: s.customerMessages, color: '#2f80ed' },
    ], 'messages', 'Sender totals in the selected period', 'verified', { key: 'reply-mix' }),
    donut('Takeover modes', 'How many chats are currently AI, human or both?', modeItems, 'conversations.mode', 'Current conversation snapshot', 'verified', { key: 'modes' }),
    bars('Recorded takeover events', 'When did staff explicitly take over a conversation?', takeover.labels.map((l) => ({ label: l, value: n(takeover.map.get(l)?.n) })), 'conversations.takeover_at', 'Takeover timestamp in the selected period', 'verified', { key: 'takeover-events' }),
    bars('Response-time distribution', 'How quickly are actionable customer messages answered?', [...responseCounts.entries()].map(([label, value]) => ({ label, value })), 'messages', 'Heuristic pairing of each inbound with the next AI/human outbound', 'heuristic', { key: 'response', note: `Median ${median == null ? 'Not available' : `${Math.round(median / 60)} min`} · P90 ${p90 == null ? 'Not available' : `${Math.round(p90 / 60)} min`} · ${responseNoReply} actionable message(s) without a paired reply.` }),
    funnel('Sales inquiry funnel', 'Where do inquiry records stop progressing?', funnelSteps, 'messages + leads + staff_tasks + quote_requests + shipments', 'Separate stored stages; not a person-level conversion join', 'inferred', { key: 'funnel', span: 2, note: 'A quote is not a confirmed order; a completed shipment is not proof of revenue.' }),
    tablePanel('Shipping destination demand', 'Which destinations are customers asking about?', [{ key: 'label', label: 'Destination' }, { key: 'quote', label: 'Quote requests', align: 'right' }, { key: 'remembered', label: 'Remembered facts', align: 'right' }], [...new Set([...destinationQuoteItems.map((x) => x.label), ...destinationFactItems.map((x) => x.label)])].map((label) => ({ label, quote: destinationQuoteItems.find((x) => x.label === label)?.value || 0, remembered: destinationFactItems.find((x) => x.label === label)?.value || 0 })), 'quote_requests + customer_facts.destination_country', 'Quote destinations and remembered customer facts shown separately', 'inferred', { key: 'destinations', span: 2, note: 'Only stored destinations; free text without extraction is not counted.' }),
    bars('Freight and sourcing workload', 'What human work is waiting?', [...taskMap.entries()].map(([type, counts]) => ({ label: type.replace(/_/g, ' '), value: (counts.pending || 0) + (counts.in_progress || 0), href: '/admin/staff-tasks' })), 'staff_tasks', 'Open tasks by request type', 'verified', { key: 'freight-workload' }),
    bars('Quote shipping methods', 'Which shipping methods are customers requesting?', quoteMethodItems, 'quote_requests.shipping_method', 'Selected period', 'verified', { key: 'shipping-methods' }),
    donut('Photo completeness', 'How many Available vehicles have useful exact photos?', photoItems, 'vehicles + vehicle_media', 'Exact approved stock photos only; buckets 0 / 1-4 / 5+', 'verified', { key: 'photo-completeness', note: 'Representative/demo images are not counted.' }),
    bars('Photo request fulfilment', 'What happened to photo requests?', [...photoEventMap.entries()].map(([label, value]) => ({ label, value })), 'ai_agent_events', 'Photo-related event names/status in selected period', 'heuristic', { key: 'photo-events' }),
    seriesPanel('stacked', 'Staff task performance', 'Which tasks are pending, in progress, done or declined?', [...taskMap.keys()].map((x) => x.replace(/_/g, ' ')), taskSeries, 'staff_tasks', 'All stored tasks grouped by request type and status', 'verified', { key: 'task-performance', span: 2 }),
    bars('AI learning progress', 'How much supervised learning is waiting or active?', [
      { label: 'Pending', value: learningMap.get('pending') || 0 }, { label: 'Approved', value: learningMap.get('approved') || 0 },
      { label: 'Applied', value: learningMap.get('applied') || 0 }, { label: 'Rejected', value: learningMap.get('rejected') || 0 },
      { label: 'Contradiction pairs', value: contradictions.length },
    ], 'ai_learning_events', 'All stored lessons; contradictions from approved/applied text similarity', 'verified', { key: 'learning', note: 'Contradictions are review warnings, not automatic corrections.' }),
    bars('AI failure categories', 'Which AI problems are being recorded?', failureItems, 'ai_agent_events.status=failed', 'Failed event types in selected period', 'heuristic', { key: 'failures', note: 'Only logged failures are visible.' }),
    statusPanel('System operations', 'Are the reporting foundations healthy?', systemItems, 'schema-health + ai_agent_events + conversation_state', 'Current diagnostics; presence is not an external integration test', 'verified', { key: 'system', span: 2 }),
    tablePanel('Business action priorities', 'What should the team do next?', [{ key: 'priority', label: 'Priority' }, { key: 'need', label: 'Need' }, { key: 'detail', label: 'Detail' }], alerts, 'conversations, staff_tasks, quote_requests, vehicles, ai_learning_events', 'Ranked open work from the operational queues', 'verified', { key: 'priorities', span: 2, note: 'Direct links are provided in the table where the destination supports the filter.' }),
  ];
  const tables: ReportTable[] = [
    { key: 'inventory-no-photo', title: 'Inventory needing photographs', description: 'Available vehicles with no exact approved stock photo.', columns: [{ key: 'stock_no', label: 'Stock' }, { key: 'brand', label: 'Brand' }, { key: 'model', label: 'Model' }, { key: 'model_year', label: 'Year' }, { key: 'updated_at', label: 'Updated' }], rows: missingPhotos, source: 'vehicles + vehicle_media', quality: 'verified' },
    { key: 'inventory-missing-info', title: 'Vehicles missing important information', description: 'Available vehicles with a missing price, year, brand/model or core specification.', columns: [{ key: 'stock_no', label: 'Stock' }, { key: 'brand', label: 'Brand' }, { key: 'model', label: 'Model' }, { key: 'price_usd', label: 'Price' }, { key: 'mileage_km', label: 'Mileage' }, { key: 'fuel_type', label: 'Fuel' }], rows: missingInfo, source: 'vehicles', quality: 'verified' },
    { key: 'status-audit', title: 'Recent inventory updates', description: 'Audited vehicle updates when available; otherwise recent vehicle rows are shown by their update time.', columns: [{ key: 'created_at', label: 'Time' }, { key: 'actor', label: 'Actor' }, { key: 'action', label: 'Action' }, { key: 'entity_id', label: 'Entity' }], rows: (auditRows.data || []).length ? auditRows.data || [] : (recentVehicleRows.data || []).map((r: any) => ({ created_at: r.updated_at, actor: 'inventory row', action: `Last updated · ${r.status}`, entity_id: r.stock_no || r.id })), source: 'audit_logs + vehicles.updated_at', quality: (auditRows.data || []).length ? 'verified' : 'inferred', error: auditRows.error || recentVehicleRows.error },
    { key: 'follow-up', title: 'Customers needing follow-up', description: 'Open conversations whose latest actionable customer message has no later AI/staff reply.', columns: [{ key: 'customer_name', label: 'Customer' }, { key: 'channel', label: 'Channel' }, { key: 'mode', label: 'Mode' }, { key: 'last_message_at', label: 'Last message' }], rows: waitingRows, source: 'conversations + messages', quality: 'verified' },
    { key: 'open-shipping', title: 'Open shipping / freight work', description: 'Open freight and sourcing tasks from the staff workflow.', columns: [{ key: 'request_type', label: 'Type' }, { key: 'stock_no', label: 'Stock' }, { key: 'reason', label: 'Reason' }, { key: 'priority', label: 'Priority' }, { key: 'created_at', label: 'Created' }], rows: openTasks.filter((r: any) => ['freight', 'sourcing'].includes(String(r.request_type))), source: 'staff_tasks', quality: 'verified' },
    { key: 'open-quotes', title: 'Open quote requests', description: 'New, reviewing or quoted requests that still need an owner decision.', columns: [{ key: 'reference', label: 'Reference' }, { key: 'status', label: 'Status' }, { key: 'shipping_method', label: 'Method' }, { key: 'quoted_total_usd', label: 'Total', align: 'right' }, { key: 'created_at', label: 'Created' }], rows: openQuotes, source: 'quote_requests', quality: 'verified' },
    { key: 'ai-errors', title: 'AI errors requiring review', description: 'Recent failed AI events and pending lessons are linked to their review screens.', columns: [{ key: 'event_type', label: 'Event' }, { key: 'status', label: 'Status' }, { key: 'created_at', label: 'Time' }], rows: (failureRows.data || []).map((r: any) => ({ ...r, status: 'failed', href: '/admin/agent-health' })), source: 'ai_agent_events', quality: 'heuristic', error: failureRows.error },
    { key: 'staff-tasks', title: 'Staff tasks requiring completion', description: 'The same open tasks shown in the action list, with priority order.', columns: [{ key: 'request_type', label: 'Type' }, { key: 'stock_no', label: 'Stock' }, { key: 'reason', label: 'Reason' }, { key: 'priority', label: 'Priority' }, { key: 'created_at', label: 'Created' }], rows: openTasks, source: 'staff_tasks', quality: 'verified' },
  ];
  return {
    generatedAt: new Date().toISOString(), databaseConfigured: true, databaseError: null, period, kpis, panels, tables,
    definitions: DEFINITIONS, alerts, alertCount: alerts.length,
  };
}

export function analyticsFromQuery(input: URLSearchParams | Record<string, any>) {
  return getAnalytics(periodFromQuery(input));
}
