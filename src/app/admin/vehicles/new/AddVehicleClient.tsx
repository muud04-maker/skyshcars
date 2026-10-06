'use client';
import { useMemo, useState } from 'react';

const STEPS = ['Basic', 'Details', 'Pricing', 'Photos', 'Sales'];
const CATS = ['car', 'motorcycle', 'truck', 'van', 'bus', 'machinery', 'other'];

export default function AddVehicleClient() {
  const [step, setStep] = useState(1);
  const [f, setF] = useState<any>({
    category: 'car', stock_no: '', brand: '', model: '', model_year: '', trim_name: '',
    mileage_km: '', engine: '', fuel_type: '', transmission: '', steering: 'LHD', color: '', body_type: '', drivetrain: '',
    price_usd: '', location: 'China', status: 'available',
    ai_enabled: true, post_facebook: false,
  });
  const [photos, setPhotos] = useState<{ file: File; url: string }[]>([]);
  const [cover, setCover] = useState(0);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [done, setDone] = useState<{ id: number; imageErrors: string[] } | null>(null);
  const set = (k: string, v: any) => setF((x: any) => ({ ...x, [k]: v }));

  const canNext = useMemo(() => {
    if (step === 1) return !!String(f.brand || '').trim() && !!String(f.model || '').trim();
    return true;
  }, [step, f]);

  function addPhotos(files: FileList | null) {
    if (!files) return;
    const next = [...photos];
    for (const file of Array.from(files)) if (file.type.startsWith('image/')) next.push({ file, url: URL.createObjectURL(file) });
    setPhotos(next.slice(0, 12));
  }
  function removePhoto(i: number) { const n = photos.filter((_p, idx) => idx !== i); setPhotos(n); setCover((c) => (i === c ? 0 : i < c ? c - 1 : c)); }
  function move(i: number, dir: -1 | 1) {
    const j = i + dir; if (j < 0 || j >= photos.length) return;
    const n = [...photos]; [n[i], n[j]] = [n[j], n[i]]; setPhotos(n);
    setCover((c) => (c === i ? j : c === j ? i : c));
  }

  async function save() {
    if (!String(f.brand || '').trim() || !String(f.model || '').trim()) { setMsg('Brand and model are required.'); setStep(1); return; }
    setBusy(true); setMsg('Saving vehicle...');
    const stock = String(f.stock_no || '').trim() || `SC${String(Date.now()).slice(-6)}`;
    const body = {
      ...f, stock_no: stock,
      model_year: f.model_year === '' ? null : Number(f.model_year),
      mileage_km: f.mileage_km === '' ? null : Number(f.mileage_km),
      price_usd: f.price_usd === '' ? null : Number(f.price_usd),
      description: f.body_type ? `Body type: ${f.body_type}` : undefined,
      ai_enabled: !!f.ai_enabled,
    };
    const r = await fetch('/api/admin/vehicles', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) { setBusy(false); setMsg(j.error || 'Could not save the vehicle.'); return; }
    const id = Number(j.id);
    const imageErrors: string[] = [];
    let uploaded: any[] = [];
    if (photos.length) {
      setMsg(`Uploading ${photos.length} photo(s)...`);
      const fd = new FormData();
      fd.set('vehicle_id', String(id));
      for (const p of photos) fd.append('files', p.file);
      const ur = await fetch('/api/admin/media/upload', { method: 'POST', body: fd });
      const uj = await ur.json().catch(() => ({}));
      if (!ur.ok) imageErrors.push(uj.error || 'Photo upload failed');
      else uploaded = uj.images || [];
    }
    if (uploaded.length && cover > 0 && uploaded[cover]) {
      await fetch('/api/admin/media/manage', { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id: uploaded[cover].id, action: 'cover' }) }).catch(() => {});
    }
    setBusy(false);
    setDone({ id, imageErrors });
  }

  if (done) return <div className="card">
    <h2 style={{ marginTop: 0 }}>Vehicle saved</h2>
    <p>The vehicle was created{photos.length ? ` with ${photos.length} photo(s)` : ''}. It is public with status <b>{String(f.status).replace('_', ' ')}</b>{f.ai_enabled ? ' and the AI can sell it' : ''}.</p>
    {done.imageErrors.length ? <p className="error">Some photos were not uploaded: {done.imageErrors.join('; ')}. You can add them on the Vehicle Photos page.</p> : null}
    <div className="pager">
      <a className="btn" href={`/vehicles/${done.id}`} target="_blank" rel="noreferrer">Open vehicle page</a>
      <a className="miniBtn" href="/admin/vehicles">Back to inventory</a>
      <a className="miniBtn" href="/admin/ai-catalog">AI Catalog</a>
      <button className="miniBtn" onClick={() => { setDone(null); setStep(1); setPhotos([]); setCover(0); setMsg(''); }}>Add another vehicle</button>
    </div>
  </div>;

  return <div className="card">
    <div className="pager">
      {STEPS.map((s, i) => <button key={s} type="button" className={step === i + 1 ? 'btn' : 'miniBtn'} onClick={() => setStep(i + 1)}>{i + 1}. {s}</button>)}
    </div>

    {step === 1 ? <div className="formGrid" style={{ marginTop: 12 }}>
      <label>Category<select value={f.category} onChange={(e) => set('category', e.target.value)}>{CATS.map((c) => <option key={c} value={c}>{c}</option>)}</select></label>
      <label>Brand *<input value={f.brand} onChange={(e) => set('brand', e.target.value)} placeholder="Toyota" /></label>
      <label>Model *<input value={f.model} onChange={(e) => set('model', e.target.value)} placeholder="Corolla" /></label>
      <label>Year<input type="number" value={f.model_year} onChange={(e) => set('model_year', e.target.value)} placeholder="2019" /></label>
      <label>Trim<input value={f.trim_name} onChange={(e) => set('trim_name', e.target.value)} placeholder="Hybrid" /></label>
      <label>Stock number<input value={f.stock_no} onChange={(e) => set('stock_no', e.target.value)} placeholder="leave empty to auto-generate" /></label>
    </div> : null}

    {step === 2 ? <div className="formGrid" style={{ marginTop: 12 }}>
      <label>Mileage km<input type="number" value={f.mileage_km} onChange={(e) => set('mileage_km', e.target.value)} /></label>
      <label>Engine<input value={f.engine} onChange={(e) => set('engine', e.target.value)} placeholder="2.0L" /></label>
      <label>Fuel<select value={f.fuel_type} onChange={(e) => set('fuel_type', e.target.value)}><option value="">-</option><option>petrol</option><option>diesel</option><option>hybrid</option><option>electric</option></select></label>
      <label>Transmission<select value={f.transmission} onChange={(e) => set('transmission', e.target.value)}><option value="">-</option><option>automatic</option><option>manual</option></select></label>
      <label>Steering<select value={f.steering} onChange={(e) => set('steering', e.target.value)}><option>LHD</option><option>RHD</option><option>unknown</option></select></label>
      <label>Color<input value={f.color} onChange={(e) => set('color', e.target.value)} /></label>
      <label>Body type<input value={f.body_type} onChange={(e) => set('body_type', e.target.value)} placeholder="SUV / sedan / pickup" /></label>
      <label>Drivetrain<input value={f.drivetrain} onChange={(e) => set('drivetrain', e.target.value)} placeholder="2WD / 4WD" /></label>
    </div> : null}

    {step === 3 ? <div className="formGrid" style={{ marginTop: 12 }}>
      <label>Selling price USD<input type="number" value={f.price_usd} onChange={(e) => set('price_usd', e.target.value)} /></label>
      <label>Location<input value={f.location} onChange={(e) => set('location', e.target.value)} /></label>
      <label>Availability<select value={f.status} onChange={(e) => set('status', e.target.value)}>
        <option value="available">Available</option><option value="reserved">Reserved</option>
        <option value="pending_verification">Pending verification</option><option value="hidden">Hidden</option>
      </select></label>
    </div> : null}

    {step === 4 ? <div style={{ marginTop: 12 }}>
      <label style={{ display: 'block', fontWeight: 750 }}>Exact stock photos (max 12)
        <input type="file" accept="image/*" multiple onChange={(e) => addPhotos(e.target.files)} style={{ padding: 10 }} />
      </label>
      <p className="muted">Use the phone camera or gallery. These are treated as exact photos of this unit. The first photo is the cover unless you change it.</p>
      <div className="catalogCards">
        {photos.map((p, i) => <div className="catalogCard" key={p.url}>
          <img src={p.url} alt="" />
          <div className="catalogRow">{i === cover ? <b>Cover</b> : <button type="button" className="miniBtn" onClick={() => setCover(i)}>Set cover</button>}
            <button type="button" className="miniBtn" onClick={() => move(i, -1)} disabled={i === 0}>Up</button>
            <button type="button" className="miniBtn" onClick={() => move(i, 1)} disabled={i === photos.length - 1}>Down</button>
            <button type="button" className="miniBtn danger" onClick={() => removePhoto(i)}>Remove</button>
          </div>
        </div>)}
      </div>
    </div> : null}

    {step === 5 ? <div style={{ marginTop: 12 }}>
      <label className="automationToggle" style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <input type="checkbox" checked={f.ai_enabled} onChange={(e) => set('ai_enabled', e.target.checked)} /> <span>Let the AI sell this vehicle (WhatsApp + Messenger)</span>
      </label>
      <label className="automationToggle" style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 8 }}>
        <input type="checkbox" checked={f.post_facebook} onChange={(e) => set('post_facebook', e.target.checked)} /> <span>Post to Facebook after saving (runs when social automation is enabled)</span>
      </label>
      <p className="muted" style={{ marginTop: 10 }}>Summary: {[f.model_year, f.brand, f.model, f.trim_name].filter(Boolean).join(' ')} | {f.category} | {f.price_usd ? '$' + Number(f.price_usd).toLocaleString() : 'price on request'} | {f.status} | {photos.length} photo(s)</p>
    </div> : null}

    {msg && <p><b>{msg}</b></p>}
    <div className="pager">
      <button className="miniBtn" type="button" disabled={step === 1 || busy} onClick={() => setStep((s) => Math.max(1, s - 1))}>Back</button>
      <button className="miniBtn" type="button" disabled={step === 5 || busy || !canNext} onClick={() => setStep((s) => Math.min(5, s + 1))}>Next</button>
      <button className="btn" type="button" disabled={busy || !canNext} onClick={save}>{busy ? 'Saving...' : 'Save vehicle'}</button>
    </div>
  </div>;
}
