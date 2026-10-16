'use client';
import { useCallback, useEffect, useMemo, useState } from 'react';

/*
  GOAL 1 - one stream for the whole business.
  Filters (date, channel, role, type, customer, vehicle/stock, car/motorcycle, Facebook leads only),
  newest/oldest sorting, a new-events button while sorting newest-first, and one TXT export that walks
  the SAME filters server-side (streamed, so a large history downloads safely).
*/
const ROLE_LABEL: Record<string, string> = { customer: 'CUSTOMER', ai: 'AI', human: 'STAFF', staff: 'STAFF', system: 'SYSTEM' };
const KIND_LABEL: Record<string, string> = { message: 'message', system: 'system', referral: 'referral', quote: 'quote', note: 'note', memory: 'memory', learning: 'learning' };
const when = (v: any) => (v ? new Date(String(v).replace(' ', 'T')).toLocaleString() : '-');
/* Privacy: a phone/PSID is shown masked (last four digits) plus the customer id, exactly like the TXT. */
const maskId = (v: any) => { const s = String(v == null ? '' : v).replace(/\s+/g, ''); return s ? `…${s.slice(-4)}` : ''; };
const whoOf = (r: any) => [r.customer_name || null, maskId(r.phone || r.psid) || null, r.customer_id ? `#${r.customer_id}` : null].filter(Boolean).join(' ') || 'unknown';

type Filters = {
  from: string; to: string; channel: string; role: string; kind: string; q: string;
  stock: string; category: string; customer: string; facebook: boolean; order: 'desc' | 'asc';
};
const EMPTY: Filters = { from: '', to: '', channel: '', role: '', kind: '', q: '', stock: '', category: '', customer: '', facebook: false, order: 'desc' };

export default function AllHistoryClient() {
  const [filters, setFilters] = useState<Filters>(EMPTY);
  const [rows, setRows] = useState<any[]>([]);
  const [count, setCount] = useState<number | null>(null);
  const [cursor, setCursor] = useState<{ ts: string; id: string } | null>(null);
  const [exhausted, setExhausted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [diag, setDiag] = useState<any>(null);
  const [showDiag, setShowDiag] = useState(false);

  const qs = useCallback((f: Filters, extra: Record<string, string> = {}) => {
    const p = new URLSearchParams(extra);
    if (f.from) p.set('from', f.from);
    if (f.to) p.set('to', f.to);
    if (f.channel) p.set('channel', f.channel);
    if (f.role) p.set('role', f.role);
    if (f.kind) p.set('kind', f.kind);
    if (f.q) p.set('q', f.q);
    if (f.stock) p.set('stock', f.stock);
    if (f.category) p.set('category', f.category);
    if (f.customer) p.set('customer', f.customer);
    if (f.facebook) p.set('facebook', '1');
    if (f.order === 'asc') p.set('order', 'asc');
    return p.toString();
  }, []);

  const load = useCallback(async (f: Filters, more = false) => {
    setBusy(true); setMsg('');
    const extra: Record<string, string> = { limit: '100' };
    if (more && cursor) { extra.cursor_ts = cursor.ts; extra.cursor_id = cursor.id; }
    const r = await fetch('/api/admin/all-history?' + qs(f, extra), { cache: 'no-store' });
    const j = await r.json().catch(() => ({}));
    setBusy(false);
    if (!r.ok) { setMsg(j.error || 'Could not load history'); if (j.hint) setMsg(j.error + ' ' + j.hint); return; }
    setRows((prev) => (more ? [...prev, ...(j.rows || [])] : (j.rows || [])));
    setCursor(j.nextCursor || null);
    setExhausted(!!j.exhausted);
    if (typeof j.count === 'number') setCount(j.count);
  }, [qs, cursor]);

  useEffect(() => { setCursor(null); void load(filters, false); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [filters.from, filters.to, filters.channel, filters.role, filters.kind, filters.category, filters.facebook, filters.order, filters.customer, filters.stock]);

  const exportUrl = useMemo(() => '/api/admin/all-history/export?' + qs(filters), [qs, filters]);
  const set = (patch: Partial<Filters>) => setFilters((f) => ({ ...f, ...patch }));

  /** Data check: proves which source tables exist and where the events really are (never guesses). */
  async function loadDiagnostics() {
    setShowDiag(true); setDiag(null);
    const r = await fetch('/api/admin/all-history?diagnostics=1', { cache: 'no-store' });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) { setMsg(j.error || 'Could not run the data check'); return; }
    setDiag(j);
  }

  return <>
    <div className="chTools">
      <label>From<input type="date" value={filters.from} onChange={(e) => set({ from: e.target.value })} /></label>
      <label>To<input type="date" value={filters.to} onChange={(e) => set({ to: e.target.value })} /></label>
      <label>Channel<select value={filters.channel} onChange={(e) => set({ channel: e.target.value })}>
        <option value="">All</option><option value="whatsapp">WhatsApp</option><option value="facebook">Messenger</option>
      </select></label>
      <label>Who<select value={filters.role} onChange={(e) => set({ role: e.target.value })}>
        <option value="">Everyone</option><option value="customer">Customer</option><option value="ai">AI</option><option value="human">Staff / human</option><option value="system">System</option>
      </select></label>
      <label>Event type<select value={filters.kind} onChange={(e) => set({ kind: e.target.value })}>
        <option value="">All events</option>
        {Object.keys(KIND_LABEL).map((k) => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}
      </select></label>
      <label>Vehicle type<select value={filters.category} onChange={(e) => set({ category: e.target.value })}>
        <option value="">All</option><option value="car">Cars</option><option value="motorcycle">Motorcycles</option>
      </select></label>
      <label>Vehicle / stock<input placeholder="CBR1000 or SC-859" value={filters.stock} onChange={(e) => set({ stock: e.target.value })} /></label>
      <label>Customer #<input placeholder="customer id" value={filters.customer} onChange={(e) => set({ customer: e.target.value.replace(/\D/g, '') })} /></label>
      <label className="wide">Search<input placeholder="message, name, phone, PSID" value={filters.q} onChange={(e) => set({ q: e.target.value })} onKeyDown={(e) => { if (e.key === 'Enter') void load(filters, false); }} /></label>
      <label>Facebook leads<select value={filters.facebook ? '1' : ''} onChange={(e) => set({ facebook: e.target.value === '1' })}>
        <option value="">Include everything</option><option value="1">Facebook leads only</option>
      </select></label>
      <label>Order<select value={filters.order} onChange={(e) => set({ order: e.target.value as 'asc' | 'desc' })}>
        <option value="desc">Newest first</option><option value="asc">Oldest first</option>
      </select></label>
      <button type="button" className="btn" onClick={() => { setCursor(null); void load(filters, false); }}>Search</button>
      <button type="button" className="miniBtn" onClick={() => setFilters(EMPTY)}>Clear</button>
      <a className="btn" href={exportUrl}>Download All History (.txt)</a>
      <button type="button" className="miniBtn" onClick={() => void loadDiagnostics()}>Data check</button>
    </div>
    <p className="muted">
      {count != null ? `${count} matching event(s)` : 'history'} - showing {rows.length}
      {exhausted ? ' (end of history)' : ' (use Load more)'}. The download contains every matching event,
      not only what is on screen.
    </p>
    {msg ? <div className="setupAlert">{msg}</div> : null}

    <div className="chTimeline">
      {rows.length ? rows.map((r, i) => {
        const vehicle = [r.model_year, r.brand, r.model].filter(Boolean).join(' ');
        const cls = r.kind === 'message' ? String(r.sender_role) : r.kind;
        return <div className={'chEvent ' + cls} key={r.source_id + ':' + i}>
          <small>
            {when(r.ts)} | {(r.channel || r.kind || 'system').toUpperCase()} |
            {' '}{whoOf(r)} |
            {' '}{r.kind === 'message' ? (ROLE_LABEL[r.sender_role] || r.sender_role) : (KIND_LABEL[r.kind] || r.kind).toUpperCase()}
          </small>
          {vehicle || r.stock_no ? <div className="chMeta">Vehicle: {vehicle || '-'}{r.category ? ` (${r.category})` : ''}{r.stock_no ? ` | Stock: ${r.stock_no}` : ''}</div> : null}
          <p>{r.body || '-'}</p>
          <div className="chMeta">
            {r.ref ? `ref ${r.ref}` : ''}{r.conversation_id ? ` | conversation #${r.conversation_id}` : ''}{r.customer_id ? ` | customer #${r.customer_id}` : ''}
            {r.meta ? ` | ${r.meta}` : ''} {r.conversation_id ? <a href={'/admin/whatsapp?conversation=' + r.conversation_id}>open in inbox</a> : null}
          </div>
        </div>;
      }) : <p className="muted">No history matches those filters.</p>}
    </div>

    {showDiag ? <div className="chCard" style={{ marginTop: 14 }}>
      <h3>Data check (source tables and counts)</h3>
      {!diag ? <p className="muted">Reading the database...</p> : <>
        <p className="muted" style={{ marginTop: 0 }}>{diag.explanation}</p>
        <p className="muted">Source tables found: {(diag.tables || []).join(', ') || 'none'}</p>
        <div className="chKV">
          {Object.entries(diag.counts || {}).map(([k, v]) => <><b key={k + '-k'}>{k.replace(/_/g, ' ')}</b><span key={k + '-v'}>{v == null ? 'n/a (table missing)' : Array.isArray(v) ? (v as any[]).map((x: any) => `${x.sender}: ${x.count}`).join(', ') : String(v)}</span></>)}
          <b>total history events</b><span>{diag.total_events ?? '-'}</span>
        </div>
      </>}
      <button type="button" className="miniBtn" style={{ marginTop: 8 }} onClick={() => setShowDiag(false)}>Close</button>
    </div> : null}
    {!exhausted && rows.length ? <div className="pager">
      <button type="button" className="miniBtn" disabled={busy} onClick={() => void load(filters, true)}>{busy ? 'Loading...' : 'Load more'}</button>
    </div> : null}
  </>;
}
