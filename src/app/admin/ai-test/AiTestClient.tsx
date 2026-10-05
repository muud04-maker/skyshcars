'use client';
import { useState } from 'react';

const box: any = { background: '#f6f9fc', border: '1px solid #dce5ec', borderRadius: 10, padding: 12, marginTop: 10, whiteSpace: 'pre-wrap', fontSize: 13 };

export default function AiTestClient() {
  const [f, setF] = useState<any>({ message: '', channel: 'whatsapp', external_id: '255700000000', first_contact: false, last_outbound: '', referral_source_id: '', referral_headline: '', message_type: 'text' });
  const [out, setOut] = useState<any>(null), [busy, setBusy] = useState(false), [err, setErr] = useState('');
  const set = (k: string, v: any) => setF((x: any) => ({ ...x, [k]: v }));
  async function run(e: any) {
    e.preventDefault();
    setBusy(true); setErr(''); setOut(null);
    const r = await fetch('/api/admin/ai-test', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(f) });
    const j = await r.json().catch(() => ({}));
    setBusy(false);
    if (!r.ok) { setErr(j.error || 'Dry run failed'); return; }
    setOut(j);
  }
  return <>
    <form className="card" onSubmit={run}>
      <div className="quoteFormGrid">
        <label className="wide">Customer message<input required value={f.message} onChange={(e) => set('message', e.target.value)} placeholder="e.g. Hello! Can I get more info on this?" /></label>
        <label>Channel<select value={f.channel} onChange={(e) => set('channel', e.target.value)}><option value="whatsapp">WhatsApp</option><option value="facebook">Messenger</option></select></label>
        <label>Message type<select value={f.message_type} onChange={(e) => set('message_type', e.target.value)}>{['text', 'image', 'audio', 'video', 'document'].map((t) => <option key={t}>{t}</option>)}</select></label>
        <label>Customer id<input value={f.external_id} onChange={(e) => set('external_id', e.target.value)} /></label>
        <label>Our last question <span className="muted">(optional)</span><input value={f.last_outbound} onChange={(e) => set('last_outbound', e.target.value)} placeholder="e.g. Which country should we ship to?" /></label>
        <label>Facebook post id <span className="muted">(optional)</span><input value={f.referral_source_id} onChange={(e) => set('referral_source_id', e.target.value)} /></label>
        <label>Facebook headline <span className="muted">(optional)</span><input value={f.referral_headline} onChange={(e) => set('referral_headline', e.target.value)} placeholder="2019 Toyota Harrier hybrid..." /></label>
        <label style={{ display: 'flex', gap: 8, alignItems: 'center' }}><input type="checkbox" style={{ width: 'auto' }} checked={f.first_contact} onChange={(e) => set('first_contact', e.target.checked)} />First message ever</label>
      </div>
      <button className="btn" disabled={busy}>{busy ? 'Running dry run...' : 'Run dry run'}</button>
      {err && <p className="error">{err}</p>}
    </form>
    {out && <div className="card" style={{ marginTop: 14 }}>
      <h2>Result <span className="muted" style={{ fontWeight: 400 }}>- nothing was sent</span></h2>
      <div style={box}><b>Intent</b>{'\n'}{out.intent.reply ? `reply (${out.intent.reason})` : `no reply (${out.intent.reason})`}</div>
      <div style={box}><b>AI catalog</b>{'\n'}{out.catalog.aiCount} of {out.catalog.availableCount} Available cars enabled (mode: {out.catalog.mode})</div>
      <div style={box}><b>Matched car</b>{'\n'}{out.matched ? `${out.matched.stock_no} ${out.matched.model_year || ''} ${out.matched.brand || ''} ${out.matched.model || ''}` : 'none'}{out.candidates?.length ? `\ncandidates: ${out.candidates.map((v: any) => v.stock_no).join(', ')}` : ''}</div>
      <div style={box}><b>Current car</b>{'\n'}{out.current_car ? `${out.current_car.stock_no} ${out.current_car.brand || ''} ${out.current_car.model || ''}` : 'none'}</div>
      <div style={box}><b>Slots</b>{'\n'}{Object.keys(out.slots || {}).length ? JSON.stringify(out.slots) : 'none detected'}</div>
      <div style={box}><b>Referral</b>{'\n'}{out.referral ? `matched: ${out.referral.matched} (${out.referral.method})` : 'no referral given'}</div>
      <div style={box}><b>Welcome</b>{'\n'}{out.welcome.due ? 'would be added to this reply (first contact)' : out.welcome.already_sent ? 'already sent earlier' : 'disabled in settings'}</div>
      <div style={box}><b>Photo action</b>{'\n'}{out.photo_action}</div>
      <div style={box}><b>Cars this reply may mention</b>{'\n'}{out.allowed_names?.length ? out.allowed_names.join(', ') : 'none'}</div>
      {out.needs_staff && <div style={box}><b>Needs staff</b>{'\n'}{out.needs_staff}</div>}
      <div style={box}><b>Final planned reply</b>{'\n'}{out.reply || '(empty)'}</div>
    </div>}
  </>;
}
