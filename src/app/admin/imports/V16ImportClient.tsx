'use client';
import { useEffect, useState } from 'react';

type Item = {
  id: number;
  source_message_id: string;
  source?: string;
  raw_payload: any;
  proposed_vehicle: any;
  review_status: string;
  approved_vehicle_id?: number;
  vehicle_id?: number;
  matched_vehicle_id?: number;
  match_status?: string;
  match_type?: string;
  match_confidence?: number;
  duplicate_risk?: number;
  extraction_confidence?: number;
  approval_method?: string;
  approved_by?: string;
  evidence_json?: any;
  group_external_id?: string;
  stock_no?: string;
  matched_stock_no?: string;
  matched_brand?: string;
  matched_model?: string;
  matched_model_year?: number;
  matched_vehicle_status?: string;
  vehicle_status?: string;
  created_at: string;
  last_observed_at?: string;
  media_count: number;
  media_urls?: string | null;
  match_candidates?: any;
  change_proposals?: any;
};
function parse(x: any) {
  if (!x) return [];
  if (Array.isArray(x)) return x;
  if (typeof x === 'object') return x;
  try { const value = JSON.parse(x); return Array.isArray(value) ? value : []; } catch { return []; }
}
function object(x: any) {
  if (!x) return {};
  if (typeof x === 'object') return x;
  try { return JSON.parse(x); } catch { return {}; }
}
const CATS = ['car', 'motorcycle', 'truck', 'van', 'bus', 'machinery', 'other'];

function ReviewForm({ it, onDone }: { it: Item; onDone: () => void }) {
  const proposed = object(it.proposed_vehicle);
  const candidates = parse(it.match_candidates);
  const proposals = parse(it.change_proposals);
  const [f, setF] = useState<any>({
    category: proposed.category || 'car', brand: proposed.brand || '', model: proposed.model || '',
    trim_name: proposed.trim_name || '', model_year: proposed.model_year || '', mileage_km: proposed.mileage_km || '',
    engine: proposed.engine || '', fuel_type: proposed.fuel_type || '', transmission: proposed.transmission || '',
    steering: proposed.steering && proposed.steering !== 'unknown' ? proposed.steering : '',
    color: proposed.color || '', condition: proposed.condition || '',
    price_usd: proposed.price_usd ?? (String(proposed.price_currency || '').toUpperCase() === 'USD' ? proposed.price_value || '' : ''),
    description: proposed.description || '', ai_enabled: true,
    existing_vehicle_id: it.matched_vehicle_id || candidates[0]?.id || '',
  });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const set = (k: string) => (e: any) => setF({ ...f, [k]: e.target.value });

  async function review(
    action: 'approve' | 'reject' | 'merge' | 'apply_changes',
    options: { publishFacebook?: boolean; sellNow?: boolean; duplicateOverride?: boolean } = {},
  ) {
    if (action === 'reject' && !confirm('Reject this supplier post? Existing vehicles and prior history are preserved.')) return;
    if (action === 'merge' && !Number(f.existing_vehicle_id)) { setErr('Choose an existing vehicle ID before merging.'); return; }
    const risk = Number(it.duplicate_risk ?? (it.match_status === 'new' ? 0 : it.match_status === 'confirmed' ? 1 : it.match_confidence));
    if (options.duplicateOverride && !confirm(`Duplicate risk is ${Math.round(Math.max(0, Math.min(1, risk)) * 100)}%.\n\nPublish anyway? This override will be recorded in the audit log.`)) return;
    setBusy(true); setErr('');
    const vehicle = action === 'merge'
      ? { existing_vehicle_id: Number(f.existing_vehicle_id), apply_changes: false }
      : action === 'approve' || action === 'apply_changes' ? f : {};
    const r = await fetch('/api/admin/imports/group', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: it.id, action, vehicle, options }),
    });
    const j = await r.json().catch(() => ({}));
    setBusy(false);
    if (!r.ok) { setErr(j.error || 'Review failed'); return; }
    onDone();
  }

  const risk = Number(it.duplicate_risk ?? (it.match_status === 'new' ? 0 : it.match_status === 'confirmed' ? 1 : it.match_confidence));
  const highRisk = Number.isFinite(risk) && risk >= 0.8;
  const canApproveNew = !!it.vehicle_id && Number(it.vehicle_id) !== Number(it.matched_vehicle_id || 0);
  async function publishExplicitly(facebook: boolean) {
    if (!confirm(facebook
      ? 'Publish this vehicle to Sell Now and the configured Facebook Page?'
      : 'Publish this vehicle to Sell Now now?')) return;
    if (highRisk) {
      await review(canApproveNew ? 'approve' : 'merge', {
        sellNow: true, publishFacebook: facebook, duplicateOverride: true,
      });
    } else {
      await review(canApproveNew ? 'approve' : 'merge', { sellNow: true, publishFacebook: facebook });
    }
  }

  const field = (k: string, label: string, type = 'text') =>
    <label style={{ display: 'grid', gap: 4, fontSize: 13 }}>{label}<input type={type} value={f[k]} onChange={set(k)} /></label>;
  const unresolved = it.review_status === 'pending';
  const hasDraft = !!it.vehicle_id && Number(it.vehicle_id) !== Number(it.matched_vehicle_id || 0);

  return <div style={{ display: 'grid', gap: 10, marginTop: 10 }}>
    {(it.match_status === 'possible' || it.match_status === 'confirmed') && <div style={{ border: '1px solid #e4b44d', background: '#fff8df', padding: 10, borderRadius: 8 }}>
      <b>{it.match_status === 'confirmed' ? 'Existing vehicle detected' : 'Possible duplicate — review required'}</b>
      <p style={{ margin: '5px 0' }}>
        Duplicate risk {Math.round(Number(it.duplicate_risk ?? it.match_confidence ?? 0) * 100)}% · Match confidence {Math.round(Number(it.match_confidence || 0) * 100)}% · {it.match_type || 'similar specifications'}
      </p>
      {it.matched_vehicle_id && <p style={{ margin: 0 }}>
        Candidate #{it.matched_vehicle_id} {it.matched_brand || ''} {it.matched_model || ''} {it.matched_model_year || ''}
        {' '}({it.matched_stock_no || 'no stock number'}, {it.matched_vehicle_status || 'unknown'})
      </p>}
      {candidates.length > 0 && <small>All candidates: {candidates.map((candidate: any) => `#${candidate.id} ${candidate.brand || ''} ${candidate.model || ''} (${Math.round(Number(candidate.confidence || 0) * 100)}%)`).join(' · ')}</small>}
    </div>}

    {proposals.length > 0 && <div className="card" style={{ padding: 12, boxShadow: 'none', border: '1px solid #d8e2ec' }}>
      <b>Proposed changes (nothing is applied automatically)</b>
      <ul>
        {proposals.map((proposal: any) => <li key={proposal.id}>
          {proposal.type.replaceAll('_', ' ')} {proposal.field || ''}: {proposal.old_value ?? 'empty'} → {proposal.status === 'applied' ? '' : proposal.new_value} ({proposal.status})
        </li>)}
      </ul>
    </div>}

    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(160px,1fr))', gap: 10 }}>
      <label style={{ display: 'grid', gap: 4, fontSize: 13 }}>Category<select value={f.category} onChange={set('category')}>{CATS.map((category) => <option key={category} value={category}>{category}</option>)}</select></label>
      {field('brand', 'Make *')}{field('model', 'Model *')}{field('trim_name', 'Trim')}
      {field('model_year', 'Year', 'number')}{field('mileage_km', 'Mileage (km)', 'number')}
      {field('engine', 'Engine')}{field('fuel_type', 'Fuel')}{field('transmission', 'Transmission')}
      <label style={{ display: 'grid', gap: 4, fontSize: 13 }}>Steering<select value={f.steering} onChange={set('steering')}><option value="">Not confirmed</option><option value="LHD">LHD</option><option value="RHD">RHD</option></select></label>
      {field('color', 'Color')}{field('condition', 'Condition')}
      <label style={{ display: 'grid', gap: 4, fontSize: 13 }}>Approved selling price (USD)<input type="number" min="1" placeholder="Required before Facebook publication" value={f.price_usd} onChange={set('price_usd')} /></label>
      <label style={{ display: 'grid', gap: 4, fontSize: 13 }}>Merge into vehicle ID<input type="number" min="1" value={f.existing_vehicle_id} onChange={set('existing_vehicle_id')} /></label>
    </div>
    {(proposed.price_value || proposed.price_usd) && <p className="muted" style={{ margin: 0 }}>
      Extracted supplier price (internal): {proposed.price_currency || 'currency unknown'} {proposed.price_value || proposed.price_usd}
    </p>}
    <label style={{ display: 'grid', gap: 4, fontSize: 13 }}>Public description (optional — phone numbers, links and supplier contacts are removed)<textarea rows={3} value={f.description} onChange={set('description')} /></label>
    {err && <p style={{ color: '#b3261e', margin: 0 }}>{err}</p>}
    <label style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 14 }}><input type="checkbox" checked={f.ai_enabled !== false} onChange={(e) => setF((x: any) => ({ ...x, ai_enabled: e.target.checked }))} />Make this approved vehicle available to the customer AI</label>
    {unresolved && <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
      {hasDraft && <button className="btn" disabled={busy} onClick={() => review('approve', { sellNow: true, publishFacebook: false, duplicateOverride: highRisk })}>{busy ? 'Working…' : highRisk ? 'Override → Sell Now' : 'Approve as new → Sell Now'}</button>}
      {!hasDraft && it.matched_vehicle_id && <button className="btn" disabled={busy} onClick={() => publishExplicitly(false)}>{busy ? 'Working…' : highRisk ? 'Publish duplicate → Sell Now' : 'Publish → Sell Now'}</button>}
      {(hasDraft || it.matched_vehicle_id) && <button className="btn dark" disabled={busy} onClick={() => publishExplicitly(true)}>{busy ? 'Working…' : highRisk ? 'Publish duplicate → Sell Now + Facebook' : 'Publish → Sell Now + Facebook'}</button>}
      <button className="btn dark" disabled={busy} onClick={() => review('merge')}>Confirm same vehicle / merge</button>
      {proposals.some((proposal: any) => proposal.status === 'pending') && <button className="btn" disabled={busy} onClick={() => review('apply_changes')}>Apply proposed updates</button>}
      <button className="btn dark" disabled={busy} onClick={() => review('reject')}>Reject</button>
    </div>}
  </div>;
}

export default function V16ImportClient() {
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const [items, setItems] = useState<Item[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<'pending' | 'all'>('pending');

  async function load() {
    setLoading(true);
    const r = await fetch('/api/admin/imports/group', { cache: 'no-store' });
    const j = await r.json().catch(() => ({ items: [] }));
    setItems(j.items || []);
    setLoading(false);
  }
  useEffect(() => { void load(); }, []);
  async function runLegacyImport() {
    setBusy(true); setMsg('Importing…');
    const r = await fetch('/api/admin/imports/v16-last50', { method: 'POST' });
    const j = await r.json().catch(() => ({}));
    setBusy(false);
    setMsg(r.ok ? `Done: ${j.created} added, ${j.skipped} already existed.` : j.error || 'Import failed');
  }
  const visible = filter === 'pending' ? items.filter((item) => item.review_status === 'pending') : items;

  return <>
    <div className="card" style={{ marginBottom: 18 }}>
      <h2>Legacy 50-vehicle import</h2>
      <p>This explicit admin import is safe to run more than once; existing stock numbers are skipped and existing vehicles are not republished.</p>
      <button className="btn" onClick={runLegacyImport} disabled={busy}>{busy ? 'Working…' : 'Import 50 vehicles'}</button>
      {msg && <p>{msg}</p>}
    </div>
    <div className="card">
      <div className="sectionHead">
        <div>
          <h2>WhatsApp Group Inventory Review</h2>
          <p>Exact repeats are deduplicated. Possible duplicates stay in review. Changes to an existing vehicle require approval and never create a second vehicle or publication.</p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <select value={filter} onChange={(e) => setFilter(e.target.value as any)}><option value="pending">Pending review</option><option value="all">All imports</option></select>
          <button className="miniBtn" onClick={load}>Refresh</button>
        </div>
      </div>
      {loading ? <p>Loading…</p> : visible.length === 0 ? <p className="muted">No imports in this view.</p> :
        <div style={{ display: 'grid', gap: 12 }}>{visible.map((it) => {
          const raw = object(it.raw_payload);
          const proposed = object(it.proposed_vehicle);
          const urls = String(it.media_urls || '').split('\n').filter(Boolean);
          return <div key={it.id} style={{ border: '1px solid #d8e2ec', borderRadius: 10, padding: 14 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
              <b>#{it.id} {proposed.category === 'motorcycle' ? 'Motorcycle · ' : ''}{proposed.brand || 'Unknown make'} {proposed.model || 'Unknown model'} {proposed.model_year || ''}</b>
              <span>{it.source === 'telegram' ? 'TELEGRAM · ' : ''}{it.review_status.toUpperCase()} · {String(it.match_status || 'new').replaceAll('_', ' ')} {it.stock_no ? `· ${it.stock_no}` : ''}{it.vehicle_status ? ` · ${it.vehicle_status.replaceAll('_', ' ')}` : ''}</span>
            </div>
            <p style={{ margin: '8px 0', whiteSpace: 'pre-wrap' }}>{raw.text || 'No text (photos only)'}</p>
            {urls.length > 0 && <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>{urls.slice(0, 12).map((url) => <a key={url} href={url} target="_blank" rel="noreferrer"><img src={url} alt="" style={{ width: 84, height: 64, objectFit: 'cover', borderRadius: 6, border: '1px solid #d8e2ec' }} /></a>)}</div>}
            <p className="muted">Photos: {it.media_count || 0}{raw.mergedMessageIds?.length > 1 ? ` · merged from ${raw.mergedMessageIds.length} messages` : ''} · Extraction confidence: {it.extraction_confidence == null ? 'unknown' : `${Math.round(Number(it.extraction_confidence) * 100)}%`} · Source: {it.source_message_id}</p>
            {it.review_status === 'pending' && <ReviewForm it={it} onDone={load} />}
            {it.approved_vehicle_id && <p>Existing vehicle: <a href={`/admin/vehicles?edit=${it.approved_vehicle_id}`}>#{it.approved_vehicle_id}</a> · <a href={`/vehicles/${it.approved_vehicle_id}`} target="_blank" rel="noreferrer">public listing</a></p>}
          </div>;
        })}</div>
      }
    </div>
  </>;
}
