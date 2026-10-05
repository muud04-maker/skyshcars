'use client';
import { useEffect, useMemo, useState } from 'react';
import NeedsSetup from '../_components/NeedsSetup';

type Photo = { id: number; url: string; publicUrl: string; exact: boolean; sendable: boolean; reason: string | null; isCover: boolean };
type Vehicle = { id: number; stock_no: string; title: string; exactCount: number; sendableCount: number; photos: Photo[] };
const post = (body: any) => fetch('/api/admin/photo-check', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

export default function PhotoCheckClient() {
  const [list, setList] = useState<Vehicle[] | null>(null), [setup, setSetup] = useState(false), [waReady, setWaReady] = useState(true);
  const [filter, setFilter] = useState<'all' | 'none' | 'ok'>('none'), [q, setQ] = useState('');
  const [reach, setReach] = useState<Record<string, any>>({}), [busy, setBusy] = useState<number | null>(null);
  const [phone, setPhone] = useState(''), [msg, setMsg] = useState('');

  async function load() {
    const r = await fetch('/api/admin/photo-check', { cache: 'no-store' });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) { setSetup(true); setList([]); return; }
    setList(j.vehicles || []); setWaReady(!!j.whatsappReady);
  }
  useEffect(() => { load(); }, []);

  async function checkReach(v: Vehicle) {
    setBusy(v.id);
    const j = await (await post({ action: 'reach', urls: v.photos.filter(p => p.exact && p.publicUrl).map(p => p.publicUrl) })).json().catch(() => ({}));
    setReach(x => ({ ...x, ...(j.results || {}) })); setBusy(null);
  }
  async function sendTest(p: Photo) {
    if (!phone.trim()) { setMsg('Type your admin phone number at the top first.'); return; }
    setMsg('Sending…');
    const r = await post({ action: 'send', mediaId: p.id, phone });
    const j = await r.json().catch(() => ({}));
    setMsg(r.ok ? `Sent. WhatsApp accepted the photo (message ${j.messageId || 'id unknown'}). Check the phone.` : j.error || 'Send failed');
  }

  const shown = useMemo(() => (list || []).filter(v =>
    (filter === 'all' || (filter === 'none' ? v.sendableCount === 0 : v.sendableCount > 0)) &&
    (!q || (v.title + ' ' + v.stock_no).toLowerCase().includes(q.toLowerCase()))), [list, filter, q]);

  if (list === null) return <p>Loading…</p>;
  if (setup) return <NeedsSetup what="Photo Check" />;
  const none = list.filter(v => v.sendableCount === 0).length;
  return <>
    <div className="card">
      <p><b>{list.length}</b> Available vehicles · <b className={none ? 'bad' : 'ok'}>{none}</b> with no photo the AI can send.</p>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <select value={filter} onChange={e => setFilter(e.target.value as any)}>
          <option value="none">No sendable photo</option><option value="ok">Has sendable photos</option><option value="all">All</option>
        </select>
        <input placeholder="Search model or stock no." value={q} onChange={e => setQ(e.target.value)} />
        <input placeholder="Your admin phone for test sends, e.g. 2526xxxxxxx" value={phone} onChange={e => setPhone(e.target.value)} style={{ minWidth: 280 }} />
      </div>
      <p className="muted">Test photos go only to the number typed here, never to a customer. WhatsApp delivers them only if that phone messaged the business number in the last 24 hours.</p>
      {!waReady && <NeedsSetup what="Test sending" />}
      {msg && <p><b>{msg}</b></p>}
    </div>
    {shown.map(v => <div className="card" key={v.id} style={{ marginTop: 10 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
        <div><b>{v.title}</b> <span className="muted">{v.stock_no} · <a href={`/vehicles/${v.id}`} target="_blank" rel="noreferrer">listing ↗</a></span><br />
          Exact photos: <b>{v.exactCount}</b> · Sendable on WhatsApp: <b className={v.sendableCount ? 'ok' : 'bad'}>{v.sendableCount}</b> · Other photos: {v.photos.length - v.exactCount}</div>
        {v.exactCount > 0 && <button className="miniBtn" disabled={busy === v.id} onClick={() => checkReach(v)}>{busy === v.id ? 'Checking…' : 'Check WhatsApp can reach photos'}</button>}
      </div>
      {!v.photos.length && <p className="muted">No photos at all. Upload exact photos in Vehicle Photos.</p>}
      <div style={{ display: 'grid', gap: 6, marginTop: 8 }}>
        {v.photos.map(p => {
          const r = reach[p.publicUrl];
          return <div key={p.id} style={{ display: 'flex', gap: 10, alignItems: 'center', borderTop: '1px solid #e5ecf2', paddingTop: 6 }}>
            <img src={p.url.startsWith('http') ? `/api/photo/${p.id}` : p.url} alt="" style={{ width: 64, height: 48, objectFit: 'cover', borderRadius: 4, background: '#eee' }} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div>{p.sendable ? <b className="ok">Exact · will be sent</b> : p.exact ? <b className="bad">Exact but not sendable: {p.reason}</b> : <span className="bad">Rejected: {p.reason}</span>}{p.isCover ? ' · cover' : ''}</div>
              <small className="muted" style={{ wordBreak: 'break-all' }}>{p.publicUrl || p.url || '(empty URL)'}</small>
              {r && <div><small className={r.ok ? 'ok' : 'bad'}>{r.ok ? `Reachable by WhatsApp (${r.type}, ${Math.round((r.bytes || 0) / 1024)} KB)` : `Not reachable: ${r.reason}`}</small></div>}
            </div>
            {p.exact && <button className="miniBtn" onClick={() => sendTest(p)}>Send test to my phone</button>}
          </div>;
        })}
      </div>
    </div>)}
    {!shown.length && <p className="muted">Nothing matches this filter.</p>}
  </>;
}
