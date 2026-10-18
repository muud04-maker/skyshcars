'use client';
import { useCallback, useEffect, useState } from 'react';

/*
  The staff queue (brief items 87-89, 104-105). Each card is a real stored task; a human moves it
  forward and the completion is recorded. No automatic message is ever sent from here.
*/
const LABEL: Record<string, string> = { photo: 'Photos requested', freight: 'Freight quote', sourcing: 'Source a vehicle', follow_up: 'Follow up', serious_buyer: 'Serious buyer' };
const when = (v: any) => (v ? new Date(String(v).replace(' ', 'T')).toLocaleString() : '-');

export default function StaffTasksClient() {
  const [status, setStatus] = useState('pending');
  const [type, setType] = useState('');
  const [tasks, setTasks] = useState<any[]>([]);
  const [stats, setStats] = useState<any>({});
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [notes, setNotes] = useState<Record<number, string>>({});

  const load = useCallback(async () => {
    const qs = new URLSearchParams({ status, limit: '120' });
    if (type) qs.set('type', type);
    const r = await fetch('/api/admin/staff-tasks?' + qs, { cache: 'no-store' });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) { setMsg(j.error || 'Could not load tasks'); return; }
    setTasks(j.tasks || []); setStats(j.stats || {});
  }, [status, type]);
  useEffect(() => { void load(); }, [load]);

  async function act(id: number, action: string) {
    setBusy(true); setMsg('');
    const r = await fetch('/api/admin/staff-tasks', { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id, action, notes: notes[id] || null }) });
    const j = await r.json().catch(() => ({}));
    setBusy(false);
    if (!r.ok) { setMsg(j.error || 'Could not update'); return; }
    if (j.stats) setStats(j.stats);
    setMsg(action === 'done' ? 'Marked done.' : action === 'decline' ? 'Declined.' : 'Updated.');
    await load();
  }

  return <>
    <div className="chTools">
      <label>Status<select value={status} onChange={(e) => setStatus(e.target.value)}>
        <option value="pending">Pending</option><option value="in_progress">In progress</option>
        <option value="done">Done</option><option value="declined">Declined</option><option value="all">All</option>
      </select></label>
      <label>Type<select value={type} onChange={(e) => setType(e.target.value)}>
        <option value="">All types</option>
        {Object.keys(LABEL).map((k) => <option key={k} value={k}>{LABEL[k]}</option>)}
      </select></label>
      <button type="button" className="btn" onClick={() => void load()}>Refresh</button>
    </div>
    <p className="muted">
      {stats.pending || 0} pending · {stats.in_progress || 0} in progress · {stats.done || 0} done · {stats.declined || 0} declined
      {' '}| open photos {stats.photos_open || 0} · freight {stats.freight_open || 0} · sourcing {stats.sourcing_open || 0}
    </p>
    {msg ? <div className="setupAlert">{msg}</div> : null}
    <div className="chList">
      {tasks.length ? tasks.map((t) => (
        <div className="chCard" key={t.id}>
          <h3>{LABEL[t.request_type] || t.request_type} · <span className={'learnStatus ' + (t.status === 'done' ? 'applied' : t.status === 'declined' ? 'rejected' : 'pending')}>{t.status}</span></h3>
          <div className="chKV">
            <b>Customer</b><span>{t.customer_name || (t.customer_id ? `#${t.customer_id}` : '-')}{t.channel ? ` · ${t.channel}` : ''}</span>
            <b>Vehicle</b><span>{[t.model_year, t.brand, t.model].filter(Boolean).join(' ') || '-'}{t.stock_no ? ` · stock ${t.stock_no}` : ''}</span>
            <b>Reason</b><span>{t.reason || '-'}</span>
            <b>Opened</b><span>{when(t.created_at)}</span>
            {t.handled_by ? <><b>Handled by</b><span>{t.handled_by}</span></> : null}
          </div>
          <div className="chInline" style={{ marginTop: 8 }}>
            <input placeholder="What did you do? (optional note)" value={notes[t.id] || ''} onChange={(e) => setNotes({ ...notes, [t.id]: e.target.value })} />
            {t.conversation_id ? <a className="miniBtn" href={'/admin/whatsapp?conversation=' + t.conversation_id}>Open chat</a> : null}
            {t.status === 'pending' ? <button type="button" className="miniBtn" disabled={busy} onClick={() => act(t.id, 'start')}>Start</button> : null}
            {t.status !== 'done' ? <button type="button" className="miniBtn" disabled={busy} onClick={() => act(t.id, 'done')}>Mark done</button> : null}
            {t.status === 'pending' || t.status === 'in_progress' ? <button type="button" className="miniBtn danger" disabled={busy} onClick={() => act(t.id, 'decline')}>Decline</button> : null}
            {t.status === 'done' || t.status === 'declined' ? <button type="button" className="miniBtn" disabled={busy} onClick={() => act(t.id, 'reopen')}>Reopen</button> : null}
          </div>
        </div>
      )) : <p className="muted">Nothing here. New photo, freight, sourcing and serious-buyer requests appear automatically.</p>}
    </div>
  </>;
}
