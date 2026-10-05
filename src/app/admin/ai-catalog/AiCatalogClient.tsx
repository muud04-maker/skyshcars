'use client';
import { useEffect, useState } from 'react';
import NeedsSetup from '../_components/NeedsSetup';

type Car = { id: number; stock_no: string; brand: string; model: string; trim_name: string; model_year: number; price_usd: number | null; exact_photo_count: number; created_at: string; ai_enabled: boolean; cover: string | null };
const post = (body: any) => fetch('/api/admin/ai-catalog', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then(r => r.json().catch(() => ({})));

export default function AiCatalogClient() {
  const [data, setData] = useState<any>(null), [setup, setSetup] = useState(false);
  const [q, setQ] = useState(''), [filter, setFilter] = useState('all'), [days, setDays] = useState(''), [n, setN] = useState('3'), [msg, setMsg] = useState('');
  async function load() {
    const p = new URLSearchParams({ q, filter, days });
    const r = await fetch('/api/admin/ai-catalog?' + p, { cache: 'no-store' });
    if (!r.ok) { setSetup(true); return; }
    setData(await r.json());
  }
  useEffect(() => { load(); }, [filter, days]);
  async function act(body: any, confirmText?: string) {
    if (confirmText && !confirm(confirmText)) return;
    setMsg('Saving…');
    const j = await post(body);
    setMsg(j.error || (j.changed != null ? `Done: ${j.changed} car(s) changed.` : 'Saved.'));
    load();
  }
  if (setup) return <NeedsSetup what="AI Catalog" />;
  if (!data) return <p>Loading…</p>;
  const c = data.counts, all = c.mode === 'all';
  return <>
    <div className="card">
      <h2 style={{ marginTop: 0 }}>AI sells {c.aiCount} of {c.availableCount} cars</h2>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <b>Mode:</b>
        <button className={!all ? 'btn' : 'miniBtn'} onClick={() => act({ action: 'mode', mode: 'selected' })}>Only cars switched on (recommended)</button>
        <button className={all ? 'btn' : 'miniBtn'} onClick={() => act({ action: 'mode', mode: 'all' }, 'In "all" mode the AI may offer EVERY Available car, including old stock. Continue?')}>All Available cars</button>
      </div>
      {all && <p className="setupAlert" style={{ marginTop: 10 }}><b>Warning:</b> the AI can currently offer every Available car, including old stock. The on/off switches below are ignored in this mode.</p>}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginTop: 12 }}>
        <span>Only cars added in the last</span><input style={{ width: 60 }} type="number" min={1} value={n} onChange={e => setN(e.target.value)} /><span>days</span>
        <button className="miniBtn" onClick={() => act({ action: 'only_recent', days: Number(n) }, `Switch ON only cars added in the last ${n} days and switch OFF all others?`)}>Apply</button>
        <button className="miniBtn" onClick={() => act({ action: 'enable_all' }, 'Switch ON every Available car?')}>Enable all</button>
        <button className="miniBtn danger" onClick={() => act({ action: 'disable_all' }, 'Switch OFF every car? The AI will then tell customers the team will reply.')}>Disable all</button>
      </div>
      {msg && <p><b>{msg}</b></p>}
      {data.migration?.at && <details style={{ marginTop: 8 }}><summary className="muted">First setup ({new Date(data.migration.at).toLocaleString()}) switched on {data.migration.enabled.length} car(s) added in the last 72 hours</summary>
        <ul>{data.migration.enabled.map((x: any) => <li key={x.id}>{x.title} · {x.stock_no}</li>)}</ul>{!data.migration.enabled.length && <p className="muted">No car was added in those 72 hours, so none was switched on.</p>}</details>}
    </div>
    <div className="card" style={{ marginTop: 10 }}>
      <form onSubmit={e => { e.preventDefault(); load(); }} style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <input placeholder="Search make, model, year or stock no." value={q} onChange={e => setQ(e.target.value)} style={{ minWidth: 240 }} />
        <button className="miniBtn">Search</button>
        <select value={filter} onChange={e => setFilter(e.target.value)}><option value="all">All Available</option><option value="on">AI on</option><option value="off">AI off</option></select>
        <select value={days} onChange={e => setDays(e.target.value)}><option value="">Any date</option><option value="3">Added last 3 days</option><option value="7">Last 7 days</option><option value="30">Last 30 days</option></select>
      </form>
      <div className="tableWrap" style={{ marginTop: 10 }}>
        <table className="table"><thead><tr><th></th><th>Car</th><th>Stock</th><th>Price</th><th>Exact photos</th><th>Added</th><th>AI sells it</th></tr></thead>
          <tbody>{(data.list as Car[]).map(v => <tr key={v.id} style={{ opacity: v.ai_enabled || all ? 1 : 0.65 }}>
            <td>{v.cover ? <img src={v.cover} alt="" style={{ width: 64, height: 48, objectFit: 'cover', borderRadius: 4 }} /> : <span className="muted">no photo</span>}</td>
            <td><a href={`/vehicles/${v.id}`} target="_blank" rel="noreferrer">{[v.model_year, v.brand, v.model, v.trim_name].filter(Boolean).join(' ')}</a></td>
            <td>{v.stock_no}</td><td>{v.price_usd ? '$' + Number(v.price_usd).toLocaleString() : '—'}</td>
            <td>{v.exact_photo_count}</td><td>{new Date(v.created_at).toLocaleDateString()}</td>
            <td><label style={{ display: 'flex', gap: 6, alignItems: 'center' }}><input type="checkbox" checked={v.ai_enabled} onChange={e => act({ action: 'set', id: v.id, enabled: e.target.checked })} />{v.ai_enabled ? 'On' : 'Off'}</label></td>
          </tr>)}</tbody></table>
        {!data.list.length && <p className="muted">No Available cars match.</p>}
      </div>
    </div>
  </>;
}
