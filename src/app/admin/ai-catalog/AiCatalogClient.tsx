'use client';
import { useEffect, useState } from 'react';
import NeedsSetup from '../_components/NeedsSetup';
import { clearIds, toggleAllIds, toggleId } from '../../../lib/ai-rules/selection';

type Car = { id: number; stock_no: string; brand: string; model: string; trim_name: string; model_year: number; price_usd: number | null; exact_photo_count: number; created_at: string; ai_enabled: boolean; status: string; sellable: boolean; cover: string | null };

const titleOf = (v: Car) => [v.model_year, v.brand, v.model, v.trim_name].filter(Boolean).join(' ') || 'Vehicle';
const money = (v: any) => (v?.price_usd ? '$' + Number(v.price_usd).toLocaleString() : '-');
const statusText = (v: Car) => String(v.status || '').replace(/_/g, ' ');

export default function AiCatalogClient() {
  const [data, setData] = useState<any>(null);
  const [setup, setSetup] = useState(false);
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState('all');
  const [status, setStatus] = useState('');
  const [category, setCategory] = useState('');
  const [brand, setBrand] = useState('');
  const [noPhotos, setNoPhotos] = useState(false);
  const [sort, setSort] = useState('newest');
  const [days, setDays] = useState('3');
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(50);
  const [sel, setSel] = useState<number[]>([]);
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);

  // "+ Add vehicle to AI" picker
  const [pickOpen, setPickOpen] = useState(false);
  const [pq, setPq] = useState('');
  const [pPage, setPPage] = useState(1);
  const [pData, setPData] = useState<any>(null);
  const [pSel, setPSel] = useState<number[]>([]);

  function query(over: Record<string, string | number> = {}) {
    const p = new URLSearchParams({
      q, filter, status, category, brand, sort, days,
      noPhotos: noPhotos ? '1' : '', page: String(page), limit: String(limit), ...Object.fromEntries(Object.entries(over).map(([k, v]) => [k, String(v)])),
    });
    return p.toString();
  }

  async function load() {
    const r = await fetch('/api/admin/ai-catalog?' + query(), { cache: 'no-store' });
    if (!r.ok) { setSetup(true); return; }
    setData(await r.json());
  }
  useEffect(() => { load(); }, [filter, status, category, brand, noPhotos, sort, days, page, limit]);

  async function act(body: any, confirmText?: string) {
    if (confirmText && !confirm(confirmText)) return;
    setBusy(true); setMsg('Saving...');
    const r = await fetch('/api/admin/ai-catalog', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    const j = await r.json().catch(() => ({}));
    setBusy(false);
    setMsg(j.error || `Done${j.changed != null ? `: ${j.changed} vehicle(s) changed` : ''}.`);
    await load();
  }

  async function loadPicker() {
    const p = new URLSearchParams({ q: pq, status: 'available', sort: 'newest', page: String(pPage), limit: '30', filter: 'all' });
    const r = await fetch('/api/admin/ai-catalog?' + p, { cache: 'no-store' });
    if (r.ok) setPData(await r.json());
  }
  useEffect(() => { if (pickOpen) loadPicker(); }, [pickOpen, pq, pPage]);

  if (setup) return <NeedsSetup what="AI Catalog" />;
  if (!data) return <p>Loading...</p>;
  const c = data.counts || {};
  const all = c.mode === 'all';
  const rows: Car[] = data.list || [];
  const visibleIds = rows.map((v) => v.id);

  return <>
    <div className="card">
      <h2 style={{ marginTop: 0 }}>AI Inventory</h2>
      <p className="muted" style={{ marginTop: 4 }}>AI selling <b>{c.aiCount}</b> of <b>{c.availableCount}</b> Available vehicles ({c.carCount} cars, {c.motorcycleCount} motorcycles).</p>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <b>Mode:</b>
        <button className={!all ? 'btn' : 'miniBtn'} disabled={busy} onClick={() => act({ action: 'mode', mode: 'selected' })}>Selected vehicles</button>
        <button className={all ? 'btn' : 'miniBtn'} disabled={busy} onClick={() => act({ action: 'mode', mode: 'all' }, 'In "all" mode the AI may offer EVERY Available car, including old stock. Continue?')}>All Available</button>
      </div>
      {all && <p className="setupAlert" style={{ marginTop: 10 }}><b>Note:</b> in All Available mode every Available car can be offered; the switches below still control nothing until you return to Selected vehicles.</p>}
      <div className="pager">
        <button className="btn" disabled={busy} onClick={() => { setPSel([]); setPq(''); setPPage(1); setPickOpen(true); }}>+ Add vehicle to AI</button>
        <button className="miniBtn" disabled={busy} onClick={() => setSel(toggleAllIds(sel, visibleIds))}>Select all visible</button>
        <button className="miniBtn" disabled={busy || !sel.length} onClick={() => setSel(clearIds())}>Clear selection</button>
        <button className="miniBtn" disabled={busy || !sel.length} onClick={() => act({ action: 'set', ids: sel, enabled: true }, `Switch the AI ON for ${sel.length} selected vehicle(s)?`)}>Enable selected ({sel.length})</button>
        <button className="miniBtn danger" disabled={busy || !sel.length} onClick={() => act({ action: 'set', ids: sel, enabled: false }, `Switch the AI OFF for ${sel.length} selected vehicle(s)?`)}>Disable selected</button>
        <a className="miniBtn" href="/admin/vehicles/new">+ Add new vehicle</a>
      </div>
      <div className="pager">
        <span>Newest</span><input style={{ width: 60, margin: 0 }} type="number" min={1} value={days} onChange={(e) => setDays(e.target.value)} /><span>days</span>
        <button className="miniBtn" disabled={busy} onClick={() => act({ action: 'only_recent', days: Number(days) || 3 }, `Switch ON only vehicles added in the last ${days} days and switch OFF all others?`)}>Enable recent vehicles</button>
        <button className="miniBtn" disabled={busy} onClick={() => act({ action: 'enable_all' }, 'Switch ON every Available vehicle?')}>Enable all Available</button>
        <button className="miniBtn danger" disabled={busy} onClick={() => act({ action: 'disable_all' }, 'Switch OFF every vehicle? The AI will then tell customers the team will reply.')}>Disable all</button>
      </div>
      <p className="muted" style={{ marginTop: 10 }}>A vehicle is only sold by the AI when its status is <b>Available</b> and its switch is On. Enabling the AI never changes public visibility.</p>
      {msg && <p><b>{msg}</b></p>}
      {data.migration?.at && <details style={{ marginTop: 8 }}><summary className="muted">First setup ({new Date(data.migration.at).toLocaleString()}) switched on {data.migration.enabled.length} vehicle(s)</summary>
        <ul>{data.migration.enabled.map((x: any) => <li key={x.id}>{x.title} | {x.stock_no}</li>)}</ul></details>}
    </div>

    <div className="card" style={{ marginTop: 10 }}>
      <form onSubmit={(e) => { e.preventDefault(); setPage(1); load(); }} className="pager">
        <input placeholder="Search stock no, brand, model, year, trim" value={q} onChange={(e) => setQ(e.target.value)} style={{ minWidth: 240, margin: 0 }} />
        <button className="miniBtn">Search</button>
        <select value={filter} onChange={(e) => { setFilter(e.target.value); setPage(1); }} style={{ width: 'auto', margin: 0 }}>
          <option value="all">AI on and off</option><option value="on">AI enabled</option><option value="off">AI disabled</option>
        </select>
        <select value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }} style={{ width: 'auto', margin: 0 }}>
          <option value="">Any status</option><option value="available">Available</option><option value="reserved">Reserved</option>
          <option value="sold">Sold</option><option value="hidden">Hidden</option><option value="pending_verification">Pending</option>
        </select>
        <select value={category} onChange={(e) => { setCategory(e.target.value); setPage(1); }} style={{ width: 'auto', margin: 0 }}>
          <option value="">Cars + motorcycles</option><option value="car">Cars</option><option value="motorcycle">Motorcycles</option>
        </select>
        <select value={brand} onChange={(e) => { setBrand(e.target.value); setPage(1); }} style={{ width: 'auto', margin: 0 }}>
          <option value="">Any brand</option>{(data.brands || []).map((b: string) => <option key={b} value={b}>{b}</option>)}
        </select>
        <select value={sort} onChange={(e) => { setSort(e.target.value); setPage(1); }} style={{ width: 'auto', margin: 0 }}>
          <option value="newest">Newest</option><option value="price_asc">Price low-high</option><option value="price_desc">Price high-low</option><option value="year_desc">Year newest</option>
        </select>
        <label style={{ display: 'flex', gap: 6, alignItems: 'center', margin: 0 }}><input type="checkbox" style={{ width: 'auto', margin: 0 }} checked={noPhotos} onChange={(e) => { setNoPhotos(e.target.checked); setPage(1); }} />No exact photos</label>
        <select value={limit} onChange={(e) => { setLimit(Number(e.target.value)); setPage(1); }} style={{ width: 'auto', margin: 0 }}>
          <option value={25}>25 / page</option><option value={50}>50 / page</option><option value={100}>100 / page</option>
        </select>
      </form>

      <div className="tableWrap" style={{ marginTop: 10 }}>
        <table className="table catalogTable">
          <thead><tr><th></th><th></th><th>Photo</th><th>Stock</th><th>Vehicle</th><th>Price</th><th>Added</th><th>Photos</th><th>Status</th><th>AI sells it</th></tr></thead>
          <tbody>{rows.map((v) => <tr key={v.id} style={{ opacity: v.ai_enabled && v.sellable ? 1 : 0.7 }}>
            <td><input type="checkbox" style={{ width: 'auto', margin: 0 }} checked={sel.includes(v.id)} onChange={() => setSel(toggleId(sel, v.id))} /></td>
            <td>{v.cover ? <img src={v.cover} alt="" style={{ width: 64, height: 48, objectFit: 'cover', borderRadius: 4 }} /> : <span className="muted">no photo</span>}</td>
            <td>{v.stock_no}</td>
            <td><a href={`/vehicles/${v.id}`} target="_blank" rel="noreferrer">{titleOf(v)}</a></td>
            <td>{money(v)}</td>
            <td>{new Date(v.created_at).toLocaleDateString()}</td>
            <td>{v.exact_photo_count}</td>
            <td><span className={'badge ' + (v.sellable ? '' : 'pending')}>{v.sellable ? 'available' : statusText(v)}</span></td>
            <td><label style={{ display: 'flex', gap: 6, alignItems: 'center', margin: 0 }}><input type="checkbox" style={{ width: 'auto', margin: 0 }} checked={v.ai_enabled} onChange={(e) => act({ action: 'set', id: v.id, enabled: e.target.checked })} />{v.ai_enabled ? 'On' : 'Off'}</label></td>
          </tr>)}</tbody>
        </table>

        {/* phone card layout */}
        <div className="catalogCards">{rows.map((v) => <div className="catalogCard" key={v.id}>
          <div className="catalogRow">
            <input type="checkbox" checked={sel.includes(v.id)} onChange={() => setSel(toggleId(sel, v.id))} />
            <b>{titleOf(v)}</b>
          </div>
          {v.cover ? <img src={v.cover} alt="" loading="lazy" /> : <div className="muted">no photo</div>}
          <div>{v.stock_no} | {money(v)} | {v.exact_photo_count} photo(s)</div>
          <div className="catalogRow"><span className={'badge ' + (v.sellable ? '' : 'pending')}>{v.sellable ? 'available' : statusText(v)}</span><span className="muted">{new Date(v.created_at).toLocaleDateString()}</span></div>
          <div className="catalogRow"><input type="checkbox" checked={v.ai_enabled} onChange={(e) => act({ action: 'set', id: v.id, enabled: e.target.checked })} /> <span>AI sells this {v.ai_enabled ? '(On)' : '(Off)'}</span></div>
          <a className="miniBtn" href={`/vehicles/${v.id}`} target="_blank" rel="noreferrer">View</a>
        </div>)}</div>
        {!rows.length && <p className="muted">No vehicles match these filters.</p>}
      </div>

      <div className="pager">
        <button className="miniBtn" disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>Previous</button>
        <span>Page {data.page} of {data.pages} ({data.total} vehicles)</span>
        <button className="miniBtn" disabled={page >= (data.pages || 1)} onClick={() => setPage((p) => p + 1)}>Next</button>
      </div>
    </div>

    {pickOpen ? <div className="modalBackdrop" onClick={() => setPickOpen(false)}>
      <div className="modalCard" onClick={(e) => e.stopPropagation()}>
        <h2>Add vehicles to AI</h2>
        <p className="muted">Available inventory. Tick one or many, then add them to the AI.</p>
        <div className="pager">
          <input placeholder="Search stock, brand, model, year" value={pq} onChange={(e) => { setPq(e.target.value); setPPage(1); }} style={{ minWidth: 220, margin: 0 }} />
          <button className="miniBtn" onClick={() => setPSel(toggleAllIds(pSel, (pData?.list || []).map((v: Car) => v.id)))}>Select page</button>
          <button className="miniBtn" onClick={() => setPSel(clearIds())}>Clear</button>
          <span>{pSel.length} selected</span>
        </div>
        <div className="catalogCards" style={{ marginTop: 10 }}>
          {(pData?.list || []).map((v: Car) => <div className="catalogCard" key={v.id}>
            <div className="catalogRow"><input type="checkbox" checked={pSel.includes(v.id)} onChange={() => setPSel(toggleId(pSel, v.id))} /><b>{titleOf(v)}</b></div>
            {v.cover ? <img src={v.cover} alt="" loading="lazy" /> : <div className="muted">no photo</div>}
            <div>{v.stock_no} | {money(v)} | {v.exact_photo_count} photo(s)</div>
            <div className="muted">{v.ai_enabled ? 'already ON for AI' : 'AI off'}</div>
          </div>)}
          {!(pData?.list || []).length && <p className="muted">No Available vehicles match.</p>}
        </div>
        <div className="pager">
          <button className="miniBtn" disabled={pPage <= 1} onClick={() => setPPage((p) => p - 1)}>Previous</button>
          <span>Page {pData?.page || 1} of {pData?.pages || 1}</span>
          <button className="miniBtn" disabled={pPage >= (pData?.pages || 1)} onClick={() => setPPage((p) => p + 1)}>Next</button>
          <button className="btn" disabled={busy || !pSel.length} onClick={async () => { await act({ action: 'set', ids: pSel, enabled: true }); setPickOpen(false); setPSel(clearIds()); }}>Add selected to AI</button>
          <button className="miniBtn" onClick={() => setPickOpen(false)}>Close</button>
        </div>
      </div>
    </div> : null}
  </>;
}
