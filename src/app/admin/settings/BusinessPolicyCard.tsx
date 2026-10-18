'use client';
import { useState } from 'react';

/*
  Sky Cars business policy editor (brief sections 3, 4, 11). Staff update shipping guidance and the
  third-party payment procedure here - the AI reads the saved version at reply time. Every save bumps the
  version and is written to the audit log. No credentials, no payment processor, no bank details.
*/
export default function BusinessPolicyCard({ initial }: { initial: any }) {
  const [p, setP] = useState<any>(initial || {});
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const [history, setHistory] = useState<any[] | null>(null);
  const set = (group: string, key: string, value: any) => setP((cur: any) => ({ ...cur, [group]: { ...(cur[group] || {}), [key]: value } }));
  async function save() {
    setBusy(true); setMsg('Saving...');
    const r = await fetch('/api/admin/business-policy', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(p) });
    const j = await r.json().catch(() => ({}));
    setBusy(false);
    if (!r.ok) { setMsg(j.error || 'Could not save'); return; }
    setP(j.policy); setMsg(`Saved as version ${j.policy.version}. The AI will use it on the next reply.`);
  }
  /** Read-only version history (brief section 7): who changed what and when. No restore button. */
  async function loadHistory() {
    const r = await fetch('/api/admin/business-policy/history', { cache: 'no-store' });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) { setMsg(j.error || 'Could not load the history'); return; }
    setHistory(j.versions || []);
  }
  const s = p.shipping || {}, pay = p.payment || {}, st = p.style || {};
  return <section className="card" style={{ marginTop: 18 }}>
    <h2>Sky Cars business policy {p.version ? <small className="muted">· version {p.version}</small> : null}</h2>
    <p className="muted">Used by the AI on every reply. Changes are versioned and audited.</p>
    <div className="formGrid">
      <label>Car shipping min (USD)<input type="number" value={s.car_min ?? ''} onChange={(e) => set('shipping', 'car_min', e.target.value)} /></label>
      <label>Car shipping max (USD)<input type="number" value={s.car_max ?? ''} onChange={(e) => set('shipping', 'car_max', e.target.value)} /></label>
      <label>Motorcycle shipping min (USD)<input type="number" value={s.motorcycle_min ?? ''} onChange={(e) => set('shipping', 'motorcycle_min', e.target.value)} /></label>
      <label>Motorcycle shipping max (USD)<input type="number" value={s.motorcycle_max ?? ''} onChange={(e) => set('shipping', 'motorcycle_max', e.target.value)} /></label>
    </div>
    <label>Regional guidance<textarea value={s.regional_note ?? ''} onChange={(e) => set('shipping', 'regional_note', e.target.value)} /></label>
    <label>Partner guidance<textarea value={s.partners_note ?? ''} onChange={(e) => set('shipping', 'partners_note', e.target.value)} /></label>
    <label style={{ display: 'flex', gap: 8, alignItems: 'center' }}><input type="checkbox" checked={!!s.ask_forwarder} onChange={(e) => set('shipping', 'ask_forwarder', e.target.checked)} /> Ask whether the customer already has a shipping company</label>
    <label>Approved payment procedure<textarea value={pay.policy ?? ''} onChange={(e) => set('payment', 'policy', e.target.value)} /></label>
    <label>Payment escalation note<textarea value={pay.escalate_note ?? ''} onChange={(e) => set('payment', 'escalate_note', e.target.value)} /></label>
    <div className="formGrid">
      <label>Max sentences per reply<input type="number" min={1} max={6} value={st.max_sentences ?? 3} onChange={(e) => set('style', 'max_sentences', e.target.value)} /></label>
      <label style={{ display: 'flex', gap: 8, alignItems: 'center' }}><input type="checkbox" checked={!!st.team_voice} onChange={(e) => set('style', 'team_voice', e.target.checked)} /> Team voice ("we / our / us")</label>
      <label style={{ display: 'flex', gap: 8, alignItems: 'center' }}><input type="checkbox" checked={!!st.price_first} onChange={(e) => set('style', 'price_first', e.target.checked)} /> Give a known price immediately</label>
      <label style={{ display: 'flex', gap: 8, alignItems: 'center' }}><input type="checkbox" checked={!!st.one_question} onChange={(e) => set('style', 'one_question', e.target.checked)} /> One follow-up question max</label>
    </div>
    <div className="actions" style={{ marginTop: 10 }}>
      <button type="button" className="btn" disabled={busy} onClick={() => void save()}>{busy ? 'Saving...' : 'Save policy'}</button>
      <button type="button" className="miniBtn" onClick={() => void loadHistory()}>Version history</button>
      {msg ? <span className="muted">{msg}</span> : null}
    </div>
    {history ? <div style={{ marginTop: 10 }}>
      <b style={{ fontSize: 12 }}>Version history (read-only)</b>
      {history.length ? history.map((h) => <div className="chFact" key={h.version + '-' + h.at}>
        <span>v{h.version ?? '?'} · {h.at ? new Date(String(h.at).replace(' ', 'T')).toLocaleString() : '-'} · {h.by || 'admin'}</span>
        <small className="muted">{h.changed?.length ? h.changed.join(', ') : 'no field changes recorded'}</small>
      </div>) : <p className="muted">No saved versions yet.</p>}
      <button type="button" className="miniBtn" onClick={() => setHistory(null)}>Close</button>
    </div> : null}
    <p className="hint">Shipping figures are indicative estimates, never a quotation. The AI must confirm the destination and port before a final price. No bank details or payment guarantees are ever sent.</p>
  </section>;
}
