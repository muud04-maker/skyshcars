'use client';
import { useCallback, useEffect, useState } from 'react';

/*
  Phone-first customer history (Parts 5, 6, 19).
  Screen A: searchable list of customers (name / number / vehicle / stock).
  Screen B: that customer's complete history - profile, current interest, preferences, timeline,
            sales history, AI memory (editable) and private staff notes.
  Tapping a row opens the history; "Back to customers" returns. No wide tables.
*/
const CHANNEL_LABEL: Record<string, string> = { whatsapp: 'WhatsApp', facebook: 'Messenger', website: 'Website' };
const when = (v: any) => (v ? new Date(String(v).replace(' ', 'T')).toLocaleString() : '-');
const money = (v: any) => (v == null || Number(v) <= 0 ? '-' : '$' + Number(v).toLocaleString('en-US'));
const title = (v: any) => [v?.model_year, v?.brand, v?.model].filter(Boolean).join(' ');

export default function CustomerHistoryClient() {
  const [filters, setFilters] = useState({ q: '', channel: '', category: '', needs_reply: false, handled: '', from: '', to: '' });
  const [list, setList] = useState<any[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [openId, setOpenId] = useState<number | null>(null);
  const [detail, setDetail] = useState<any>(null);
  const [timeline, setTimeline] = useState<any[]>([]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [noteText, setNoteText] = useState('');
  const [factEdit, setFactEdit] = useState<any>({ key: '', value: '' });
  const [staff, setStaff] = useState('');
  const [timelineChannel, setTimelineChannel] = useState('');

  const loadList = useCallback(async (p = page) => {
    const qs = new URLSearchParams({ page: String(p), limit: '30' });
    if (filters.q) qs.set('q', filters.q);
    if (filters.channel) qs.set('channel', filters.channel);
    if (filters.category) qs.set('category', filters.category);
    if (filters.handled) qs.set('handled', filters.handled);
    if (filters.needs_reply) qs.set('needs_reply', '1');
    if (filters.from) qs.set('from', filters.from);
    if (filters.to) qs.set('to', filters.to);
    const r = await fetch('/api/admin/customer-history?' + qs, { cache: 'no-store' });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) { setMsg(j.error || 'Could not load customers'); return; }
    setList(j.list || []);
    setTotal(Number(j.total || 0));
  }, [filters, page]);

  const loadDetail = useCallback(async (id: number, channel = '') => {
    const qs = new URLSearchParams({ limit: '150' });
    if (channel) qs.set('channel', channel);
    const r = await fetch(`/api/admin/customer-history/${id}?` + qs, { cache: 'no-store' });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) { setMsg(j.error || 'Could not load this customer'); return; }
    setDetail(j.detail);
    setTimeline(j.timeline || []);
    setStaff(String(j.detail?.customer?.assigned_staff || ''));
  }, []);

  useEffect(() => { void loadList(page); }, [loadList, page]);
  useEffect(() => { if (openId) void loadDetail(openId, timelineChannel); }, [openId, timelineChannel, loadDetail]);

  async function act(body: any) {
    if (!openId) return;
    setBusy(true); setMsg('');
    const r = await fetch(`/api/admin/customer-history/${openId}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    const j = await r.json().catch(() => ({}));
    setBusy(false);
    if (!r.ok) { setMsg(j.error || 'Could not save'); return; }
    setDetail(j.detail); setTimeline(j.timeline || []);
    setMsg('Saved.');
  }

  function open(c: any) { setOpenId(c.id); setDetail(null); setMsg(''); window.scrollTo({ top: 0, behavior: 'smooth' }); }
  function back() { setOpenId(null); setDetail(null); setTimeline([]); setMsg(''); }

  // ---------------------------------------------------------------- Screen B
  if (openId) {
    const c = detail?.customer || {};
    const prefs = detail?.preferences || {};
    const interest = detail?.current_interest || null;
    return <>
      <div className="chInline" style={{ marginBottom: 10 }}>
        <button type="button" className="btn alt chBack" onClick={back}>&lt; Back to customers</button>
        <b style={{ fontSize: 18 }}>{c.full_name || c.phone || c.whatsapp_id || c.facebook_psid || `Customer #${openId}`}</b>
      </div>
      {msg ? <div className="setupAlert">{msg}</div> : null}
      {!detail ? <p className="muted">Loading history...</p> : <>
        <div className="chGrid2">
          <div className="chCard">
            <h3>Customer</h3>
            <div className="chKV">
              <b>Name</b><span>{c.full_name || '-'}</span>
              <b>Phone / id</b><span>{c.phone || c.whatsapp_id || c.facebook_psid || '-'}</span>
              <b>Channels</b><span>{(detail.channels || []).map((x: string) => CHANNEL_LABEL[x] || x).join(', ') || '-'}</span>
              <b>Language</b><span>{c.preferred_language || '-'}</span>
              <b>Country</b><span>{c.country || '-'}</span>
              <b>First contact</b><span>{when(detail.stats?.first_contact)}</span>
              <b>Last contact</b><span>{when(detail.stats?.last_contact)}</span>
              <b>Messages</b><span>{detail.stats?.message_count || 0} ({detail.stats?.inbound_count || 0} from customer, {detail.stats?.ai_count || 0} AI, {detail.stats?.staff_count || 0} staff)</span>
            </div>
            <div className="chInline" style={{ marginTop: 8 }}>
              <input placeholder="Assigned staff" value={staff} onChange={(e) => setStaff(e.target.value)} />
              <button type="button" className="miniBtn" disabled={busy} onClick={() => act({ action: 'assign_staff', staff })}>Save</button>
            </div>
          </div>

          <div className="chCard">
            <h3>Current interest</h3>
            {interest ? <div className="chKV">
              <b>Vehicle</b><span>{title(interest) || '-'}</span>
              <b>Stock</b><span>{interest.stock_no || '-'}</span>
              <b>Price</b><span>{money(interest.price_usd)}</span>
              <b>Category</b><span>{interest.category || '-'}</span>
              <b>Set from</b><span>{interest.source || '-'}</span>
            </div> : <p className="muted">No current vehicle.</p>}
            {detail.referrals?.length ? <div style={{ marginTop: 8 }}>
              <b style={{ fontSize: 12 }}>Referral</b>
              <p className="muted" style={{ margin: '4px 0 0' }}>{detail.referrals[0].headline || detail.referrals[0].body || '-'}<br />
                {detail.referrals[0].resolved_stock_no ? `Resolved: ${detail.referrals[0].resolved_stock_no} ${title(detail.referrals[0])}` : 'Not resolved'}</p>
            </div> : null}
          </div>
        </div>

        <div className="chCard">
          <h3>Preferences (AI memory)</h3>
          {detail.facts?.length ? detail.facts.map((f: any) => (
            <div className="chFact" key={f.id}>
              <span className="k">{String(f.fact_key).replace(/_/g, ' ')}: {f.fact_value}</span>
              <span className="chInline">
                <small className="muted">{f.source}{f.confidence != null ? ` | ${Math.round(Number(f.confidence) * 100)}%` : ''} | {when(f.updated_at)}</small>
                <button type="button" className="miniBtn danger" disabled={busy} onClick={() => act({ action: 'delete_fact', fact_key: f.fact_key })}>Delete</button>
              </span>
            </div>
          )) : <p className="muted">Nothing stored yet. The AI learns brand, budget, category and destination from the customer&apos;s own words.</p>}
          <div className="chInline" style={{ marginTop: 10 }}>
            <select value={factEdit.key} onChange={(e) => setFactEdit({ ...factEdit, key: e.target.value })}>
              <option value="">Choose field...</option>
              {['preferred_category', 'preferred_brand', 'preferred_model', 'body_type', 'fuel', 'transmission', 'steering', 'color', 'budget_min', 'budget_max', 'destination_country', 'destination_port', 'shipping_needed', 'model_year_min', 'model_year_max', 'purchase_intent'].map((k) => <option key={k} value={k}>{k.replace(/_/g, ' ')}</option>)}
            </select>
            <input placeholder="Value" value={factEdit.value} onChange={(e) => setFactEdit({ ...factEdit, value: e.target.value })} />
            <button type="button" className="miniBtn" disabled={busy || !factEdit.key || !factEdit.value} onClick={() => act({ action: 'set_fact', fact_key: factEdit.key, fact_value: factEdit.value }).then(() => setFactEdit({ key: '', value: '' }))}>Set</button>
          </div>
          {detail.memory?.summary ? <div className="learnBlock" style={{ marginTop: 10 }}><b>Assistant summary</b>{detail.memory.summary}</div> : null}
          {detail.fact_history?.length ? <details style={{ marginTop: 8 }}>
            <summary className="muted">Memory changes ({detail.fact_history.length})</summary>
            {detail.fact_history.map((h: any) => <div className="chFact" key={h.id}><span>{h.fact_key.replace(/_/g, ' ')}: {h.old_value ?? '(none)'} → {h.new_value ?? '(removed)'}</span><small className="muted">{h.action} | {h.source} | {when(h.changed_at)}</small></div>)}
          </details> : null}
        </div>

        <div className="chCard">
          <h3>Chat history ({timeline.length})</h3>
          <div className="chInline" style={{ marginBottom: 8 }}>
            <select value={timelineChannel} onChange={(e) => setTimelineChannel(e.target.value)}>
              <option value="">All channels</option>
              <option value="whatsapp">WhatsApp</option>
              <option value="facebook">Messenger</option>
            </select>
          </div>
          <div className="chTimeline">
            {timeline.length ? [...timeline].reverse().map((e: any, i: number) => (
              <div className={'chEvent ' + (e.kind === 'message' ? String(e.sender) : e.kind)} key={i}>
                <small>{e.title}{e.channel ? ` | ${CHANNEL_LABEL[e.channel] || e.channel}` : ''} | {when(e.at)}</small>
                {e.body ? <p>{e.body}</p> : null}
                {e.meta?.resolved ? <div className="chMeta">Resolved: {e.meta.resolved} ({e.meta.method})</div> : null}
                {e.meta?.delivery_status ? <div className="chMeta">{e.meta.delivery_status}</div> : null}
              </div>
            )) : <p className="muted">No history yet.</p>}
          </div>
        </div>

        <div className="chGrid2">
          <div className="chCard">
            <h3>Sales history</h3>
            {detail.quotes?.length ? detail.quotes.map((q: any) => (
              <div className="chFact" key={q.id}><span>{q.reference} | {title(q) || 'vehicle'} | {q.status} | {money(q.quoted_total_usd)}</span><small className="muted">{when(q.created_at)}</small></div>
            )) : <p className="muted">No quotes yet.</p>}
            {detail.vehicles_discussed?.length ? <div style={{ marginTop: 8 }}>
              <b style={{ fontSize: 12 }}>Vehicles discussed</b>
              {detail.vehicles_discussed.map((v: any, i: number) => <div className="chFact" key={i}><span>{title(v) || v.stock_no} ({v.stock_no})</span><small className="muted">{when(v.at)}</small></div>)}
            </div> : null}
          </div>

          <div className="chCard">
            <h3>Staff notes (private)</h3>
            <div className="chInline">
              <textarea rows={2} placeholder="Add a private note..." value={noteText} onChange={(e) => setNoteText(e.target.value)} />
              <button type="button" className="miniBtn" disabled={busy || !noteText.trim()} onClick={() => act({ action: 'add_note', note: noteText }).then(() => setNoteText(''))}>Add note</button>
            </div>
            {detail.notes?.length ? detail.notes.map((n: any) => (
              <div className="chFact" key={n.id}>
                <span>{n.note}<br /><small className="muted">{n.author || 'staff'} | {when(n.created_at)}</small></span>
                <button type="button" className="miniBtn danger" disabled={busy} onClick={() => act({ action: 'delete_note', note_id: n.id })}>Delete</button>
              </div>
            )) : <p className="muted">No notes yet.</p>}
          </div>
        </div>

        <div className="chCard">
          <h3>Conversations</h3>
          {detail.conversations?.map((cv: any) => (
            <div className="chFact" key={cv.id}>
              <span>{CHANNEL_LABEL[cv.channel] || cv.channel} | {cv.mode?.toUpperCase()} | {cv.message_count} messages</span>
              <span className="chInline"><small className="muted">{when(cv.last_message_at)}</small><a className="miniBtn" href={'/admin/whatsapp?conversation=' + cv.id}>Open in inbox</a></span>
            </div>
          ))}
        </div>
      </>}
    </>;
  }

  // ---------------------------------------------------------------- Screen A
  return <>
    <div className="chTools">
      <label className="wide">Search name, phone, Messenger id, vehicle or stock
        <input value={filters.q} onChange={(e) => setFilters({ ...filters, q: e.target.value })} onKeyDown={(e) => { if (e.key === 'Enter') { setPage(1); void loadList(1); } }} placeholder="e.g. CBR1000 or 2557..." />
      </label>
      <label>Channel<select value={filters.channel} onChange={(e) => setFilters({ ...filters, channel: e.target.value })}>
        <option value="">All</option><option value="whatsapp">WhatsApp</option><option value="facebook">Messenger</option>
      </select></label>
      <label>Vehicle type<select value={filters.category} onChange={(e) => setFilters({ ...filters, category: e.target.value })}>
        <option value="">All</option><option value="car">Cars</option><option value="motorcycle">Motorcycles</option>
      </select></label>
      <label>Handled by<select value={filters.handled} onChange={(e) => setFilters({ ...filters, handled: e.target.value })}>
        <option value="">Anyone</option><option value="ai">AI</option><option value="staff">Staff</option>
      </select></label>
      <label>From<input type="date" value={filters.from} onChange={(e) => setFilters({ ...filters, from: e.target.value })} /></label>
      <label>To<input type="date" value={filters.to} onChange={(e) => setFilters({ ...filters, to: e.target.value })} /></label>
      <label>Only<select value={filters.needs_reply ? 'waiting' : ''} onChange={(e) => setFilters({ ...filters, needs_reply: e.target.value === 'waiting' })}>
        <option value="">Everyone</option><option value="waiting">Needs reply</option>
      </select></label>
      <button type="button" className="btn" onClick={() => { setPage(1); void loadList(1); }}>Search</button>
    </div>
    {msg ? <div className="setupAlert">{msg}</div> : null}
    <p className="muted">{total} customer(s){total > 30 ? ` - page ${page} of ${Math.max(1, Math.ceil(total / 30))}` : ''}</p>
    <div className="chList">
      {list.length ? list.map((c) => (
        <button type="button" className="chRow" key={c.id} onClick={() => open(c)}>
          <b>{c.full_name || c.phone || c.whatsapp_id || c.facebook_psid || `Customer #${c.id}`}</b>
          <small>{c.channels.map((x: string) => CHANNEL_LABEL[x] || x).join(' + ') || 'no channel'} | last contact {when(c.last_contact)} | {c.message_count} messages</small>
          <small>{c.last_message ? String(c.last_message).slice(0, 120) : 'No messages yet'}</small>
          <span className="chCodes">
            {Number(c.needs_reply) ? <em className="warn">NEEDS REPLY</em> : <em className="ok">ANSWERED</em>}
            <em>{String(c.last_mode || 'ai').toUpperCase()}</em>
            {c.current_vehicle ? <em>{c.current_vehicle.stock_no} {title(c.current_vehicle)}</em> : null}
            {c.preferred_language ? <em>{c.preferred_language}</em> : null}
            {c.assigned_staff ? <em>{c.assigned_staff}</em> : null}
          </span>
        </button>
      )) : <p className="muted">No customers match those filters.</p>}
    </div>
    <div className="pager">
      <button type="button" className="miniBtn" disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>Previous</button>
      <span className="muted">page {page}</span>
      <button type="button" className="miniBtn" disabled={page * 30 >= total} onClick={() => setPage((p) => p + 1)}>Next</button>
    </div>
  </>;
}
