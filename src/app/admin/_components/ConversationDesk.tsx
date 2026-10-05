'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  computeUnread, countdown, dayLabel, deliveryState, filterRows, isLocked, isPaused,
  maxId, mergeMessages, pauseSecondsLeft, waitingLabel, type InboxFilter, type InboxMsg, type InboxRow,
} from '../../../lib/ai-rules/inbox';

type Mode = 'ai' | 'human' | 'paused';
const QUICK_REPLIES = ['Yes, it is available.', 'Which country should we ship to?', 'What is your budget?', 'One moment please, checking now.'];

const modeChip = (m?: string | null) => String(m || 'ai').toUpperCase();
const field = (v: any) => (v == null ? '' : String(v));

export default function ConversationDesk({ initial }: { initial: InboxRow[] }) {
  const [list, setList] = useState<InboxRow[]>(initial || []);
  const [activeId, setActiveId] = useState<number | null>((initial && initial[0]?.id) || null);
  const [msgs, setMsgs] = useState<InboxMsg[]>([]);
  const [state, setState] = useState<any>(null);
  const [referrals, setReferrals] = useState<any[]>([]);
  const [memory, setMemory] = useState<any>({ country: '', preferred_language: '', notes: '', memory_summary: '' });
  const [memoryMsg, setMemoryMsg] = useState('');
  const [vehicles, setVehicles] = useState<any[]>([]);
  const [pickQ, setPickQ] = useState('');
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [ok, setOk] = useState('');
  const [filter, setFilter] = useState<InboxFilter>('all');
  const [q, setQ] = useState('');
  const [atBottom, setAtBottom] = useState(true);
  const [newBelow, setNewBelow] = useState(0);
  const [now, setNow] = useState(() => Date.now());

  const cursor = useRef('');
  const msgCursor = useRef(0);
  const statusCursor = useRef('');
  const backoff = useRef(1000);
  const bottom = useRef<HTMLDivElement | null>(null);
  const scrollBox = useRef<HTMLDivElement | null>(null);

  const active = useMemo(() => list.find((c) => c.id === activeId) || null, [list, activeId]);
  const shown = useMemo(() => filterRows(list, filter, q), [list, filter, q]);
  const waiting = useMemo(() => list.filter((c) => Number(c.needs_reply) > 0).length, [list]);

  // ---- data loading -------------------------------------------------------
  async function loadDetail(id: number, full: boolean) {
    const [mr, rr] = await Promise.all([
      fetch(`/api/admin/conversations/${id}/customer`, { cache: 'no-store' }).then((r) => (r.ok ? r.json() : null)).catch(() => null),
      fetch(`/api/admin/referrals?conversation=${id}`, { cache: 'no-store' }).then((r) => (r.ok ? r.json() : null)).catch(() => null),
    ]);
    if (mr?.customer) {
      const c = mr.customer;
      setMemory({ country: field(c.country), preferred_language: field(c.preferred_language), notes: field(c.notes), memory_summary: field(c.memory_summary) });
    }
    if (rr?.referrals) setReferrals(rr.referrals);
    if (full) {
      const r = await fetch(`/api/admin/conversations/${id}`, { cache: 'no-store' }).then((x) => (x.ok ? x.json() : null)).catch(() => null);
      if (r?.messages) {
        setMsgs(r.messages);
        msgCursor.current = maxId(r.messages);
        statusCursor.current = new Date().toISOString();
        setNewBelow(0);
        requestAnimationFrame(() => { bottom.current?.scrollIntoView({ block: 'end' }); setAtBottom(true); });
      }
    }
  }

  async function poll() {
    try {
      const p = new URLSearchParams({ since: cursor.current, since_messages: statusCursor.current });
      if (activeId) { p.set('conversation', String(activeId)); p.set('after_message_id', String(msgCursor.current)); }
      const r = await fetch(`/api/admin/conversations/inbox?${p}`, { cache: 'no-store' });
      if (!r.ok) throw new Error('poll ' + r.status);
      const j = await r.json();
      backoff.current = 1000;
      if (j.cursor) cursor.current = j.cursor;
      if (j.status_cursor) statusCursor.current = j.status_cursor;
      if (Array.isArray(j.conversations)) {
        setList(j.conversations);
        setActiveId((cur) => (cur && j.conversations.some((c: InboxRow) => c.id === cur) ? cur : (j.conversations[0]?.id ?? cur)));
      }
      if (Array.isArray(j.messages) && j.messages.length) {
        const added = j.messages.filter((m: InboxMsg) => Number(m.id) > msgCursor.current && String(m.sender) === 'customer').length;
        setMsgs((prev) => mergeMessages(prev, j.messages));
        msgCursor.current = Math.max(msgCursor.current, maxId(j.messages));
        if (added) { setNewBelow((n) => (atBottom ? 0 : n + added)); if (!atBottom) beep(); }
      }
      if (j.state) setState(j.state);
    } catch {
      backoff.current = Math.min(20000, backoff.current * 2); // back off on errors
    }
  }

  useEffect(() => { void loadDetail(activeId ?? 0, true); }, [activeId]);
  useEffect(() => {
    let timer: any;
    const tick = () => {
      const visible = typeof document === 'undefined' || document.visibilityState === 'visible';
      void poll().finally(() => { timer = setTimeout(tick, visible ? 1000 : backoff.current * 4); });
    };
    tick();
    return () => clearTimeout(timer);
  }, [activeId, atBottom]);
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, []);

  // Mark the open chat as read while it is on screen.
  useEffect(() => {
    if (!activeId) return;
    const t = setTimeout(() => {
      if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return;
      void fetch(`/api/admin/conversations/${activeId}/read`, { method: 'POST' }).catch(() => {});
    }, 1200);
    return () => clearTimeout(t);
  }, [activeId, msgs.length]);

  // Browser tab alert + optional sound for new customer messages.
  useEffect(() => {
    const unread = list.filter((c) => computeUnread(c)).length;
    document.title = unread ? `(${unread}) Sky Cars Inbox` : 'Sky Cars Inbox';
  }, [list]);
  function beep() { try { const A = (window as any).AudioContext || (window as any).webkitAudioContext; if (!A) return; const ctx = new A(); const o = ctx.createOscillator(); const g = ctx.createGain(); o.connect(g); g.connect(ctx.destination); g.gain.value = 0.06; o.frequency.value = 880; o.start(); setTimeout(() => { o.stop(); ctx.close(); }, 140); } catch {} }

  // ---- actions -----------------------------------------------------------
  async function post(url: string, body?: any) {
    setBusy(true); setErr(''); setOk('');
    const r = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
    const j = await r.json().catch(() => ({}));
    setBusy(false);
    if (!r.ok) { setErr(j.error || 'Action failed'); return null; }
    return j;
  }
  async function setMode(mode: Mode) {
    if (!activeId) return;
    const j = await post(`/api/admin/conversations/${activeId}/mode`, { mode });
    if (j) { setOk(mode === 'ai' && j?.catchUp?.sent ? 'AI restored and the waiting message was answered.' : 'Mode updated.'); await poll(); await loadDetail(activeId, false); }
  }
  async function aiNow() { if (!activeId) return; const j = await post(`/api/admin/conversations/${activeId}/ai-reply`); if (j) { setOk(j.sent ? 'AI reply sent.' : j.message || 'No unanswered message.'); await poll(); } }
  async function quick(action: 'sold' | 'not_available') { if (!activeId) return; const j = await post(`/api/admin/conversations/${activeId}/quick-action`, { action }); if (j) { setOk(action === 'sold' ? 'Vehicle marked sold.' : 'Vehicle marked not available.'); await poll(); } }
  async function send(e: React.FormEvent) {
    e.preventDefault();
    if (!activeId || !text.trim()) return;
    const j = await post(`/api/admin/conversations/${activeId}/reply`, { text });
    if (j) { setText(''); setOk('Staff reply sent to WhatsApp.'); await poll(); }
  }
  async function sendPhotos(vehicleId: number) {
    if (!activeId || !vehicleId) return;
    const j = await post(`/api/admin/conversations/${activeId}/photos`, { vehicle_id: vehicleId });
    if (j) { setOk(`Sent ${j.sent} exact photo(s).`); await poll(); }
  }
  async function setCurrentCar(vehicleId: number) { if (!activeId || !vehicleId) return; const j = await post(`/api/admin/conversations/${activeId}/current-car`, { vehicle_id: vehicleId }); if (j) { setOk('Current car updated.'); await poll(); } }
  async function correctReferral(ref: any, vehicleId: number) { const j = await post('/api/admin/referrals', { channel: ref.channel, source_id: ref.source_id, source_url: ref.source_url, vehicle_id: vehicleId }); if (j) { setOk('Referral corrected. Future replies use this car.'); await loadDetail(activeId ?? 0, false); } }
  async function saveMemory() {
    if (!activeId) return;
    setMemoryMsg('Saving...');
    const r = await fetch(`/api/admin/conversations/${activeId}/customer`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...memory, refresh_memory: true }) });
    setMemoryMsg(r.ok ? 'Saved.' : 'Could not save');
  }

  async function openPicker() {
    if (vehicles.length) return;
    const r = await fetch('/api/admin/vehicles', { cache: 'no-store' }).then((x) => (x.ok ? x.json() : null)).catch(() => null);
    setVehicles(r?.vehicles || []);
  }
  const pickList = useMemo(() => {
    const term = pickQ.trim().toLowerCase();
    const base = vehicles.filter((v) => String(v.status) === 'available' || term);
    return (term ? base.filter((v) => [v.stock_no, v.brand, v.model, v.model_year].map(field).join(' ').toLowerCase().includes(term)) : base).slice(0, 25);
  }, [vehicles, pickQ]);

  function onScroll() {
    const el = scrollBox.current; if (!el) return;
    const near = el.scrollHeight - el.scrollTop - el.clientHeight < 60;
    setAtBottom(near);
    if (near) setNewBelow(0);
  }

  return <div className="inbox">
    <aside className="chatList">
      <div className="chatListTitle">Live conversations <span>{list.length}</span>
        <small style={{ display: 'block', fontWeight: 700, color: waiting ? '#9b3d00' : '#39745a', marginTop: 4 }}>{waiting} need a reply</small>
      </div>
      <input placeholder="Search name, phone, stock number..." value={q} onChange={(e) => setQ(e.target.value)} />
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, padding: '6px 8px' }}>
        {(['all', 'waiting', 'ai', 'human', 'paused', 'needs_staff'] as InboxFilter[]).map((f) => (
          <button key={f} type="button" className={'miniBtn ' + (filter === f ? 'selected' : '')} onClick={() => setFilter(f)}>{f.replace('_', ' ')}</button>
        ))}
      </div>
      {shown.map((c) => {
        const paused = isPaused(c, now); const locked = isLocked(c, now);
        return <button key={c.id} className={'chatRow ' + (activeId === c.id ? 'active' : '')} onClick={() => setActiveId(c.id)}>
          <b>{computeUnread(c) ? <i style={{ color: '#1e88e5', marginRight: 6 }} title="Unread">*</i> : null}{c.full_name || c.phone || c.external_user_id}</b>
          {Number(c.needs_reply) > 0 ? <em style={{ color: '#b3261e', fontStyle: 'normal', fontWeight: 800 }}> NEEDS REPLY</em> : null}
          <small>{c.channel?.toUpperCase()} | {modeChip(c.mode)}{paused ? ` | PAUSED ${countdown(pauseSecondsLeft(c, now))}` : ''}{locked ? ' | REPLYING' : ''}</small>
          <small>{waitingLabel(c) ? <span style={{ color: '#b3261e' }}>{waitingLabel(c)} </span> : null}{Number(c.needs_staff) ? <span style={{ color: '#9b3d00' }}>| needs staff </span> : null}{c.current_stock_no ? <span>| {c.current_stock_no}</span> : null}</small>
          <span>{c.preview || 'No message preview'}</span>
        </button>;
      })}
    </aside>

    <section className="chatDesk">{!active ? <div className="emptyChat">No conversations yet. Open WhatsApp Diagnostics to verify the Meta webhook.</div> : <>
      <div className="chatHead">
        <div><h2>{active.full_name || active.phone || active.external_user_id}</h2>
          <small>{active.channel} | {active.external_user_id}{state?.current_stock_no ? ` | current car ${state.current_stock_no}` : ''}{state?.needs_staff ? ' | NEEDS STAFF' : ''}{isPaused(active, now) ? ` | AI paused ${countdown(pauseSecondsLeft(active, now))}` : ''}</small></div>
        <div className="modeButtons">
          <button disabled={busy} className={active.mode === 'human' ? 'selected' : ''} onClick={() => setMode('human')}>Take Over</button>
          <button disabled={busy} className={active.mode === 'ai' ? 'selected' : ''} onClick={() => setMode('ai')}>Return to AI</button>
          <button disabled={busy} className={active.mode === 'paused' ? 'selected' : ''} onClick={() => setMode('paused')}>Pause</button>
          <button disabled={busy} onClick={aiNow} title="Answer the newest unanswered message with AI now">AI Reply Now</button>
          <button disabled={busy} onClick={() => quick('sold')}>Sold</button>
          <button disabled={busy} onClick={() => quick('not_available')}>Not Available</button>
        </div>
      </div>

      <div className="modeNotice">Mode: <b>{modeChip(active.mode)}</b>
        {active.mode === 'human' ? ' - automatic replies are off.' : active.mode === 'ai' ? ' - the AI answers new messages.' : ' - paused; the AI returns after the pause.'}
        {Number(active.needs_reply) > 0 ? <b> | CUSTOMER IS WAITING</b> : null}
        {Number(active.needs_staff) ? <b style={{ color: '#9b3d00' }}> | flagged for staff</b> : null}
      </div>

      <div className="messages" ref={scrollBox} onScroll={onScroll}>
        {msgs.map((m, i) => {
          const day = dayLabel(m.created_at, now);
          const prevDay = i ? dayLabel(msgs[i - 1].created_at, now) : '';
          const ds = deliveryState(m);
          const who = String(m.sender) === 'customer' ? 'CUSTOMER' : String(m.sender) === 'ai' ? 'AI' : String(m.sender) === 'human' ? 'STAFF' : 'SYSTEM';
          return <div key={m.id}>
            {day && day !== prevDay ? <div style={{ textAlign: 'center', margin: '10px 0', color: '#6b7c8c', fontSize: 12, fontWeight: 700 }}>{day}</div> : null}
            <div className={'bubble ' + (String(m.sender) === 'customer' ? 'customer' : 'agent')}>
              <small>{who}{m.message_type && m.message_type !== 'text' ? ' | ' + String(m.message_type).toUpperCase() : ''}{ds ? ' | ' + ds.label.toUpperCase() : ''}</small>
              {m.media_url && m.message_type === 'image' ? <img src={`/api/admin/conversations/media/${m.id}`} alt="Customer WhatsApp upload (admin only)" style={{ display: 'block', maxWidth: 320, maxHeight: 260, objectFit: 'contain', borderRadius: 10, margin: '8px 0' }} /> : null}
              {m.media_url && m.message_type === 'audio' ? <audio controls preload="none" src={`/api/admin/conversations/media/${m.id}`} style={{ display: 'block', maxWidth: 320, margin: '8px 0' }} /> : null}
              {m.media_url && m.message_type === 'video' ? <video controls preload="none" src={`/api/admin/conversations/media/${m.id}`} style={{ display: 'block', maxWidth: 320, margin: '8px 0' }} /> : null}
              <div style={{ whiteSpace: 'pre-wrap' }}>{linkify(m.body) || (m.media_url ? `[${m.message_type}]` : '')}</div>
              {ds?.reason ? <div style={{ color: '#b3261e', fontSize: 12 }}>failed: {ds.reason}</div> : null}
              <time>{new Date(m.created_at).toLocaleString()}</time>
            </div>
          </div>;
        })}
        <div ref={bottom} />
      </div>
      {newBelow > 0 ? <button className="miniBtn" style={{ margin: '6px 16px' }} onClick={() => { bottom.current?.scrollIntoView({ block: 'end' }); setAtBottom(true); setNewBelow(0); }}>New messages ({newBelow})</button> : null}

      <details className="customerMemory" open>
        <summary>Context</summary>
        <div className="customerMemoryGrid">
          <div className="wide"><b>Current car</b>
            <p>{state?.current_stock_no || 'none set'}</p>
            <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              <input placeholder="Search stock / brand / model" value={pickQ} onChange={(e) => setPickQ(e.target.value)} onFocus={openPicker} />
              <select defaultValue="" onChange={(e) => { const v = Number(e.target.value); if (v) setCurrentCar(v); }}>
                <option value="">Correct current car...</option>
                {pickList.map((v) => <option key={v.id} value={v.id}>{v.stock_no} {v.model_year || ''} {v.brand || ''} {v.model || ''}</option>)}
              </select>
            </div>
            <button type="button" className="miniBtn" onClick={() => { openPicker(); const v = pickList[0]; if (v) sendPhotos(v.id); }}>Send exact photos of the first match</button>
          </div>
          {state?.slots && Object.keys(state.slots).length ? <div className="wide"><b>Known slots</b><p>{Object.entries(state.slots).map(([k, v]) => `${k}: ${v}`).join(' | ')}</p></div> : null}
          {referrals.length ? <div className="wide"><b>Facebook referral</b>{referrals.slice(0, 3).map((r) => <div key={r.id} style={{ border: '1px solid #dce5ec', borderRadius: 8, padding: 8, marginTop: 6 }}>
            <small>{r.source_type || 'post'} | {r.match_method || 'unmatched'}{r.matched_vehicle_id ? ` | vehicle #${r.matched_vehicle_id}` : ''}</small>
            <p style={{ margin: '4px 0' }}>{r.headline || r.body || r.source_id || '(no headline)'}</p>
            <select defaultValue="" onChange={(e) => { const v = Number(e.target.value); if (v) correctReferral(r, v); }}>
              <option value="">Correct this referral to...</option>
              {pickList.map((v) => <option key={v.id} value={v.id}>{v.stock_no} {v.model_year || ''} {v.brand || ''} {v.model || ''}</option>)}
            </select>
          </div>)}</div> : null}
          <label>Country<input value={memory.country} onChange={(e) => setMemory({ ...memory, country: e.target.value })} /></label>
          <label>Preferred language<input value={memory.preferred_language} onChange={(e) => setMemory({ ...memory, preferred_language: e.target.value })} /></label>
          {memory.memory_summary ? <div className="wide memorySummary"><b>Assistant memory summary</b><p>{memory.memory_summary}</p></div> : null}
          <label className="wide">Notes for future replies<textarea value={memory.notes} onChange={(e) => setMemory({ ...memory, notes: e.target.value })} /></label>
        </div>
        <button type="button" className="miniBtn" onClick={saveMemory}>Save + refresh memory</button> <span className="muted">{memoryMsg}</span>
      </details>

      {(err || ok) && <div style={{ padding: '0 16px' }}>{err && <p className="error">{err}</p>}{ok && <p style={{ color: '#08733d', fontWeight: 800 }}>{ok}</p>}</div>}

      <div style={{ padding: '0 16px', display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        {QUICK_REPLIES.map((qr) => <button key={qr} type="button" className="miniBtn" onClick={() => setText((t) => (t ? t + ' ' + qr : qr))}>{qr}</button>)}
      </div>
      <form className="replyBox" onSubmit={send}>
        <textarea value={text} onChange={(e) => setText(e.target.value)} placeholder="Type a real WhatsApp reply..." />
        <button className="btn" disabled={busy || !text.trim()}>Send as Staff</button>
      </form>
      <div style={{ padding: '0 16px 16px' }}>
        <input placeholder="Send exact photos: search a vehicle" value={pickQ} onChange={(e) => setPickQ(e.target.value)} onFocus={openPicker} />
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 6 }}>
          {pickList.slice(0, 4).map((v) => <button key={v.id} type="button" className="miniBtn" onClick={() => sendPhotos(v.id)}>Photos: {v.stock_no}</button>)}
        </div>
      </div>
    </>}</section>
  </div>;
}

/** Very small link renderer so URLs in messages stay clickable without any dependency. */
function linkify(body?: string | null) {
  const s = String(body || '');
  if (!s) return '';
  const parts = s.split(/(https?:\/\/[^\s]+)/g);
  return parts.map((p, i) => (/^https?:\/\//.test(p) ? <a key={i} href={p} target="_blank" rel="noopener noreferrer">{p}</a> : p));
}
