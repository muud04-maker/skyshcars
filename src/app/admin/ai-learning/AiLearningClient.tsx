'use client';
import { useCallback, useEffect, useState } from 'react';

/*
  AI Learning Center (Parts 7, 9, 12, 20).
  Cards on a phone, table-free: customer question -> AI reply -> staff correction -> reason -> status,
  with Approve / Reject / Edit / Apply. Approving makes a lesson usable context; Applying turns an
  approved lesson into its permanent form (referral mapping, business knowledge or prompt context).
*/
const TYPES = [
  'wrong_vehicle', 'wrong_price', 'wrong_category', 'wrong_language', 'wrong_shipping_answer',
  'missing_information', 'bad_tone', 'referral_correction', 'better_sales_reply', 'business_rule',
  'unnecessary_hold', 'bad_recommendation', 'good_reply', 'other',
];
const label = (t: string) => String(t || '').replace(/_/g, ' ');
const when = (v: any) => (v ? new Date(String(v).replace(' ', 'T')).toLocaleString() : '-');

export default function AiLearningClient() {
  const [status, setStatus] = useState('pending');
  const [type, setType] = useState('');
  const [q, setQ] = useState('');
  const [events, setEvents] = useState<any[]>([]);
  const [stats, setStats] = useState<any>({ pending: 0, approved: 0, applied: 0, rejected: 0, total: 0 });
  const [editing, setEditing] = useState<number | null>(null);
  const [draft, setDraft] = useState<{ lesson: string; applies_to: string }>({ lesson: '', applies_to: 'global' });
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  // GOAL 3: today's real human sales patterns (suggestions only - never automatic rules).
  const [patterns, setPatterns] = useState<any>(null);

  const load = useCallback(async () => {
    const qs = new URLSearchParams({ status, limit: '80' });
    if (type) qs.set('type', type);
    if (q) qs.set('q', q);
    const r = await fetch('/api/admin/ai-learning?' + qs, { cache: 'no-store' });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) { setMsg(j.error || 'Could not load lessons'); return; }
    setEvents(j.events || []);
    setStats(j.stats || {});
    if (j.patterns) setPatterns(j.patterns);
  }, [status, type, q]);

  useEffect(() => { void (async () => {
    const r = await fetch('/api/admin/ai-learning?patterns=1&status=&limit=1', { cache: 'no-store' });
    const j = await r.json().catch(() => ({}));
    if (r.ok && j.patterns) setPatterns(j.patterns);
  })(); }, []);

  /** A suggestion becomes a PENDING lesson: the admin still has to approve and apply it. */
  async function addSuggested(text: string) {
    setBusy(true); setMsg('');
    const r = await fetch('/api/admin/ai-learning', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'create', event_type: 'business_rule', reason: 'suggested from today\'s sales patterns', lesson: text }),
    });
    const j = await r.json().catch(() => ({}));
    setBusy(false);
    setMsg(r.ok ? 'Suggestion saved as a pending lesson - approve it to make it official.' : (j.error || 'Could not save the suggestion'));
    if (r.ok) await load();
  }

  useEffect(() => { void load(); }, [load]);

  async function review(id: number, action: string, extra: any = {}) {
    setBusy(true); setMsg('');
    const r = await fetch(`/api/admin/ai-learning/${id}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action, ...extra }) });
    const j = await r.json().catch(() => ({}));
    setBusy(false);
    if (!r.ok) { setMsg(j.error || 'Could not save'); return; }
    setMsg(action === 'apply' ? `Applied (${j.applied_ref || 'saved'}).` : `Lesson ${j.status}.`);
    setEditing(null);
    await load();
  }

  return <>
    <div className="chTools">
      <label>Status<select value={status} onChange={(e) => setStatus(e.target.value)}>
        <option value="pending">Pending</option><option value="approved">Approved</option>
        <option value="applied">Applied</option><option value="rejected">Rejected</option><option value="">All</option>
      </select></label>
      <label>Type<select value={type} onChange={(e) => setType(e.target.value)}>
        <option value="">All types</option>
        {TYPES.map((t) => <option key={t} value={t}>{label(t)}</option>)}
      </select></label>
      <label className="wide">Search<input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search the question, reply or correction" /></label>
      <button type="button" className="btn" onClick={() => void load()}>Refresh</button>
      <a className="btn" href={`/api/admin/ai-learning/export?status=${status || ''}${type ? `&type=${type}` : ''}`}>Download AI Learning (.txt)</a>
    </div>
    <p className="muted">{stats.pending || 0} pending | {stats.approved || 0} approved | {stats.applied || 0} applied | {stats.rejected || 0} rejected</p>
    {msg ? <div className="setupAlert">{msg}</div> : null}

    {patterns ? <div className="chCard" style={{ marginBottom: 14 }}>
      <h3>Today's Human Sales Patterns ({patterns.day})</h3>
      <p className="muted" style={{ marginTop: 0 }}>Counted from today's real conversations and the answers staff actually gave. These are hints for context only - they never become rules without your approval, and they can never override an exact referral, stock or price.</p>
      {patterns.groups?.length ? patterns.groups.map((g: any) => (
        <div key={g.type} style={{ marginBottom: 8 }}>
          <b style={{ fontSize: 12 }}>{g.label}</b>
          <div className="chCodes">{g.items.map((it: any) => <em key={it.key} title={`confidence ${Math.round(it.confidence * 100)}%`}>{it.value || it.key} ({it.count})</em>)}</div>
        </div>
      )) : <p className="muted">Nothing recorded yet today. The learner runs daily (and can be run now with the cron endpoint).</p>}
      {patterns.suggested?.length ? <div style={{ marginTop: 10 }}>
        <b style={{ fontSize: 12 }}>Suggested lessons (need your approval)</b>
        {patterns.suggested.map((s: string, i: number) => (
          <div className="chFact" key={i}><span style={{ maxWidth: 700 }}>{s}</span>
            <button type="button" className="miniBtn" disabled={busy} onClick={() => void addSuggested(s)}>Add as lesson</button>
          </div>
        ))}
      </div> : null}
    </div> : null}

    {events.length ? events.map((e) => (
      <div className={'learnCard ' + e.status} key={e.id}>
        <h4><span className={'learnStatus ' + e.status}>{e.status}</span> {label(e.event_type)}
          {e.customer_name ? ` | ${e.customer_name}` : ''}{e.channel ? ` | ${e.channel === 'facebook' ? 'Messenger' : e.channel}` : ''}
          {e.applies_to === 'customer' ? ' | this customer only' : ''}
        </h4>
        <small className="muted">{when(e.created_at)}{e.created_by ? ` | raised by ${e.created_by}` : ''}{e.reason ? ` | ${e.reason}` : ''}</small>
        {e.question ? <div className="learnBlock"><b>Customer question</b>{e.question}</div> : null}
        {e.ai_reply ? <div className="learnBlock"><b>AI reply</b>{e.ai_reply}</div> : null}
        {e.correction ? <div className="learnBlock"><b>Staff correction</b>{e.correction}</div> : null}
        {editing === e.id
          ? <div className="learnBlock">
            <b>Lesson the AI should follow</b>
            <textarea rows={3} value={draft.lesson} onChange={(ev) => setDraft({ ...draft, lesson: ev.target.value })} placeholder="e.g. A motorcycle ad must never be answered with a car of the same brand." />
            <div className="chInline" style={{ marginTop: 6 }}>
              <select value={draft.applies_to} onChange={(ev) => setDraft({ ...draft, applies_to: ev.target.value })}>
                <option value="global">Global (all customers)</option>
                <option value="customer">This customer only</option>
              </select>
            </div>
          </div>
          : (e.lesson ? <div className="learnBlock"><b>Lesson</b>{e.lesson}</div> : null)}
        {e.applied_ref ? <small className="muted">Applied as: {e.applied_ref} {e.applied_at ? `| ${when(e.applied_at)}` : ''}</small> : null}
        <div className="chInline" style={{ marginTop: 8 }}>
          {e.status === 'pending' ? <button type="button" className="miniBtn" disabled={busy} onClick={() => review(e.id, 'approve', editing === e.id ? draft : {})}>Approve</button> : null}
          {e.status === 'pending' ? <button type="button" className="miniBtn danger" disabled={busy} onClick={() => review(e.id, 'reject')}>Reject</button> : null}
          {e.status === 'rejected' ? <button type="button" className="miniBtn" disabled={busy} onClick={() => review(e.id, 'reopen')}>Reopen</button> : null}
          {e.status === 'approved' ? <button type="button" className="miniBtn" disabled={busy} onClick={() => review(e.id, 'apply')}>Apply</button> : null}
          {e.status !== 'applied' ? (editing === e.id
            ? <button type="button" className="miniBtn" disabled={busy} onClick={() => review(e.id, e.status === 'pending' ? 'approve' : 'approve', draft)}>Save lesson</button>
            : <button type="button" className="miniBtn" disabled={busy} onClick={() => { setEditing(e.id); setDraft({ lesson: e.lesson || '', applies_to: e.applies_to || 'global' }); }}>Edit</button>) : null}
          {e.conversation_id ? <a className="miniBtn" href="/admin/whatsapp">Open inbox</a> : null}
        </div>
      </div>
    )) : <p className="muted">Nothing here yet. Use the &#128077; / &#128078; buttons on any AI reply in the inbox, or mark a staff reply as the correction.</p>}
  </>;
}
