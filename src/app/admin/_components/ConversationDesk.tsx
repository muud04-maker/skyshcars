'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  computeUnread, countdown, dayLabel, deliveryState, filterRows, isLocked, isPaused,
  draftFor, maxId, mergeMessages, pauseSecondsLeft, waitingLabel, withDraft,
  type DraftMap, type InboxFilter, type InboxMsg, type InboxRow,
} from '../../../lib/ai-rules/inbox';
import { languageName, preferredToCode, type LangCode } from '../../../lib/ai-rules/language';
import { countdownLabel, queueStatusLabel, secondsLeft } from '../../../lib/ai-rules/ai-queue';
import { referralLooksMismatched } from '../../../lib/ai-rules/referral-match';

type Mode = 'ai' | 'human' | 'paused' | 'both';
const field = (v: any) => (v == null ? '' : String(v));
const modeChip = (m?: string | null) => String(m || 'ai').toUpperCase();

export default function ConversationDesk({ initial }: { initial: InboxRow[] }) {
  const [list, setList] = useState<InboxRow[]>(initial || []);
  const [activeId, setActiveId] = useState<number | null>((initial && initial[0]?.id) || null);
  const [msgs, setMsgs] = useState<InboxMsg[]>([]);
  const [state, setState] = useState<any>(null);
  const [referrals, setReferrals] = useState<any[]>([]);
  const [welcome, setWelcome] = useState<any>(null);
  const [memory, setMemory] = useState<any>({ country: '', preferred_language: '', notes: '', memory_summary: '' });
  const [memoryMsg, setMemoryMsg] = useState('');
  const [vehicles, setVehicles] = useState<any[]>([]);
  const [pickId, setPickId] = useState('');
  const [links, setLinks] = useState<any>({ site: 'https://skyshcars.com', group_link: '', group_name: 'Sky second hand cars' });
  // Drafts are per conversation: switching chats never carries text over, and polling never clears them.
  const [drafts, setDrafts] = useState<DraftMap>({});
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [ok, setOk] = useState('');
  const [filter, setFilter] = useState<InboxFilter>('all');
  const [q, setQ] = useState('');
  const [archived, setArchived] = useState(false);
  const [selected, setSelected] = useState<number[]>([]);
  const [showDrawer, setShowDrawer] = useState(true);
  const [mobileChat, setMobileChat] = useState(false);
  const [showQuick, setShowQuick] = useState(false);
  const [showMore, setShowMore] = useState(false);
  const [atBottom, setAtBottom] = useState(true);
  const [newBelow, setNewBelow] = useState(0);
  const [now, setNow] = useState(() => Date.now());
  const [conn, setConn] = useState<'LIVE' | 'RECONNECTING' | 'OFFLINE'>('LIVE');
  const fails = useRef(0);
  const [lightbox, setLightbox] = useState<string>('');

  const cursor = useRef('');
  const msgCursor = useRef(0);
  const statusCursor = useRef('');
  const backoff = useRef(1000);
  const bottom = useRef<HTMLDivElement | null>(null);
  const scrollBox = useRef<HTMLDivElement | null>(null);

  const active = useMemo(() => list.find((c) => c.id === activeId) || null, [list, activeId]);
  const shown = useMemo(() => filterRows(list, filter, q), [list, filter, q]);
  const waiting = useMemo(() => list.filter((c) => Number(c.needs_reply) > 0).length, [list]);
  const allShownSelected = shown.length > 0 && shown.every((c) => selected.includes(c.id));

  async function loadDetail(id: number) {
    const [mr, rr, cr] = await Promise.all([
      fetch(`/api/admin/conversations/${id}/customer`, { cache: 'no-store' }).then((r) => (r.ok ? r.json() : null)).catch(() => null),
      fetch(`/api/admin/referrals?conversation=${id}`, { cache: 'no-store' }).then((r) => (r.ok ? r.json() : null)).catch(() => null),
      fetch(`/api/admin/conversations/${id}`, { cache: 'no-store' }).then((r) => (r.ok ? r.json() : null)).catch(() => null),
    ]);
    if (mr?.customer) { const c = mr.customer; setMemory({ country: field(c.country), preferred_language: field(c.preferred_language), notes: field(c.notes), memory_summary: field(c.memory_summary) }); }
    if (rr?.referrals) setReferrals(rr.referrals);
    if (cr) setWelcome(cr.welcome || null);
    if (cr?.messages) {
      setMsgs(cr.messages);
      msgCursor.current = maxId(cr.messages);
      statusCursor.current = new Date().toISOString();
      setNewBelow(0);
      requestAnimationFrame(() => { bottom.current?.scrollIntoView({ block: 'end' }); setAtBottom(true); });
    }
  }

  async function poll() {
    try {
      const p = new URLSearchParams({ since: cursor.current, since_messages: statusCursor.current, archived: archived ? '1' : '0' });
      if (activeId) { p.set('conversation', String(activeId)); p.set('after_message_id', String(msgCursor.current)); }
      const r = await fetch(`/api/admin/conversations/inbox?${p}`, { cache: 'no-store' });
      if (!r.ok) throw new Error('poll ' + r.status);
      const j = await r.json();
      backoff.current = 1000;
      fails.current = 0; setConn('LIVE');
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
      backoff.current = Math.min(20000, backoff.current * 2);
      fails.current += 1;
      setConn(fails.current >= 3 ? 'OFFLINE' : 'RECONNECTING');
    }
  }

  useEffect(() => { if (activeId) void loadDetail(activeId); else { setMsgs([]); setState(null); setReferrals([]); } }, [activeId]);
  useEffect(() => { cursor.current = ''; void poll(); }, [archived]);
  useEffect(() => {
    let timer: any;
    const tick = () => {
      const visible = typeof document === 'undefined' || document.visibilityState === 'visible';
      // Live cadence: ~2.5s while the tab is visible, slow (and backed off) while hidden.
      void poll().finally(() => { timer = setTimeout(tick, visible ? 2500 : 15000); });
    };
    tick();
    return () => clearTimeout(timer);
  }, [activeId, atBottom, archived]);
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, []);
  /*
    Phone layout: land on the conversation list, never with the customer drawer covering the chat.
    Desktop keeps the three-pane desk with the drawer open.
  */
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    if (window.matchMedia('(max-width: 900px)').matches) { setShowDrawer(false); setMobileChat(false); }
  }, []);
  useEffect(() => {
    if (!activeId) return;
    const t = setTimeout(() => { if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return; void fetch(`/api/admin/conversations/${activeId}/read`, { method: 'POST' }).catch(() => {}); }, 1200);
    return () => clearTimeout(t);
  }, [activeId, msgs.length]);
  useEffect(() => { const unread = list.filter((c) => computeUnread(c)).length; document.title = unread ? `(${unread}) Sky Cars Inbox` : 'Sky Cars Inbox'; }, [list]);
  useEffect(() => { fetch('/api/admin/ai-settings', { cache: 'no-store' }).then((r) => (r.ok ? r.json() : null)).then((j) => { if (j?.welcome) setLinks(j.welcome); }).catch(() => {}); }, []);
  useEffect(() => { if (showDrawer) void openPicker(); }, [showDrawer]);

  function beep() { try { const A = (window as any).AudioContext || (window as any).webkitAudioContext; if (!A) return; const ctx = new A(); const o = ctx.createOscillator(); const g = ctx.createGain(); o.connect(g); g.connect(ctx.destination); g.gain.value = 0.06; o.frequency.value = 880; o.start(); setTimeout(() => { o.stop(); ctx.close(); }, 140); } catch {} }

  async function post(url: string, body?: any, method: string = 'POST') {
    setBusy(true); setErr(''); setOk('');
    const r = await fetch(url, { method, headers: { 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
    const j = await r.json().catch(() => ({}));
    setBusy(false);
    if (!r.ok) { setErr(j.error || 'Action failed'); return null; }
    return j;
  }
  async function setMode(mode: Mode) { if (!activeId) return; const j = await post(`/api/admin/conversations/${activeId}/mode`, { mode }); if (j) { setOk(mode === 'ai' && j?.catchUp?.sent ? 'AI restored and the waiting message was answered.' : 'Mode updated.'); await poll(); } }
  async function aiNow() { if (!activeId) return; const j = await post(`/api/admin/conversations/${activeId}/ai-reply`); if (j) { setOk(j.sent ? 'AI reply sent.' : j.message || 'No unanswered message.'); await poll(); } }
  async function quick(action: 'sold' | 'not_available') { if (!activeId) return; const j = await post(`/api/admin/conversations/${activeId}/quick-action`, { action }); if (j) { setOk(action === 'sold' ? 'Vehicle marked sold.' : 'Vehicle marked not available.'); await poll(); } }
  async function archiveOne() { if (!activeId) return; const j = await post('/api/admin/conversations/bulk', { ids: [activeId], action: 'archive' }); if (j) { setOk('Conversation archived.'); setActiveId(null); await poll(); } }
  async function markUnread() { if (!activeId) return; const j = await post('/api/admin/conversations/bulk', { ids: [activeId], action: 'unread' }); if (j) { setOk('Marked unread.'); await poll(); } }
  async function markRead() { if (!activeId) return; const j = await post(`/api/admin/conversations/${activeId}/read`); if (j) { setOk('Marked read.'); await poll(); } }
  async function cancelAiReply() {
    if (!activeId) return;
    const j = await post(`/api/admin/conversations/${activeId}/cancel-reply`);
    if (j) { setOk('Queued AI reply cancelled.'); await poll(); }
  }
  async function resetWelcome() {
    if (!activeId) return;
    if (!confirm('The website and WhatsApp group invitation will be eligible to send again on this customer\'s next AI response.')) return;
    const j = await post(`/api/admin/conversations/${activeId}/reset-welcome`);
    if (j) { setOk('Welcome reset - the next AI reply for this customer will include the website and group link.'); setWelcome(null); }
  }
  async function deleteOne() {
    if (!activeId) return;
    if (!confirm('Permanently delete this conversation and its messages? The customer record is kept. Only the owner can do this.')) return;
    const j = await post(`/api/admin/conversations/${activeId}`, undefined, 'DELETE');
    if (j) { setOk('Conversation deleted.'); setActiveId(null); await poll(); }
  }
  async function send(e: React.FormEvent) {
    e.preventDefault();
    if (!activeId || !text.trim()) return;
    const conversationId = activeId;
    const j = await post(`/api/admin/conversations/${activeId}/reply`, { text });
    // Clear only the draft of the chat that was answered (never another chat's draft).
    if (j) { setDrafts((d) => withDraft(d, conversationId, '')); setOk('Reply sent.'); await poll(); }
  }
  async function sendPhotos(vehicleId: number) { if (!activeId || !vehicleId) return; const j = await post(`/api/admin/conversations/${activeId}/photos`, { vehicle_id: vehicleId }); if (j) { setOk(`Sent ${j.sent} exact photo(s).`); await poll(); } }
  async function setCurrentCar(vehicleId: number) { if (!activeId || !vehicleId) return; const j = await post(`/api/admin/conversations/${activeId}/current-car`, { vehicle_id: vehicleId }); if (j) { setOk('Current car updated.'); await poll(); } }
  async function clearCurrentCar() { if (!activeId) return; const j = await post(`/api/admin/conversations/${activeId}/current-car`, { vehicle_id: null, clear: true }); if (j) { setOk('Current car cleared.'); await poll(); } }
  async function correctReferral(ref: any, vehicleId: number) {
    // conversation_id makes the correction take effect immediately: this chat is pointed at the real vehicle.
    const j = await post('/api/admin/referrals', { channel: ref.channel, source_id: ref.source_id, source_url: ref.source_url, vehicle_id: vehicleId, conversation_id: activeId });
    if (j) { setOk('Referral corrected - this chat now uses that vehicle.'); await loadDetail(activeId ?? 0); }
  }
  async function saveMemory() {
    if (!activeId) return;
    setMemoryMsg('Saving...');
    const r = await fetch(`/api/admin/conversations/${activeId}/customer`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...memory, refresh_memory: true }) });
    setMemoryMsg(r.ok ? 'Saved.' : 'Could not save');
  }

  async function bulk(action: 'ai' | 'human' | 'both' | 'paused' | 'archive' | 'unarchive' | 'unread' | 'delete') {
    if (!selected.length) return;
    const label = action === 'delete' ? 'Permanently delete' : action === 'archive' ? 'Archive' : action === 'unarchive' ? 'Restore' : action === 'unread' ? 'Mark unread' : action === 'ai' ? 'Return to AI' : action === 'both' ? 'Set BOTH' : action === 'human' ? 'Take over' : 'Pause';
    if (!confirm(`${label} ${selected.length} conversation(s)?${action === 'delete' ? ' Their messages are removed; customer records stay.' : ''}`)) return;
    const j = await post('/api/admin/conversations/bulk', { ids: selected, action });
    if (j) { setOk(`${label}: ${j.changed ?? j.deleted} conversation(s).`); setSelected([]); await poll(); }
  }
  function toggleSelect(id: number) { setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id])); }
  function toggleAll() { setSelected(allShownSelected ? [] : shown.map((c) => c.id)); }

  async function openPicker() {
    if (vehicles.length) return;
    const r = await fetch('/api/admin/vehicles', { cache: 'no-store' }).then((x) => (x.ok ? x.json() : null)).catch(() => null);
    setVehicles(r?.vehicles || []);
  }
  const pickList = useMemo(() => vehicles.slice(0, 400), [vehicles]);
  const pendingAt = state?.pending_ai_reply_at ? Date.parse(String(state.pending_ai_reply_at).replace(' ', 'T')) : 0;
  const replyLeft = secondsLeft(pendingAt, now);
  const queueLabel = queueStatusLabel({ secondsLeft: replyLeft, lastResult: state?.pending_last_result, pending: replyLeft > 0 || !!state?.pending_ai_reply_at });
  // The composer text of the chat that is open right now (its own draft).
  const text = draftFor(drafts, activeId);
  function setText(v: string) { if (!activeId) return; setDrafts((d) => withDraft(d, activeId, v)); }
  function insert(t: string) { setText(text ? text + ' ' + t : t); setShowQuick(false); }

  function onScroll() {
    const el = scrollBox.current; if (!el) return;
    const near = el.scrollHeight - el.scrollTop - el.clientHeight < 60;
    setAtBottom(near);
    if (near) setNewBelow(0);
  }

  return <div className={'inbox' + (showDrawer ? '' : ' noDrawer') + (mobileChat ? ' mobileChat' : '')}>
    <aside className="chatList">
      <div className="chatListTitle">{archived ? 'Archived' : 'Conversations'} <span>{list.length}</span><span className={'conn conn-' + conn.toLowerCase()} title="Live connection">{conn}</span>
        <small style={{ display: 'block', fontWeight: 700, color: waiting && !archived ? '#9b3d00' : '#39745a', marginTop: 4 }}>{archived ? 'history kept, hidden from inbox' : `${waiting} waiting for a reply`}</small>
        <button type="button" className="miniBtn" style={{ marginTop: 6 }} onClick={() => { setArchived((a) => !a); setSelected([]); }}>{archived ? '← Back to inbox' : 'Archived'}</button>
      </div>
      <div className="inboxTools">
        <input placeholder="Search name, phone, stock no." value={q} onChange={(e) => setQ(e.target.value)} />
        <select value={filter} onChange={(e) => setFilter(e.target.value as InboxFilter)}>
          <option value="all">All</option><option value="waiting">Waiting</option><option value="needs_staff">Needs staff</option>
          <option value="ai">AI</option><option value="human">Human</option><option value="paused">Paused</option>
        </select>
      </div>
      <div className="bulkBar">
        <label><input type="checkbox" checked={allShownSelected} onChange={toggleAll} /> all</label>
        {selected.length === 0 ? <span className="muted">tick chats for bulk actions</span> : <>
          <b>{selected.length}</b>
          <button className="miniBtn" disabled={busy} onClick={() => bulk('human')}>Take over</button>
          <button className="miniBtn" disabled={busy} onClick={() => bulk('ai')}>Return to AI</button>
          <button className="miniBtn" disabled={busy} onClick={() => bulk('both')}>Set Both</button>
          <button className="miniBtn" disabled={busy} onClick={() => bulk('paused')}>Pause</button>
          <button className="miniBtn" disabled={busy} onClick={() => bulk('unread')}>Mark unread</button>
          <button className="miniBtn" disabled={busy} onClick={() => bulk(archived ? 'unarchive' : 'archive')}>{archived ? 'Restore' : 'Archive'}</button>
          <button className="miniBtn danger" disabled={busy} onClick={() => bulk('delete')}>Delete</button>
        </>}
      </div>
      {shown.map((c) => {
        const paused = isPaused(c, now); const locked = isLocked(c, now);
        return <div key={c.id} className={'chatRowWrap' + (activeId === c.id ? ' active' : '')}>
          <input className="chatPick" type="checkbox" checked={selected.includes(c.id)} onChange={() => toggleSelect(c.id)} />
          <button className="chatRow" onClick={() => { setActiveId(c.id); setMobileChat(true); }}>
            <b>{computeUnread(c) ? <i style={{ color: '#1e88e5', marginRight: 6 }} title="Unread">*</i> : null}<span className={'chan chan-' + String(c.channel || 'whatsapp')} title={c.channel === 'facebook' ? 'Facebook / Messenger' : 'WhatsApp'}>{c.channel === 'facebook' ? 'FB' : 'WA'}</span>{c.full_name || c.phone || c.external_user_id}</b>
            {Number(c.needs_reply) > 0 ? <em style={{ color: '#b3261e', fontStyle: 'normal', fontWeight: 800 }}> NEEDS REPLY</em> : null}
            <small>{modeChip(c.mode)}{paused ? ` | PAUSED ${countdown(pauseSecondsLeft(c, now))}` : ''}{locked ? ' | REPLYING' : ''}{Number(c.needs_staff) ? ' | needs staff' : ''}{c.current_stock_no ? ` | ${c.current_stock_no}` : ''}</small>
            <small>{waitingLabel(c)}{c.last_message_at ? ` | ${new Date(String(c.last_message_at).replace(' ', 'T')).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}` : ''}</small>
            <span>{c.preview || 'No message preview'}</span>
          </button>
        </div>;
      })}
      {!shown.length ? <p className="muted" style={{ padding: 14 }}>No conversations here.</p> : null}
    </aside>

    <section className="chatDesk">{!active ? <div className="emptyChat">Select a conversation on the left.</div> : <>
      <div className="chatHead">
        <div><h2><button type="button" className="chatBack miniBtn" onClick={() => setMobileChat(false)}>&lt; Back</button> {active.full_name || active.phone || active.external_user_id}</h2>
          <small className="chatStatus">
            {Number(active.needs_reply) > 0 ? 'CUSTOMER WAITING' : 'WAITING FOR CUSTOMER'}
            {queueLabel ? ` | ${queueLabel}` : ''}
            {Number(active.needs_staff) ? ' | flagged for you' : ''}
            {isPaused(active, now) ? ` | AI paused ${countdown(pauseSecondsLeft(active, now))}` : ''}
            {state?.current_stock_no ? ` | ${state.current_stock_no}` : ''}
          </small></div>
        <div className="modeButtons">
          <div className="modeSeg" role="group" aria-label="Conversation mode">
            <button type="button" disabled={busy} className={active.mode === 'ai' ? 'active' : ''} onClick={() => setMode('ai')}>AI</button>
            <button type="button" disabled={busy} className={active.mode === 'human' ? 'active' : ''} onClick={() => setMode('human')}>TAKE OVER</button>
            <button type="button" disabled={busy} className={active.mode === 'both' ? 'active' : ''} onClick={() => setMode('both')}>BOTH</button>
          </div>
          <select value="" onChange={(e) => { const v = Number(e.target.value); if (v) sendPhotos(v); }} onFocus={openPicker} style={{ width: 'auto', margin: 0 }} title="Send exact vehicle photos">
            <option value="">Send vehicle...</option>
            {pickList.map((v) => <option key={v.id} value={v.id}>{v.stock_no} {v.model_year || ''} {v.brand || ''} {v.model || ''}</option>)}
          </select>
          {active.mode !== 'human' ? <button className="btn-success" disabled={busy} onClick={aiNow}>AI Reply Now</button> : null}
          {active.mode !== 'human' ? <button className="btn-warning" disabled={busy} onClick={() => setMode('human')}>Take Over</button> : <button className="btn-success" disabled={busy} onClick={() => setMode('ai')}>Return to AI</button>}
          {replyLeft > 0 ? <button className="btn-neutral" disabled={busy} onClick={cancelAiReply}>Cancel AI reply</button> : null}
          <button type="button" className="drawerToggle" onClick={() => setShowDrawer((s) => !s)}>{showDrawer ? 'Hide details' : 'Details'}</button>
          <div className="quickMenu">
            <button type="button" className="btn-neutral" onClick={() => setShowMore((s) => !s)}>...</button>
            {showMore ? <div>
              <button type="button" onClick={() => { setShowMore(false); void markRead(); }}>Mark read</button>
              <button type="button" onClick={() => { setShowMore(false); void markUnread(); }}>Mark unread</button>
              <button type="button" onClick={() => { setShowMore(false); void setMode('paused'); }}>Pause AI for 15 min</button>
              <button type="button" onClick={() => { setShowMore(false); void archiveOne(); }}>{archived ? 'Restore to inbox' : 'Archive conversation'}</button>
              <button type="button" onClick={() => { setShowMore(false); void clearCurrentCar(); }}>Clear current vehicle</button>
              <button type="button" onClick={() => { setShowMore(false); void resetWelcome(); }}>Reset welcome</button>
              <button type="button" onClick={() => { setShowMore(false); void quick('sold'); }}>Vehicle sold</button>
              <button type="button" onClick={() => { setShowMore(false); void quick('not_available'); }}>Vehicle not available</button>
              <button type="button" onClick={() => { setShowMore(false); void deleteOne(); }}>Delete conversation (owner)</button>
            </div> : null}
          </div>
        </div>
      </div>

      <div className="messages" ref={scrollBox} onScroll={onScroll}>
        {msgs.map((m, i) => {
          const day = dayLabel(m.created_at, now);
          const prevDay = i ? dayLabel(msgs[i - 1].created_at, now) : '';
          const ds = deliveryState(m);
          const who = String(m.sender) === 'customer' ? 'CUSTOMER' : String(m.sender) === 'ai' ? 'AI' : String(m.sender) === 'human' ? 'STAFF' : 'SYSTEM';
          return <div key={m.id}>
            {day && day !== prevDay ? <div className="daySep">{day}</div> : null}
            <div className={'bubble ' + (String(m.sender) === 'customer' ? 'customer' : 'agent')}>
              <small>{who}{m.message_type && m.message_type !== 'text' ? ' | ' + String(m.message_type).toUpperCase() : ''}{ds ? ' | ' + ds.label.toUpperCase() : ''}</small>
              {m.media_url && m.message_type === 'image' ? <button type="button" className="mediaThumb" onClick={() => setLightbox(mediaSrc(m))} title="Click to enlarge"><img src={mediaSrc(m)} alt="Photo in this conversation (admin only)" loading="lazy" /></button> : null}
              {m.media_url && m.message_type === 'audio' ? <audio controls preload="none" src={mediaSrc(m)} /> : null}
              {m.media_url && m.message_type === 'video' ? <video controls preload="none" src={mediaSrc(m)} /> : null}
              {m.media_url && m.message_type === 'document' ? <a className="btn-neutral" style={{ marginTop: 6 }} href={mediaSrc(m)} target="_blank" rel="noreferrer">Open document</a> : null}
              <div style={{ whiteSpace: 'pre-wrap' }}>{linkify(m.body) || (m.media_url ? `[${m.message_type}]` : '')}</div>
              {ds?.reason ? <div className="error" style={{ fontSize: 12 }}>failed: {ds.reason}</div> : null}
              <time>{new Date(m.created_at).toLocaleString()}</time>
            </div>
          </div>;
        })}
        <div ref={bottom} />
      </div>
      {newBelow > 0 ? <button className="miniBtn" style={{ margin: '6px 16px' }} onClick={() => { bottom.current?.scrollIntoView({ block: 'end' }); setAtBottom(true); setNewBelow(0); }}>New messages ({newBelow})</button> : null}

      {(err || ok) && <div style={{ padding: '0 16px' }}>{err && <p className="error">{err}</p>}{ok && <p style={{ color: '#08733d', fontWeight: 800 }}>{ok}</p>}</div>}

      <form className="replyBox" onSubmit={send}>
        <div className="replyCol">
          <div className="quickMenu">
            <button type="button" className="miniBtn" onClick={() => setShowQuick((s) => !s)}>Quick replies ▾</button>
            {showQuick ? <div>
              <button type="button" onClick={() => insert('Yes, it is available.')}>Available</button>
              <button type="button" onClick={() => insert('Which country should we ship it to?')}>Ask destination</button>
              <button type="button" onClick={() => insert('What is your budget?')}>Ask budget</button>
              <button type="button" onClick={() => insert('One moment please, I am checking now.')}>Checking</button>
              <button type="button" onClick={() => insert(`You can see all our cars here: ${links.site}`)}>Send website</button>
              <button type="button" onClick={() => insert(`${links.group_name || 'Sky second hand cars'}: ${links.group_link || ''}`.trim())}>Send group link</button>
            </div> : null}
          </div>
          <textarea value={text} onChange={(e) => setText(e.target.value)} placeholder="Type a reply..." />
        </div>
        <button className="btn" disabled={busy || !text.trim()}>Send</button>
      </form>
    </>}</section>

    {active && showDrawer ? <aside className="contextDrawer">
      <h3>Customer details</h3>
      <div className="customerSummary">
        <b>{active.full_name || active.phone || active.external_user_id}</b>
        <small>{active.phone || active.external_user_id}</small>
        <small>{memory.country || 'Country unknown'}{memory.preferred_language ? ` | ${memory.preferred_language}` : ''}</small>
        <small>Current: {state?.current_stock_no || 'none set'}</small>
        <small>Status: {modeChip(active.mode)}{isPaused(active, now) ? ` (paused ${countdown(pauseSecondsLeft(active, now))})` : ''}</small>
        <small>Welcome: {welcome?.sent_at ? new Date(welcome.sent_at).toLocaleDateString() : 'Not sent'}</small>
        {queueLabel ? <small>AI queue: {queueLabel}{state?.pending_ai_reply_at ? ` (due ${new Date(String(state.pending_ai_reply_at).replace(' ', 'T')).toLocaleTimeString()})` : ''}{Number(state?.pending_attempts) ? ` | attempts ${state.pending_attempts}` : ''}</small> : (state?.pending_last_result ? <small>AI queue: {String(state.pending_last_result).slice(0, 80)}</small> : null)}
        <small>{preferredToCode(memory.preferred_language) ? `Language: ${languageName(preferredToCode(memory.preferred_language) as LangCode)}` : state?.slots?.detected_language ? `Detected language: ${languageName(state.slots.detected_language as LangCode)}` : 'Language: not detected yet'}</small>
      </div>
      <div className="contextBlock">
        <b>Current car</b>
        <div className="contextRow" style={{ marginTop: 6 }}>
          <select value={pickId} onChange={(e) => setPickId(e.target.value)} onFocus={openPicker}>
            <option value="">Choose a vehicle...</option>
            {pickList.map((v) => <option key={v.id} value={v.id}>{v.stock_no} {v.model_year || ''} {v.brand || ''} {v.model || ''}</option>)}
          </select>
          <button type="button" className="miniBtn" disabled={!pickId} onClick={() => setCurrentCar(Number(pickId))}>Use</button>
          <button type="button" className="miniBtn" disabled={!pickId} onClick={() => sendPhotos(Number(pickId))}>Send exact photos</button>
          <button type="button" className="miniBtn" onClick={clearCurrentCar}>Clear</button>
        </div>
      </div>
      {state?.slots && Object.keys(state.slots).length ? <div className="contextBlock"><b>Known answers</b><p className="muted">{Object.entries(state.slots).map(([k, v]) => `${k}: ${v}`).join(' | ')}</p></div> : null}
      {referrals.length ? <div className="contextBlock"><b>Facebook referral</b>{referrals.slice(0, 3).map((r) => {
        const mismatch = r.matched_vehicle_id ? referralLooksMismatched(`${r.headline || ''} ${r.body || ''}`, { brand: r.resolved_brand, model: r.resolved_model, trim_name: r.resolved_trim }) : false;
        return <div key={r.id} className={'refCard' + (r.matched_vehicle_id && mismatch ? ' refWarn' : '')}>
          <small>{r.source_type || 'post'} | {r.match_method || 'unmatched'}</small>
          <p><b>Facebook referral:</b> {r.headline || r.body || r.source_id || '(no headline)'}</p>
          <p>{r.matched_vehicle_id
            ? <><b>Resolved vehicle:</b> {r.resolved_vehicle || `#${r.matched_vehicle_id}`}{r.resolved_stock_no ? ` (stock ${r.resolved_stock_no})` : ''}{mismatch ? <em className="refMismatch"> - check this match</em> : null}</>
            : <em className="refMismatch">Not resolved - the AI will ask which vehicle.</em>}</p>
          <select defaultValue="" onChange={(e) => { const v = Number(e.target.value); if (v) correctReferral(r, v); }}>
            <option value="">Correct this referral to...</option>
            {pickList.map((v) => <option key={v.id} value={v.id}>{v.stock_no} {v.model_year || ''} {v.brand || ''} {v.model || ''}</option>)}
          </select>
        </div>;
      })}</div> : null}
      <div className="contextBlock">
        <label>Country<input value={memory.country} onChange={(e) => setMemory({ ...memory, country: e.target.value })} /></label>
        <label>Preferred language<input value={memory.preferred_language} onChange={(e) => setMemory({ ...memory, preferred_language: e.target.value })} /></label>
        {memory.memory_summary ? <div className="memorySummary"><b>Assistant memory</b><p>{memory.memory_summary}</p></div> : null}
        <label>Notes<textarea value={memory.notes} onChange={(e) => setMemory({ ...memory, notes: e.target.value })} /></label>
        <button type="button" className="miniBtn" onClick={saveMemory}>Save notes</button> <span className="muted">{memoryMsg}</span>
      </div>
    </aside> : null}
    {lightbox ? <div className="lightbox" onClick={() => setLightbox('')} role="dialog" aria-label="Photo">
      <img src={lightbox} alt="Enlarged photo" />
      <button type="button" className="btn-neutral" style={{ position: 'absolute', top: 18, right: 18 }} onClick={() => setLightbox('')}>Close</button>
    </div> : null}
  </div>;
}

/** Stored media reference: our own media proxy for Meta ids, otherwise the saved URL (never a supplier URL). */
function mediaSrc(m: any) {
  const u = String(m?.media_url || '');
  return u.startsWith('meta:') ? `/api/admin/conversations/media/${m.id}` : u;
}

function linkify(body?: string | null) {
  const s = String(body || '');
  if (!s) return '';
  return s.split(/(https?:\/\/[^\s]+)/g).map((p, i) => (/^https?:\/\//.test(p) ? <a key={i} href={p} target="_blank" rel="noopener noreferrer">{p}</a> : p));
}
