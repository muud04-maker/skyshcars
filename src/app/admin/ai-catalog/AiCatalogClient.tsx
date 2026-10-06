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
  const [sort, setSort] = useState('newest');
  const [more, setMore] = useState(false);
  const [extra, setExtra] = useState({ noPhotos: false, days: '', limit: 50 });
  const [page, setPage] = useState(1);
  const [sel, setSel] = useState<number[]>([]);
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const [menu, setMenu] = useState(false);
  const [recentDays, setRecentDays] = useState('3');

  const [pickOpen, setPickOpen] = useState(false);
  const [pq, setPq] = useState('');
  const [pPage, setPPage] = useState(1);
  const [pData, setPData] = useState<any>(null);
  const [pSel, setPSel] = useState<number[]>([]);

  function params(over: Record<string, string | number> = {}) {
    const p = new URLSearchParams({
      q, filter, status, category, brand, sort, page: String(page), limit: String(extra.limit),
      noPhotos: extra.noPhotos ? '1' : '', days: String(extra.days || ''),
      ...Object.fromEntries(Object.entries(over).map(([k, v]) => [k, String(v)])),
    });
    return p.toString();
  }
  async function load() {
    const r = await fetch('/api/admin/ai-catalog?' + params(), { cache: 'no-store' });
    if (!r.ok) { setSetup(true); return; }
    setData(await r.json());
  }
  useEffect(() => { load(); }, [filter, status, category, brand, sort, extra.noPhotos, extra.days, extra.limit, page]);

  async function act(body: any, confirmText?: string) {
    if (confirmText && !confirm(confirmText)) return;
    setBusy(true); setMsg('Saving...');
    const r = await fetch('/api/admin/ai-catalog', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    const j = await r.json().catch(() => ({}));
    setBusy(false);
    setMsg(j.error || `Done${j.changed != null ? `: ${j.changed} vehicle(s) changed` : ''}.`);
    setSel(clearIds());
    await load();
  }
  async function loadPicker() {
    const p = new URLSearchParams({ q: pq, status: 'available', sort: 'newest', page: String(pPage), limit: '24', filter: 'off' });
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
      <p style={{ marginTop: 4 }}><b>{c.aiCount}</b> vehicles the AI can sell &middot; <b>{c.availableCount}</b> Available vehicles in stock</p>
      <div className="pager"><b>AI sells:</b>
        <button className={!all ? 'btn-primary' : 'btn-neutral'} disabled={busy} onClick={() => act({ action: 'mode', mode: 'selected' })}>Selected vehicles</button>
        <button className={all ? 'btn-primary' : 'btn-neutral'} disabled={busy} onClick={() => act({ action: 'mode', mode: 'all' }, 'In "all" mode the AI may offer EVERY Available vehicle, including old stock. Continue?')}>All Available</button>
      </div>
      <div className="pager">
        <button className="btn-primary" disabled={busy} onClick={() => { setPSel(clearIds()); setPq(''); setPPage(1); setPickOpen(true); }}>+ Add vehicles</button>
        <a className="btn-success" href="/admin/vehicles/new">+ New vehicle</a>
        <div className="quickMenu" style={{ marginLeft: 'auto' }}>
          <button type="button" className="btn-neutral" onClick={() => setMenu((m) => !m)}>More</button>
          {menu ? <div>
            <button type="button" onClick={() => { setMenu(false); act({ action: 'enable_all' }, 'Switch the AI ON for EVERY Available vehicle?'); }}>Enable all Available</button>
            <button type="button" onClick={() => { setMenu(false); act({ action: 'disable_all' }, 'Switch the AI OFF for every vehicle? The AI will then tell customers the team will reply.'); }}>Disable all AI vehicles</button>
            <button type="button" onClick={() => { setMenu(false); act({ action: 'only_recent', days: Number(recentDays) || 3 }, `Switch ON only vehicles added in the last ${recentDays} days and switch OFF all others?`); }}>Enable vehicles added recently</button>
          </div> : null}
        </div>
      </div>
      {menu ? <p className="muted" style={{ marginTop: 6 }}>Recently added =
        <input style={{ width: 70, margin: '0 6px' }} type="number" min={1} value={recentDays} onChange={(e) => setRecentDays(e.target.value)} />days, then confirm from the menu.</p> : null}
      {all ? <p className="setupAlert" style={{ marginTop: 10 }}><b>Note:</b> in All Available mode every Available vehicle can be offered; the AI switches below only matter in Selected vehicles mode.</p> : null}
      {msg ? <p className="muted" style={{ marginTop: 8 }}><b>{msg}</b></p> : null}
    </div>

    <div className="card" style={{ marginTop: 10 }}>
      <form onSubmit={(e) => { e.preventDefault(); setPage(1); load(); }} className="pager">
        <input placeholder="Search stock, brand, model, year..." value={q} onChange={(e) => setQ(e.target.value)} style={{ minWidth: 240, margin: 0 }} />
        <button className="btn-info">Search</button>
        <select value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }} style={{ width: 'auto', margin: 0 }}><option value="">Status: any</option>
          <option value="available">Available</option><option value="reserved">Reserved</option><option value="sold">Sold</option><option value="hidden">Hidden</option><option value="pending_verification">Pending</option></select>
        <select value={category} onChange={(e) => { setCategory(e.target.value); setPage(1); }} style={{ width: 'auto', margin: 0 }}><option value="">Type: all</option><option value="car">Cars</option><option value="motorcycle">Motorcycles</option></select>
        <select value={brand} onChange={(e) => { setBrand(e.target.value); setPage(1); }} style={{ width: 'auto', margin: 0 }}><option value="">Brand: any</option>{(data.brands || []).map((b: string) => <option key={b} value={b}>{b}</option>)}</select>
        <select value={filter} onChange={(e) => { setFilter(e.target.value); setPage(1); }} style={{ width: 'auto', margin: 0 }}><option value="all">AI: on and off</option><option value="on">AI: enabled</option><option value="off">AI: disabled</option></select>
        <select value={sort} onChange={(e) => { setSort(e.target.value); setPage(1); }} style={{ width: 'auto', margin: 0 }}><option value="newest">Sort: newest</option><option value="price_asc">Price low-high</option><option value="price_desc">Price high-low</option><option value="year_desc">Year newest</option></select>
        <button type="button" className="btn-neutral" onClick={() => setMore((m) => !m)}>{more ? 'Fewer filters' : 'More filters'}</button>
      </form>
      {more ? <div className="pager" style={{ marginTop: 6 }}>
        <label className="automationToggle" style={{ display: 'flex', gap: 8, alignItems: 'center' }}><input type="checkbox" style={{ width: 'auto', margin: 0 }} checked={extra.noPhotos} onChange={(e) => { setExtra({ ...extra, noPhotos: e.target.checked }); setPage(1); }} /><span>Only vehicles with no exact photos</span></label>
        <label style={{ display: 'flex', gap: 6, alignItems: 'center', margin: 0 }}>Added in the last
          <input style={{ width: 70, margin: 0 }} type="number" min={1} value={extra.days} onChange={(e) => { setExtra({ ...extra, days: e.target.value }); setPage(1); }} /> days</label>
        <label style={{ display: 'flex', gap: 6, alignItems: 'center', margin: 0 }}>Rows
          <select value={extra.limit} onChange={(e) => { setExtra({ ...extra, limit: Number(e.target.value) }); setPage(1); }} style={{ width: 'auto', margin: 0 }}><option value={25}>25</option><option value={50}>50</option><option value={100}>100</option></select></label>
      </div> : null}

      {sel.length ? <div className="bulkBar">
        <b>{sel.length} selected</b>
        <button className="btn-success" disabled={busy} onClick={() => act({ action: 'set', ids: sel, enabled: true })}>Enable AI</button>
        <button className="btn-danger" disabled={busy} onClick={() => act({ action: 'set', ids: sel, enabled: false }, `Switch the AI OFF for ${sel.length} selected vehicle(s)?`)}>Disable AI</button>
        <button className="btn-neutral" onClick={() => setSel(clearIds())}>Clear</button>
        <button className="miniBtn" onClick={() => setSel(toggleAllIds(sel, visibleIds))}>Select all visible</button>
      </div> : null}

      <div className="tableWrap" style={{ marginTop: 10 }}>
        <table className="table catalogTable">
          <thead><tr><th></th><th>Photo</th><th>Stock</th><th>Vehicle</th><th>Price</th><th>Photos</th><th>Status</th><th>AI</th></tr></thead>
          <tbody>{rows.map((v) => <tr key={v.id} style={{ opacity: v.ai_enabled && v.sellable ? 1 : 0.75 }}>
            <td><input type="checkbox" style={{ width: 'auto', margin: 0 }} checked={sel.includes(v.id)} onChange={() => setSel(toggleId(sel, v.id))} /></td>
            <td><a href={`/vehicles/${v.id}`} target="_blank" rel="noreferrer">{v.cover ? <img src={v.cover} alt="" style={{ width: 64, height: 48, objectFit: 'cover', borderRadius: 4 }} /> : <span className="muted">no photo</span>}</a></td>
            <td>{v.stock_no}</td>
            <td><a href={`/vehicles/${v.id}`} target="_blank" rel="noreferrer">{titleOf(v)}</a></td>
            <td>{money(v)}</td>
            <td>{v.exact_photo_count}</td>
            <td><span className={'badge ' + (v.sellable ? '' : 'pending')}>{v.sellable ? 'Available' : statusText(v)}</span></td>
            <td><label className="automationToggle" style={{ display: 'flex', gap: 6, alignItems: 'center', margin: 0 }}>
              <input type="checkbox" style={{ width: 'auto', margin: 0 }} checked={v.ai_enabled} onChange={(e) => act({ action: 'set', id: v.id, enabled: e.target.checked })} /><span>{v.ai_enabled ? 'AI ON' : 'AI OFF'}</span></label></td>
          </tr>)}</tbody>
        </table>
        <div className="catalogCards">{rows.map((v) => <div className="catalogCard" key={v.id}>
          <div className="catalogRow"><input type="checkbox" checked={sel.includes(v.id)} onChange={() => setSel(toggleId(sel, v.id))} /><b>{titleOf(v)}</b></div>
          {v.cover ? <img src={v.cover} alt="" loading="lazy" /> : <div className="muted">no photo</div>}
          <div>Stock {v.stock_no} &middot; {money(v)} &middot; {v.exact_photo_count} photo(s)</div>
          <div className="catalogRow"><span className={'badge ' + (v.sellable ? '' : 'pending')}>{v.sellable ? 'Available' : statusText(v)}</span></div>
          <div className="catalogRow"><input type="checkbox" checked={v.ai_enabled} onChange={(e) => act({ action: 'set', id: v.id, enabled: e.target.checked })} /> <span>AI {v.ai_enabled ? 'ON' : 'OFF'}</span></div>
          <a className="btn-neutral" href={`/vehicles/${v.id}`} target="_blank" rel="noreferrer">View</a>
        </div>)}</div>
        {!rows.length ? <p className="muted">No vehicles match these filters.</p> : null}
      </div>
      <div className="pager">
        <button className="btn-neutral" disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>Previous</button>
        <span>Page {data.page} of {data.pages} ({data.total} vehicles)</span>
        <button className="btn-neutral" disabled={page >= (data.pages || 1)} onClick={() => setPage((p) => p + 1)}>Next</button>
      </div>
    </div>

    {pickOpen ? <div className="modalBackdrop" onClick={() => setPickOpen(false)}>
      <div className="modalCard" onClick={(e) => e.stopPropagation()}>
        <h2>Add vehicles to AI</h2>
        <p className="muted">Showing Available vehicles that are not in the AI yet. Tick one or many.</p>
        <div className="pager">
          <input placeholder="Search stock, brand, model, year" value={pq} onChange={(e) => { setPq(e.target.value); setPPage(1); }} style={{ minWidth: 220, margin: 0 }} />
          <button className="miniBtn" onClick={() => setPSel(toggleAllIds(pSel, (pData?.list || []).map((v: Car) => v.id)))}>Select page</button>
          <button className="miniBtn" onClick={() => setPSel(clearIds())}>Clear</button>
        </div>
        <div className="catalogCards" style={{ marginTop: 10 }}>
          {(pData?.list || []).map((v: Car) => <div className="catalogCard" key={v.id}>
            <div className="catalogRow"><input type="checkbox" checked={pSel.includes(v.id)} onChange={() => setPSel(toggleId(pSel, v.id))} /><b>{titleOf(v)}</b></div>
            {v.cover ? <img src={v.cover} alt="" loading="lazy" /> : <div className="muted">no photo</div>}
            <div>Stock {v.stock_no} &middot; {money(v)}</div>
            <div className="muted">Available</div>
          </div>)}
          {!(pData?.list || []).length ? <p className="muted">No Available vehicles are waiting to be added.</p> : null}
        </div>
        <div className="pager" style={{ position: 'sticky', bottom: 0, background: '#fff', paddingTop: 8 }}>
          <button className="btn-primary" disabled={busy || !pSel.length} onClick={async () => { await act({ action: 'set', ids: pSel, enabled: true }); setPickOpen(false); setPSel(clearIds()); }}>Add {pSel.length || ''} vehicles to AI</button>
          <button className="miniBtn" disabled={pPage <= 1} onClick={() => setPPage((p) => p - 1)}>Previous</button>
          <span>Page {pData?.page || 1} of {pData?.pages || 1}</span>
          <button className="miniBtn" disabled={pPage >= (pData?.pages || 1)} onClick={() => setPPage((p) => p + 1)}>Next</button>
          <button className="btn-neutral" onClick={() => setPickOpen(false)}>Close</button>
        </div>
      </div>
    </div> : null}
  </>;
}
