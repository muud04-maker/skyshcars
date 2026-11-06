'use client';
/*
  WhatsApp desk panels (Nov 7):
  - VehiclePicker: a real search-and-preview panel (type brand / model / year / stock / price, see
    thumbnails, send exact photos, insert details, or set the current car) instead of a long dropdown.
  - CustomerProfile: ONE editable place for everything we know about the customer (name, country,
    language, notes for the AI, and the AI-extracted memory facts). Saved to MySQL and used by the AI
    on its next reply. Each section can be collapsed; the whole panel can be hidden.
*/
import { useEffect, useMemo, useRef, useState } from 'react';
import { vehicleDisplayTitle } from '../../../lib/display-title';

const money = (v: any) => (Number(v) > 0 ? '$' + Number(v).toLocaleString('en-US') : 'Price on request');
const thumb = (v: any) => {
  const u = String(v?.cover_url || '');
  if (!u) return '';
  return u.startsWith('http') ? `/api/photo/${v.id}` : u;
};

/** Every word must match (so "yamaha 2016" finds the 2016 Yamahas). */
export function vehicleMatches(v: any, needle: string) {
  const hay = [v.stock_no, v.brand, v.model, v.trim_name, v.model_year, v.category, v.price_usd, v.color, v.fuel_type, v.transmission, vehicleDisplayTitle(v)]
    .map((x) => String(x == null ? '' : x).toLowerCase()).join(' ');
  const compactHay = hay.replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, '');
  return needle.toLowerCase().split(/\s+/).filter(Boolean)
    .every((w) => hay.includes(w) || compactHay.includes(w.replace(/[^a-z0-9]/g, '')));
}

type Kind = 'all' | 'car' | 'motorcycle';

export function VehiclePicker(props: {
  open: boolean; vehicles: any[]; loading?: boolean; placeholder: string; busy?: boolean;
  currentId?: number | null;
  onClose(): void; onSendPhotos(id: number): void; onSetCurrent(id: number): void; onInsert(text: string): void;
}) {
  const [q, setQ] = useState('');
  const [kind, setKind] = useState<Kind>('all');
  const [onlyAvailable, setOnlyAvailable] = useState(true);
  const [limit, setLimit] = useState(30);
  const box = useRef<HTMLInputElement | null>(null);
  useEffect(() => { if (props.open) setTimeout(() => box.current?.focus(), 30); }, [props.open]);
  useEffect(() => { setLimit(30); }, [q, kind, onlyAvailable]);
  const list = useMemo(() => props.vehicles.filter((v) => {
    if (onlyAvailable && String(v.status || '') !== 'available') return false;
    if (kind !== 'all' && String(v.category || '') !== kind) return false;
    return !q.trim() || vehicleMatches(v, q.trim());
  }), [props.vehicles, q, kind, onlyAvailable]);
  if (!props.open) return null;
  return <div className="vpOverlay" role="dialog" aria-label="Send a vehicle" onKeyDown={(e) => { if (e.key === 'Escape') props.onClose(); }}>
    <div className="vpPanel">
      <div className="vpHead">
        <input ref={box} value={q} onChange={(e) => setQ(e.target.value)} placeholder={props.placeholder} aria-label="Search vehicles" />
        <button type="button" className="miniBtn" onClick={props.onClose} aria-label="Close vehicle search">Close</button>
      </div>
      <div className="vpFilters">
        {(['all', 'car', 'motorcycle'] as Kind[]).map((k) => <button key={k} type="button" className={'vpChip' + (kind === k ? ' on' : '')} onClick={() => setKind(k)}>{k === 'all' ? 'All' : k === 'car' ? 'Cars' : 'Motorcycles'}</button>)}
        <label className="vpCheck"><input type="checkbox" checked={onlyAvailable} onChange={(e) => setOnlyAvailable(e.target.checked)} /> Available only</label>
        <span className="muted">{props.loading ? 'Loading...' : `${list.length} found`}</span>
      </div>
      <div className="vpList">
        {list.slice(0, limit).map((v) => {
          const title = vehicleDisplayTitle(v);
          const t = thumb(v);
          return <div key={v.id} className={'vpRow' + (Number(props.currentId) === Number(v.id) ? ' current' : '')}>
            <div className="vpThumb">{t ? <img src={t} alt="" loading="lazy" onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} /> : <span>No photo</span>}</div>
            <div className="vpInfo">
              <b>{title}</b>
              <small>{money(v.price_usd)} · {v.stock_no || 'no stock no.'} · {String(v.category || '')}{v.status && v.status !== 'available' ? ` · ${String(v.status).toUpperCase()}` : ''}</small>
              <small className="muted">{[v.mileage_km ? `${Number(v.mileage_km).toLocaleString()} km` : '', v.engine, v.transmission, v.fuel_type].filter(Boolean).join(' · ')}</small>
            </div>
            <div className="vpActions">
              <button type="button" className="btn-success" disabled={props.busy} onClick={() => props.onSendPhotos(Number(v.id))}>Send photos</button>
              <button type="button" className="miniBtn" onClick={() => props.onInsert(`${title}${v.stock_no ? ` (${v.stock_no})` : ''} - ${money(v.price_usd)}`)}>Insert details</button>
              <button type="button" className="miniBtn" onClick={() => props.onSetCurrent(Number(v.id))}>{Number(props.currentId) === Number(v.id) ? 'Current car' : 'Set current'}</button>
            </div>
          </div>;
        })}
        {!list.length && !props.loading ? <p className="muted" style={{ padding: 16 }}>No vehicle matches. Try the brand, model, year or stock number.</p> : null}
        {list.length > limit ? <button type="button" className="miniBtn" style={{ margin: 12 }} onClick={() => setLimit((n) => n + 30)}>Show more ({list.length - limit} left)</button> : null}
      </div>
    </div>
  </div>;
}

/** Labels for the customer memory fields the AI extracts (see FACT_KEYS in customer-facts.ts). */
export const FACT_LABELS: Record<string, string> = {
  preferred_category: 'Car or motorcycle', preferred_brand: 'Brand', preferred_model: 'Model', body_type: 'Body type',
  model_year_min: 'Year from', model_year_max: 'Year to', budget_min: 'Budget from (USD)', budget_max: 'Budget up to (USD)',
  destination_country: 'Destination country', destination_port: 'Destination port', shipping_needed: 'Needs shipping',
  purchase_intent: 'Buying stage', fuel: 'Fuel', transmission: 'Transmission', steering: 'Steering', color: 'Colour',
  language: 'Language', contact_preference: 'Contact preference', last_human_guidance: 'Staff guidance for the AI',
  rejected_vehicles: 'Declined vehicles (stock nos.)',
};
const MAIN_FACTS = ['preferred_category', 'preferred_brand', 'preferred_model', 'model_year_min', 'budget_max', 'destination_country', 'destination_port', 'purchase_intent', 'last_human_guidance'];

export type Profile = { full_name: string; country: string; preferred_language: string; notes: string; memory_summary: string; phone?: string };

export function CustomerProfile(props: {
  profile: Profile; facts: Record<string, string>; factSources: Record<string, string>; saving: string;
  onChange(p: Profile): void; onFactsChange(f: Record<string, string>): void; onSave(): void;
  children?: React.ReactNode;
}) {
  const [open, setOpen] = useState<Record<string, boolean>>({ profile: true, memory: true, more: false });
  const toggle = (k: string) => setOpen((o) => ({ ...o, [k]: !o[k] }));
  const p = props.profile;
  const keys = [...MAIN_FACTS, ...Object.keys(FACT_LABELS).filter((k) => !MAIN_FACTS.includes(k) && props.facts[k])];
  const extra = Object.keys(FACT_LABELS).filter((k) => !keys.includes(k));
  return <div className="cpPanel">
    <section className="cpSection">
      <button type="button" className="cpToggle" onClick={() => toggle('profile')}>{open.profile ? '▾' : '▸'} Customer profile</button>
      {open.profile ? <div className="cpBody">
        <label>Name<input value={p.full_name} onChange={(e) => props.onChange({ ...p, full_name: e.target.value })} /></label>
        <label>Country<input value={p.country} onChange={(e) => props.onChange({ ...p, country: e.target.value })} /></label>
        <label>Preferred language<input value={p.preferred_language} onChange={(e) => props.onChange({ ...p, preferred_language: e.target.value })} placeholder="e.g. English, Somali, French" /></label>
        <label>Notes for the AI and team<textarea rows={3} value={p.notes} onChange={(e) => props.onChange({ ...p, notes: e.target.value })} placeholder="e.g. Agent in Guangzhou is his cousin; wants to pay on arrival" /></label>
      </div> : null}
    </section>
    <section className="cpSection">
      <button type="button" className="cpToggle" onClick={() => toggle('memory')}>{open.memory ? '▾' : '▸'} What the AI remembers</button>
      {open.memory ? <div className="cpBody">
        <p className="muted" style={{ margin: '0 0 6px', fontSize: 12 }}>Filled in automatically from the customer&apos;s messages. Correct anything here - your values are marked as staff-confirmed and used on the AI&apos;s next reply.</p>
        {keys.map((k) => <label key={k} className="cpFact">
          <span>{FACT_LABELS[k] || k}{props.factSources[k] ? <em className={'cpSrc cpSrc-' + props.factSources[k]}>{props.factSources[k] === 'admin' || props.factSources[k] === 'staff' ? 'staff' : 'AI'}</em> : null}</span>
          <input value={props.facts[k] || ''} onChange={(e) => props.onFactsChange({ ...props.facts, [k]: e.target.value })} placeholder="unknown" />
        </label>)}
        {extra.length ? <select value="" onChange={(e) => { const k = e.target.value; if (k) props.onFactsChange({ ...props.facts, [k]: props.facts[k] || ' ' }); }}>
          <option value="">+ Add another detail...</option>
          {extra.map((k) => <option key={k} value={k}>{FACT_LABELS[k]}</option>)}
        </select> : null}
        {p.memory_summary ? <div className="memorySummary"><b>AI summary</b><p>{p.memory_summary}</p></div> : null}
      </div> : null}
    </section>
    <div className="cpSave">
      <button type="button" className="btn-success" onClick={props.onSave}>Save customer</button>
      <span className="muted">{props.saving}</span>
    </div>
    <section className="cpSection">
      <button type="button" className="cpToggle" onClick={() => toggle('more')}>{open.more ? '▾' : '▸'} Vehicle, ad and AI status</button>
      {open.more ? <div className="cpBody">{props.children}</div> : null}
    </section>
  </div>;
}
