'use client';
import { useState } from 'react';

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

    {msg ? <p className={tone === 'bad' ? 'error' : tone === 'ok' ? 'success' : 'muted'} style={{ maxWidth: 1450, margin: '0 auto 12px' }}><b>{msg}</b></p> : null}

    {open && form.id ? <form className="vehicleForm card" onSubmit={save}>
      <h2>Edit {titleOf(form)}</h2>
      <div className="formGrid">
        <label>Stock number<input value={form.stock_no || ''} readOnly /></label>
        <label>Category<select value={form.category || 'car'} onChange={(e) => set('category', e.target.value)}>{['car', 'motorcycle', 'truck', 'van', 'bus', 'machinery', 'other'].map((c) => <option key={c}>{c}</option>)}</select></label>
        <label>Brand *<input value={form.brand || ''} onChange={(e) => set('brand', e.target.value)} /></label>
        <label>Model *<input value={form.model || ''} onChange={(e) => set('model', e.target.value)} /></label>
        <label>Year<input type="number" value={form.model_year || ''} onChange={(e) => set('model_year', e.target.value)} /></label>
        <label>Mileage km<input type="number" value={form.mileage_km || ''} onChange={(e) => set('mileage_km', e.target.value)} /></label>
        <label>Price USD<input type="number" value={form.price_usd || ''} onChange={(e) => set('price_usd', e.target.value)} /></label>
        <label>Transmission<input value={form.transmission || ''} onChange={(e) => set('transmission', e.target.value)} /></label>
        <label>Engine<input value={form.engine || ''} onChange={(e) => set('engine', e.target.value)} /></label>
        <label>Fuel<input value={form.fuel_type || ''} onChange={(e) => set('fuel_type', e.target.value)} /></label>
        <label>Color<input value={form.color || ''} onChange={(e) => set('color', e.target.value)} /></label>
        <label>Status<select value={form.status || 'available'} onChange={(e) => set('status', e.target.value)}>
          <option value="available">Available</option><option value="reserved">Reserved</option><option value="sold">Sold</option>
          <option value="pending_verification">Pending verification</option><option value="hidden">Hidden</option>
        </select></label>
        <label className="wide">Add another exact photo URL<input placeholder="https://..." value={form.image_url || ''} onChange={(e) => set('image_url', e.target.value)} /></label>
        <label className="wide" style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <input type="checkbox" style={{ width: 'auto' }} checked={form.ai_enabled !== false} onChange={(e) => set('ai_enabled', e.target.checked)} />Let the AI sell this vehicle (WhatsApp and Messenger)
        </label>
        <label className="wide">Description<textarea value={form.description || ''} onChange={(e) => set('description', e.target.value)} /></label>
      </div>
      <div className="pager">
        <button className="btn-primary" disabled={busy}>{busy ? 'Saving...' : 'Save Vehicle'}</button>
        <a className="btn-info" href={`/admin/media?vehicle=${form.id}`}>Manage photos</a>
        <button type="button" className="btn-neutral" onClick={() => { setOpen(false); setForm(EMPTY); setMsg(''); }}>Cancel</button>
      </div>
    </form> : null}

    <div className="tableWrap">
      <table className="table">
        <thead><tr><th>Photo</th><th>Stock</th><th>Vehicle</th><th>Category</th><th>Price</th><th>AI</th><th>Status</th><th>Actions</th></tr></thead>
        <tbody>{shown.map((v: any) => <tr key={v.id}>
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
            <button type="button" className="btn-danger" disabled={busy} onClick={() => hide(v.id, v.stock_no)}>Hide</button>
          </div></td>
        </tr>)}</tbody>
      </table>
      {!shown.length ? <p className="muted" style={{ padding: 14 }}>No vehicles with this status.</p> : null}
    </div>
  </>;
}
