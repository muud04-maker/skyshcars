'use client';
import { useEffect, useState } from 'react';
import VehicleForm from './VehicleForm';

/*
  Inventory list + EDIT only. Creating a vehicle is the 5-step flow at /admin/vehicles/new
  (one clean implementation, shared backend validation).
*/
const EMPTY: any = {
  category: 'car', brand: '', model: '', model_year: '', mileage_km: '', engine: '', transmission: '', fuel_type: '',
  steering: 'LHD', color: '', price_usd: '', location: 'China', status: 'pending_verification', description: '',
  image_url: '', ai_enabled: true,
};
const money = (v: any) => (v?.price_usd ? '$' + Number(v.price_usd).toLocaleString() : '-');
const titleOf = (v: any) => [v.model_year, v.brand, v.model].filter(Boolean).join(' ') || v.stock_no;

export default function VehicleManager({ initial }: { initial: any[] }) {
  const [list, setList] = useState(initial || []);
  const [form, setForm] = useState<any>(EMPTY);
  const [open, setOpen] = useState(false);
  const [msg, setMsg] = useState('');
  const [tone, setTone] = useState<'ok' | 'bad' | ''>('');
  const [busy, setBusy] = useState(false);
  const [filter, setFilter] = useState('all');
  const shown = filter === 'all' ? list : list.filter((v: any) => v.status === filter);
  const set = (k: string, v: any) => setForm((x: any) => ({ ...x, [k]: v }));
  // Bulk availability (brief section 5): ticks survive filtering, and "all matching" means the
  // currently filtered set. The API re-reads the ids inside a transaction, so the server decides.
  const [sel, setSel] = useState<number[]>([]);
  const [bulkBusy, setBulkBusy] = useState(false);
  const [summary, setSummary] = useState<any>(null);
  const pageAllSelected = shown.length > 0 && shown.every((v: any) => sel.includes(Number(v.id)));
  const toggle = (id: number) => setSel((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));
  const togglePage = () => setSel(pageAllSelected ? sel.filter((id) => !shown.some((v: any) => Number(v.id) === id)) : [...new Set([...sel, ...shown.map((v: any) => Number(v.id))])]);
  async function bulk(action: 'available' | 'sold') {
    const ids = sel.filter((id) => list.some((v: any) => Number(v.id) === id));
    if (!ids.length) { flash('Tick at least one vehicle first.', 'bad'); return; }
    const label = action === 'sold' ? 'Mark Sold' : 'Mark Available';
    if (!confirm(`${label}: ${ids.length} vehicle(s)?\n\nThis changes availability for the website and the AI. Sold and Hidden stay separate states.`)) return;
    setBulkBusy(true); flash(`${label}: updating ${ids.length} vehicle(s)...`, '');
    const r = await fetch('/api/admin/vehicles/bulk', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action, ids }) });
    const j = await r.json().catch(() => ({}));
    setBulkBusy(false);
    if (!r.ok) { flash(j.error || 'Bulk update failed. Nothing was changed.', 'bad'); return; }
    flash(`${label} done: ${j.updated} updated, ${j.skipped} skipped (already ${action}), ${j.failed || 0} failed.`, 'ok');
    setSel([]);
    await reload();
  }
  async function loadSummary() {
    const r = await fetch('/api/admin/vehicles/bulk', { cache: 'no-store' });
    if (r.ok) setSummary(await r.json());
  }
  useEffect(() => { void loadSummary(); }, [list.length]);
  /** Non-destructive duplicate detection: flagged for review only, never deleted automatically. */
  const duplicates = (() => {
    const byStock = new Map<string, any[]>(); const bySpec = new Map<string, any[]>();
    for (const v of list) {
      const s = String(v.stock_no || '').trim().toLowerCase(); if (s) byStock.set(s, [...(byStock.get(s) || []), v]);
      const k = [v.brand, v.model, v.model_year, v.price_usd].map((x) => String(x ?? '').trim().toLowerCase()).join('|');
      if (k.replace(/\|/g, '')) bySpec.set(k, [...(bySpec.get(k) || []), v]);
    }
    return [...[...byStock.values()].filter((g) => g.length > 1), ...[...bySpec.values()].filter((g) => g.length > 1 && new Set(g.map((v) => v.id)).size > 1)]
      .filter((g, i, arr) => arr.findIndex((x) => x[0]?.id === g[0]?.id) === i).slice(0, 5);
  })();

  async function reload() {
    const r = await fetch('/api/admin/vehicles', { cache: 'no-store' });
    if (r.ok) setList((await r.json()).vehicles || []);
  }
  function flash(message: string, t: 'ok' | 'bad' | '') { setMsg(message); setTone(t); }

  async function save(e: any) {
    e.preventDefault();
    if (!form.id) { flash('Use "+ Add Vehicle" to create a new vehicle.', 'bad'); return; }
    setBusy(true); flash('Saving...', '');
    const r = await fetch('/api/admin/vehicles', { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(form) });
    const j = await r.json().catch(() => ({}));
    setBusy(false);
    if (!r.ok || j.ok === false) { flash(j.message || j.error || 'Could not save the vehicle.', 'bad'); return; }
    flash('Vehicle saved.', 'ok');
    setForm(EMPTY); setOpen(false);
    await reload();
  }
  function edit(v: any) {
    setForm({ ...EMPTY, ...v, image_url: v.cover_url || '', ai_enabled: v.ai_enabled == null ? true : !!Number(v.ai_enabled) });
    setOpen(true); setMsg(''); setTone('');
    scrollTo({ top: 0, behavior: 'smooth' });
  }
  async function setStatus(id: number, status: string) {
    setBusy(true);
    const r = await fetch('/api/admin/vehicles', { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id, status }) });
    const j = await r.json().catch(() => ({}));
    setBusy(false);
    flash(r.ok && j.ok !== false ? `Status updated - the website and AI now see "${status}".` : (j.message || j.error || 'Could not update the status.'), r.ok ? 'ok' : 'bad');
    await reload();
  }
  async function hide(id: number, stock: string) {
    if (!confirm(`Hide ${stock} from customers? It stays in the database and can be made Available again.`)) return;
    setBusy(true);
    const r = await fetch('/api/admin/vehicles', { method: 'DELETE', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id }) });
    setBusy(false);
    flash(r.ok ? `${stock} hidden.` : 'Could not hide the vehicle.', r.ok ? 'ok' : 'bad');
    await reload();
  }
  async function publishFacebook(id: number, stock: string) {
    if (!confirm(`Publish ${stock} to the connected Facebook Page now? This action is recorded and protected against duplicate posts.`)) return;
    setBusy(true);
    const response = await fetch('/api/admin/social', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ vehicle_id: id, channel: 'facebook' }),
    });
    const result = await response.json().catch(() => ({}));
    setBusy(false);
    const facebook = result.result?.facebook;
    flash(response.ok && facebook?.ok
      ? `Facebook post published${facebook.id ? ` (${facebook.id})` : ''}.`
      : facebook?.error || facebook?.skipped || result.error || 'Facebook publication failed.',
    response.ok && facebook?.ok ? 'ok' : 'bad');
  }

  return <>
    <div className="adminActionBar">
      <a className="btn-primary" href="/admin/vehicles/new">+ Add Vehicle</a>
      <a className="btn-info" href="/admin/media">Vehicle Photos</a>
      <a className="btn-neutral" href="/admin/ai-catalog">AI Catalog</a>
      <select value={filter} onChange={(e) => setFilter(e.target.value)} className="statusSelect" style={{ width: 'auto', margin: 0 }}>
        <option value="all">All ({list.length})</option>
        {['available', 'reserved', 'sold', 'pending_verification', 'hidden'].map((k) => <option key={k} value={k}>{k.replace('_', ' ')} ({list.filter((v: any) => v.status === k).length})</option>)}
      </select>
      {busy ? <span className="muted">Working...</span> : null}
    </div>

    {/* Inventory dashboard (brief section 6) - live counts from the protected summary endpoint. */}
    {summary ? <section className="stats" style={{ maxWidth: 1450, margin: '0 auto 12px' }}>
      {[
        ['Total', summary.summary?.total, '/admin/vehicles'],
        ['Available', summary.summary?.available_vehicles, '/admin/vehicles'],
        ['Sold', summary.summary?.sold, '/admin/vehicles'],
        ['Pending', summary.summary?.pending, '/admin/vehicles'],
        ['Hidden', summary.summary?.hidden, '/admin/vehicles'],
        ['Cars', summary.summary?.cars, '/admin/vehicles'],
        ['Motorcycles', summary.summary?.motorcycles, '/admin/vehicles'],
        ['In AI catalog', summary.summary?.available_in_ai, '/admin/ai-catalog'],
        ['Without photos', summary.summary?.without_photos, '/admin/media'],
      ].map(([label, value, href]: any) => <a className="stat" key={label} href={href} style={{ textDecoration: 'none' }}><b>{Number(value || 0)}</b><span>{label}</span></a>)}
    </section> : null}

    {duplicates.length ? <section className="card" style={{ maxWidth: 1450, margin: '0 auto 12px' }}>
      <h2>Possible duplicates (review)</h2>
      <p className="muted">Same stock number or same brand/model/year/price. Nothing is deleted automatically.</p>
      {duplicates.map((g: any[], i: number) => <div key={i} className="pager" style={{ margin: '4px 0' }}>
        {g.map((v: any) => <a key={v.id} className="miniBtn" href={`/admin/vehicles?highlight=${v.id}`} title={v.stock_no}>{v.stock_no} · {titleOf(v)}</a>)}
      </div>)}
    </section> : null}

    <div className="adminActionBar" style={{ maxWidth: 1450, margin: '0 auto 10px' }}>
      <label className="miniBtn" style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
        <input type="checkbox" checked={pageAllSelected} onChange={togglePage} /> Select this page ({shown.length})
      </label>
      <button type="button" className="miniBtn" onClick={() => setSel(shown.map((v: any) => Number(v.id)))}>Select all {shown.length} matching</button>
      <b>{sel.length} selected</b>
      <button type="button" className="btn-success" disabled={bulkBusy || !sel.length} onClick={() => void bulk('available')}>Mark Available</button>
      <button type="button" className="btn-warning" disabled={bulkBusy || !sel.length} onClick={() => void bulk('sold')}>Mark Sold</button>
      {sel.length ? <button type="button" className="miniBtn" onClick={() => setSel([])}>Clear selection</button> : null}
      {bulkBusy ? <span className="muted">Updating...</span> : null}
    </div>

    {msg ? <p className={tone === 'bad' ? 'error' : tone === 'ok' ? 'success' : 'muted'} style={{ maxWidth: 1450, margin: '0 auto 12px' }}><b>{msg}</b></p> : null}

    {open && form.id ? <VehicleForm mode="edit" initial={form} onSaved={() => { setOpen(false); setForm(EMPTY); setMsg("Vehicle saved."); setTone("ok"); void reload(); }} onCancel={() => { setOpen(false); setForm(EMPTY); }} /> : null}

    <div className="tableWrap">
      <table className="table">
        <thead><tr><th><input type="checkbox" checked={pageAllSelected} onChange={togglePage} aria-label="Select this page" /></th><th>Photo</th><th>Stock</th><th>Vehicle</th><th>Category</th><th>Price</th><th>AI</th><th>Status</th><th>Actions</th></tr></thead>
        <tbody>{shown.map((v: any) => <tr key={v.id}>
          <td><input type="checkbox" checked={sel.includes(Number(v.id))} onChange={() => toggle(Number(v.id))} aria-label={`Select ${v.stock_no}`} /></td>
          <td>{v.cover_url ? <img src={String(v.cover_url).startsWith('http') ? `/api/photo/${v.id}` : v.cover_url} alt="" style={{ width: 56, height: 42, objectFit: 'cover', borderRadius: 4 }} /> : <span className="muted">no photo</span>}</td>
          <td>{v.stock_no}</td>
          <td><a href={`/vehicles/${v.id}`} target="_blank" rel="noreferrer">{titleOf(v)}</a></td>
          <td>{v.category}</td>
          <td>{money(v)}</td>
          <td>{Number(v.ai_enabled) ? <span className="badge">AI on</span> : <span className="badge pending">AI off</span>}</td>
          <td><select className={'statusSelect st-' + v.status} value={v.status} onChange={(e) => setStatus(v.id, e.target.value)} style={{ width: 'auto', margin: 0 }}>
            <option value="available">Available</option><option value="reserved">Reserved</option><option value="sold">Sold</option>
            <option value="pending_verification">Pending</option><option value="hidden">Hidden</option>
          </select></td>
          <td><div className="pager" style={{ margin: 0 }}>
            <button type="button" className="btn-info" onClick={() => edit(v)}>Edit</button>
            <a className="btn-neutral" href={`/admin/media?vehicle=${v.id}`}>Photos</a>
            {v.status === 'available' && <button type="button" className="btn-neutral" disabled={busy} onClick={() => publishFacebook(Number(v.id), String(v.stock_no))}>Facebook</button>}
            <button type="button" className="btn-danger" disabled={busy} onClick={() => hide(v.id, v.stock_no)}>Hide</button>
          </div></td>
        </tr>)}</tbody>
      </table>
      {!shown.length ? <p className="muted" style={{ padding: 14 }}>No vehicles with this status.</p> : null}
    </div>
  </>;
}
