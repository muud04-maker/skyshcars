'use client';
import { useMemo, useRef, useState } from 'react';

/*
  ONE-page vehicle form, shared by Add Vehicle and Edit Vehicle.
  Everything lives on this page (basic, details, pricing, photos, sales/visibility) and there is a
  single Save action - no wizard steps, no second page for photos.
  Public visibility (status) and the AI Catalog switch are separate controls on purpose.
*/
const CATS = ['car', 'motorcycle', 'truck', 'van', 'bus', 'machinery', 'other'];
const FUELS = ['petrol', 'diesel', 'hybrid', 'electric'];
const TRANSMISSIONS = ['automatic', 'manual'];
const STATUSES: [string, string][] = [['available', 'Available'], ['reserved', 'Reserved'], ['sold', 'Sold'], ['pending_verification', 'Pending verification'], ['hidden', 'Hidden']];
const EMPTY = {
  category: 'car', stock_no: '', brand: '', model: '', model_year: '', trim_name: '', manufacturing_date: '',
  mileage_km: '', engine: '', fuel_type: '', transmission: '', steering: 'LHD', color: '', drivetrain: '', body_type: '',
  price_usd: '', location: 'China', status: 'available', description: '',
  ai_enabled: true, image_url: '',
};
type Photo = { file?: File; url: string; id?: number };

export default function VehicleForm({ mode, initial, onSaved, onCancel }: { mode: 'create' | 'edit'; initial?: any; onSaved?: (v: { id: number; stock_no: string }) => void; onCancel?: () => void }) {
  const [f, setF] = useState<any>({ ...EMPTY, ...(initial || {}) });
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [cover, setCover] = useState(0);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [dup, setDup] = useState<{ stock_no: string; id?: number; title?: string } | null>(null);
  const [saved, setSaved] = useState<{ id: number; stock_no: string } | null>(null);
  const busyRef = useRef(false);
  const set = (k: string, v: any) => { setF((x: any) => ({ ...x, [k]: v })); setErrors((e) => ({ ...e, [k]: '' })); };
  const title = useMemo(() => [f.model_year, f.brand, f.model, f.trim_name].filter(Boolean).join(' '), [f.model_year, f.brand, f.model, f.trim_name]);

  function reset() {
    setF({ ...EMPTY });
    setPhotos([]); setCover(0); setErrors({}); setMsg(''); setDup(null); setSaved(null);
  }
  async function checkStock(value: string) {
    const stock = String(value || '').trim();
    if (!stock) { setDup(null); return true; }
    try {
      const r = await fetch(`/api/admin/vehicles/check-stock?stock_no=${encodeURIComponent(stock)}`, { cache: 'no-store' });
      const j = await r.json().catch(() => ({}));
      if (j?.exists) { setDup({ stock_no: stock, id: j.vehicle?.id, title: j.vehicle?.title }); return false; }
      setDup(null); return true;
    } catch { setDup(null); return true; }
  }
  function addPhotos(files: FileList | null) {
    if (!files) return;
    const next = [...photos];
    for (const file of Array.from(files)) if (file.type.startsWith('image/')) next.push({ file, url: URL.createObjectURL(file) });
    setPhotos(next.slice(0, 12));
    setErrors((e) => ({ ...e, photos: '' }));
  }
  function removePhoto(i: number) { setPhotos(photos.filter((_p, idx) => idx !== i)); setCover((c) => (i === c ? 0 : i < c ? c - 1 : c)); }
  function move(i: number, dir: -1 | 1) {
    const j = i + dir; if (j < 0 || j >= photos.length) return;
    const n = [...photos]; [n[i], n[j]] = [n[j], n[i]]; setPhotos(n);
    setCover((c) => (c === i ? j : c === j ? i : c));
  }
  function validate() {
    const e: Record<string, string> = {};
    if (!String(f.brand || '').trim()) e.brand = 'Brand is required.';
    if (!String(f.model || '').trim()) e.model = 'Model is required.';
    if (f.model_year && (Number(f.model_year) < 1950 || Number(f.model_year) > new Date().getFullYear() + 1)) e.model_year = 'Enter a valid year.';
    if (f.mileage_km && !Number.isFinite(Number(f.mileage_km))) e.mileage_km = 'Mileage must be a number.';
    if (f.price_usd && !Number.isFinite(Number(f.price_usd))) e.price_usd = 'Price must be a number.';
    setErrors(e);
    return Object.keys(e).length === 0;
  }

  async function save(ev?: any) {
    ev?.preventDefault?.();
    if (busyRef.current) return;                       // double-click protection
    if (!validate()) { setMsg('Please fix the highlighted fields.'); return; }
    if (mode === 'create' && f.stock_no && !(await checkStock(f.stock_no))) { setMsg(''); return; }
    busyRef.current = true; setBusy(true); setMsg(mode === 'create' ? 'Saving vehicle...' : 'Saving changes...');
    try {
      const stock = String(f.stock_no || '').trim() || `SC${String(Date.now()).slice(-6)}`;
      const body: any = { ...f, stock_no: stock, ai_enabled: !!f.ai_enabled,
        model_year: f.model_year === '' ? null : Number(f.model_year),
        mileage_km: f.mileage_km === '' ? null : Number(f.mileage_km),
        price_usd: f.price_usd === '' ? null : Number(f.price_usd) };
      if (f.body_type) body.description = [f.description, `Body type: ${f.body_type}`].filter(Boolean).join('\n');
      const r = await fetch('/api/admin/vehicles', {
        method: mode === 'create' ? 'POST' : 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(mode === 'create' ? body : { ...body, id: initial?.id }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || j.ok === false) {
        if (j.code === 'DUPLICATE_STOCK') { setDup({ stock_no: j.existing?.stock_no || stock, id: j.existing?.id, title: j.existing?.title }); setSaved(null); return; }
        const field = j.code === 'BRAND_REQUIRED' ? 'brand' : j.code === 'MODEL_REQUIRED' ? 'model' : j.code === 'STOCK_INVALID' ? 'stock_no' : '';
        if (field) setErrors((e) => ({ ...e, [field]: j.message || 'Please check this field.' }));
        setMsg(j.message || j.error || 'Could not save the vehicle. Please try again.');
        return;
      }
      const id = Number(mode === 'create' ? j.id : initial?.id);
      const imageErrors: string[] = [];
      const pending = photos.filter((p) => p.file);
      let uploaded: any[] = [];
      if (id && pending.length) {
        setMsg(`Uploading ${pending.length} photo(s)...`);
        const fd = new FormData();
        fd.set('vehicle_id', String(id));
        for (const p of pending) fd.append('files', p.file as File);
        const ur = await fetch('/api/admin/media/upload', { method: 'POST', body: fd });
        const uj = await ur.json().catch(() => ({}));
        if (!ur.ok) imageErrors.push(uj.error || 'Photo upload failed');
        else uploaded = uj.images || [];
      }
      if (uploaded.length && cover > 0 && uploaded[cover]) {
        await fetch('/api/admin/media/manage', { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id: uploaded[cover].id, action: 'cover' }) }).catch(() => {});
      }
      if (imageErrors.length) setErrors((e) => ({ ...e, photos: imageErrors.join('; ') }));
      setSaved({ id, stock_no: stock });
      setMsg('');
      onSaved?.({ id, stock_no: stock });
    } catch (e: any) {
      setMsg('Could not save the vehicle. Please check your connection and try again.');
    } finally { busyRef.current = false; setBusy(false); }
  }

  if (saved) return <div className="card">
    <h2 style={{ marginTop: 0 }}>Vehicle saved successfully</h2>
    <p>Stock: <b>{saved.stock_no}</b>{photos.length ? ` | ${photos.length} photo(s)` : ''}</p>
    {errors.photos ? <p className="error">{errors.photos}</p> : null}
    <div className="pager">
      <a className="btn-info" href={`/vehicles/${saved.id}`} target="_blank" rel="noreferrer">View vehicle</a>
      <a className="btn-neutral" href="/admin/vehicles">Edit vehicle</a>
      <button type="button" className="btn-primary" onClick={reset}>+ Add another vehicle</button>
      <a className="btn-neutral" href="/admin/vehicles">Back to inventory</a>
    </div>
  </div>;

  return <form className="vehicleForm card" onSubmit={save} style={{ maxWidth: 1100 }}>
    {dup ? <div className="dupAlert">
      <b>Stock number {dup.stock_no} already exists.</b>
      <div>{dup.title ? `${dup.title} already uses this stock number.` : 'Another vehicle already uses this stock number.'} Choose a different stock number to continue.</div>
      <div className="actions">
        <a className="btn-info" href="/admin/vehicles">View existing vehicle</a>
        <button type="button" className="btn-primary" onClick={() => { setDup(null); set('stock_no', ''); }}>Use another stock number</button>
      </div>
    </div> : null}

    <h2 style={{ marginTop: 0 }}>Basic information</h2>
    <div className="formGrid">
      <label>Category<select value={f.category} onChange={(e) => set('category', e.target.value)}>{CATS.map((c) => <option key={c} value={c}>{c}</option>)}</select></label>
      <label>Brand *<input value={f.brand} onChange={(e) => set('brand', e.target.value)} placeholder="Toyota" />{errors.brand ? <small className="error">{errors.brand}</small> : null}</label>
      <label>Model *<input value={f.model} onChange={(e) => set('model', e.target.value)} placeholder="Corolla" />{errors.model ? <small className="error">{errors.model}</small> : null}</label>
      <label>Year<input type="number" value={f.model_year} onChange={(e) => set('model_year', e.target.value)} placeholder="2019" />{errors.model_year ? <small className="error">{errors.model_year}</small> : null}</label>
      <label>Trim<input value={f.trim_name} onChange={(e) => set('trim_name', e.target.value)} /></label>
      <label>Stock number<input value={f.stock_no} onChange={(e) => { set('stock_no', e.target.value); setDup(null); }} onBlur={(e) => checkStock(e.target.value)} placeholder="blank = auto-generate" />{errors.stock_no ? <small className="error">{errors.stock_no}</small> : null}</label>
      <label>Manufacturing date<input value={f.manufacturing_date} onChange={(e) => set('manufacturing_date', e.target.value)} placeholder="e.g. 2019-03" /></label>
    </div>

    <h2>Vehicle details</h2>
    <div className="formGrid">
      <label>Mileage km<input type="number" value={f.mileage_km} onChange={(e) => set('mileage_km', e.target.value)} />{errors.mileage_km ? <small className="error">{errors.mileage_km}</small> : null}</label>
      <label>Engine<input value={f.engine} onChange={(e) => set('engine', e.target.value)} placeholder="2.0L" /></label>
      <label>Fuel<select value={f.fuel_type} onChange={(e) => set('fuel_type', e.target.value)}><option value="">-</option>{FUELS.map((x) => <option key={x} value={x}>{x}</option>)}</select></label>
      <label>Transmission<select value={f.transmission} onChange={(e) => set('transmission', e.target.value)}><option value="">-</option>{TRANSMISSIONS.map((x) => <option key={x} value={x}>{x}</option>)}</select></label>
      <label>Steering<select value={f.steering} onChange={(e) => set('steering', e.target.value)}><option>LHD</option><option>RHD</option><option value="unknown">unknown</option></select></label>
      <label>Color<input value={f.color} onChange={(e) => set('color', e.target.value)} /></label>
      <label>Body type<input value={f.body_type} onChange={(e) => set('body_type', e.target.value)} placeholder="SUV / sedan / pickup" /></label>
      <label>Drivetrain<input value={f.drivetrain} onChange={(e) => set('drivetrain', e.target.value)} placeholder="2WD / 4WD" /></label>
    </div>

    <h2>Pricing &amp; location</h2>
    <div className="formGrid">
      <label>Selling price USD<input type="number" value={f.price_usd} onChange={(e) => set('price_usd', e.target.value)} />{errors.price_usd ? <small className="error">{errors.price_usd}</small> : null}</label>
      <label>Location<input value={f.location} onChange={(e) => set('location', e.target.value)} /></label>
    </div>
    <p className="muted">Supplier cost, margin and sourcing details are private and are never entered or shown here.</p>

    <h2>Exact vehicle photos</h2>
    <p className="muted">These photos are what customers and the AI will receive for this stock unit. Only exact stock photos of this vehicle belong here.</p>
    <input type="file" accept="image/*" multiple onChange={(e) => addPhotos(e.target.files)} style={{ padding: 10 }} />
    {errors.photos ? <small className="error">{errors.photos}</small> : null}
    <div className="catalogCards" style={{ marginTop: 10 }}>
      {photos.map((p, i) => <div className="catalogCard" key={p.url}>
        <img src={p.url} alt="" style={{ width: '100%', height: 130, objectFit: 'cover', borderRadius: 8, outline: i === cover ? '3px solid #0b7a3b' : 'none' }} />
        <div className="catalogRow">
          {i === cover ? <b>Cover</b> : <button type="button" className="miniBtn" onClick={() => setCover(i)}>Set cover</button>}
          <button type="button" className="miniBtn" onClick={() => move(i, -1)} disabled={i === 0}>Up</button>
          <button type="button" className="miniBtn" onClick={() => move(i, 1)} disabled={i === photos.length - 1}>Down</button>
          <button type="button" className="btn-danger miniBtn" onClick={() => removePhoto(i)}>Remove</button>
        </div>
      </div>)}
    </div>

    <h2>Sales &amp; visibility</h2>
    <div className="formGrid">
      <label>Status (public website)<select value={f.status} onChange={(e) => set('status', e.target.value)}>{STATUSES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></label>
    </div>
    <label className="automationToggle" style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
      <input type="checkbox" checked={!!f.ai_enabled} onChange={(e) => set('ai_enabled', e.target.checked)} /> <span>Let the AI sell this vehicle (AI Catalog) - separate from the public website status</span>
    </label>
    <label className="wide">Description<textarea value={f.description} onChange={(e) => set('description', e.target.value)} /></label>
    {f.image_url !== undefined ? <label>Extra exact photo URL<input value={f.image_url || ''} onChange={(e) => set('image_url', e.target.value)} placeholder="https://..." /></label> : null}

    {msg ? <p className={errors.brand || errors.model ? 'error' : 'muted'}><b>{msg}</b></p> : null}
    <div className="pager" style={{ position: 'sticky', bottom: 0, background: '#fff', paddingTop: 10 }}>
      <button className="btn-primary" type="submit" disabled={busy}>{busy ? 'Saving...' : mode === 'create' ? 'Save Vehicle' : 'Save changes'}</button>
      {mode === 'create' ? <button type="button" className="btn-neutral" disabled={busy} onClick={reset}>Clear form</button> : null}
      {mode === 'edit' ? <button type="button" className="btn-neutral" disabled={busy} onClick={onCancel}>Cancel</button> : null}
      <a className="btn-neutral" href="/admin/vehicles">Back to inventory</a>
    </div>
  </form>;
}
