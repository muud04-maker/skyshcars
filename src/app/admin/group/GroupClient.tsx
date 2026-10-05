'use client';
import { useEffect, useState } from 'react';
import NeedsSetup from '../_components/NeedsSetup';

const fmt = (v: any) => { try { return new Date(v).toLocaleString(); } catch { return String(v || ''); } };

function Pager({ page, size, total, onPage }: { page: number; size: number; total: number; onPage: (p: number) => void }) {
  const pages = Math.max(1, Math.ceil(total / size));
  return <div style={{ display: 'flex', gap: 8, alignItems: 'center', margin: '10px 0' }}>
    <button className="miniBtn" disabled={page <= 1} onClick={() => onPage(page - 1)}>← Newer</button>
    <span className="muted">Page {page} of {pages} · {total} total</span>
    <button className="miniBtn" disabled={page >= pages} onClick={() => onPage(page + 1)}>Older →</button>
  </div>;
}

export default function GroupClient() {
  const [tab, setTab] = useState<'chat' | 'members'>('chat');
  const [q, setQ] = useState(''), [query, setQuery] = useState(''), [group, setGroup] = useState(''), [questions, setQuestions] = useState(false);
  const [member, setMember] = useState<{ id: number; label: string } | null>(null);
  const [page, setPage] = useState(1), [data, setData] = useState<any>(null), [setup, setSetup] = useState(false);

  useEffect(() => {
    const params = new URLSearchParams({ page: String(page) });
    if (tab === 'members') params.set('view', 'members');
    if (query) params.set('q', query);
    if (tab === 'chat') { if (group) params.set('group', group); if (questions) params.set('questions', '1'); if (member) params.set('member', String(member.id)); }
    fetch('/api/admin/group?' + params, { cache: 'no-store' }).then(async r => { if (!r.ok) { setSetup(true); return; } setData(await r.json()); }).catch(() => setSetup(true));
  }, [tab, query, group, questions, member, page]);

  if (setup) return <NeedsSetup what="Group log" />;
  const go = (fn: () => void) => { fn(); setPage(1); };
  return <>
    <div className="card" style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
      <button className={tab === 'chat' ? 'btn' : 'miniBtn'} onClick={() => go(() => setTab('chat'))}>Full chat</button>
      <button className={tab === 'members' ? 'btn' : 'miniBtn'} onClick={() => go(() => setTab('members'))}>Members</button>
      <form onSubmit={e => { e.preventDefault(); go(() => setQuery(q.trim())); }} style={{ display: 'flex', gap: 6 }}>
        <input placeholder={tab === 'chat' ? 'Search text, name or phone' : 'Search name or phone'} value={q} onChange={e => setQ(e.target.value)} />
        <button className="miniBtn">Search</button>
      </form>
      {tab === 'chat' && <>
        <select value={group} onChange={e => go(() => setGroup(e.target.value))}>
          <option value="">All groups</option>
          {(data?.groups || []).map((g: any) => <option key={g.group_name} value={g.group_name}>{g.group_name} ({g.n})</option>)}
        </select>
        <label><input type="checkbox" checked={questions} onChange={e => go(() => setQuestions(e.target.checked))} /> Questions only</label>
        {member && <span className="muted">Member: <b>{member.label}</b> <button className="miniBtn" onClick={() => go(() => setMember(null))}>× clear</button></span>}
      </>}
    </div>
    {!data ? <p>Loading…</p> : tab === 'members' ? <>
      <Pager page={data.page} size={data.size} total={data.total} onPage={setPage} />
      <div className="card" style={{ overflowX: 'auto' }}>
        <table className="adminTable"><thead><tr><th>Name</th><th>Phone</th><th>First seen</th><th>Last seen</th><th>Messages</th><th>Questions</th><th>Customer</th><th></th></tr></thead>
          <tbody>{(data.members || []).map((m: any) => <tr key={m.id}>
            <td>{m.name || '—'}</td><td>{m.phone ? '+' + m.phone : <span className="muted">hidden by WhatsApp</span>}</td>
            <td>{fmt(m.first_seen_at)}</td><td>{fmt(m.last_seen_at)}</td><td>{m.message_count}</td><td>{m.questions}</td>
            <td>{m.customer_id ? <a href={`/admin/customers?id=${m.customer_id}`}>#{m.customer_id}</a> : '—'}</td>
            <td><button className="miniBtn" onClick={() => { setTab('chat'); setMember({ id: m.id, label: m.name || m.phone || 'member' }); setPage(1); }}>Messages</button></td>
          </tr>)}</tbody></table>
        {!data.members?.length && <p className="muted">No members logged yet.</p>}
      </div>
    </> : <>
      <Pager page={data.page} size={data.size} total={data.total} onPage={setPage} />
      <div style={{ display: 'grid', gap: 6 }}>
        {(data.messages || []).map((m: any) => <div key={m.id} className="card" style={{ padding: 10, borderLeft: m.is_question ? '4px solid #e0a100' : m.is_listing ? '4px solid #1f8a4c' : '4px solid transparent', background: m.is_question ? '#fff8e1' : undefined }}>
          <div className="muted" style={{ fontSize: 13 }}>
            <b>{m.from_me ? 'Sky Cars (us)' : m.sender_name || 'Unknown'}</b>{m.sender_phone ? ` · +${m.sender_phone}` : ''} · {m.group_name} · {fmt(m.sent_at)}
            {m.is_question ? <b style={{ color: '#a06b00' }}> · QUESTION</b> : null}
            {m.is_listing ? <b className="ok"> · LISTING{m.import_item_id ? ` → Inventory Review #${m.import_item_id}` : ''}</b> : null}
          </div>
          {m.body && <div style={{ whiteSpace: 'pre-wrap', marginTop: 4 }}>{m.body}</div>}
          {m.photo_urls && <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 6 }}>
            {String(m.photo_urls).split('\n').map((u: string) => <a key={u} href={u} target="_blank" rel="noreferrer"><img src={u} alt="" style={{ width: 96, height: 72, objectFit: 'cover', borderRadius: 4 }} /></a>)}
          </div>}
          {!m.body && !m.photo_urls && <div className="muted">({m.message_type})</div>}
        </div>)}
        {!data.messages?.length && <p className="muted">No messages yet. They appear here once the Group Reader is online.</p>}
      </div>
      <Pager page={data.page} size={data.size} total={data.total} onPage={setPage} />
    </>}
  </>;
}
