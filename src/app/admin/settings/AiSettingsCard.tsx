'use client';
import { useEffect, useState } from 'react';

/** Welcome message (website + WhatsApp group, sent once per customer) and the staff pause length. */
export default function AiSettingsCard() {
  const [s, setS] = useState<any>(null), [msg, setMsg] = useState('');
  useEffect(() => { fetch('/api/admin/ai-settings', { cache: 'no-store' }).then(r => r.json()).then(setS).catch(() => setS({ error: true })); }, []);
  if (!s) return <div className="card"><p>Loading…</p></div>;
  if (s.error) return null;
  const w = s.welcome;
  async function save() {
    setMsg('Saving…');
    const r = await fetch('/api/admin/ai-settings', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ welcome: w, staff_pause_minutes: s.staff_pause_minutes }) });
    const j = await r.json().catch(() => ({}));
    setMsg(r.ok ? 'Saved.' : j.error || 'Could not save.');
  }
  const set = (k: string, v: any) => setS({ ...s, welcome: { ...w, [k]: v } });
  return <div className="card">
    <h2>WhatsApp welcome &amp; staff pause</h2>
    <p className="muted">The first reply a new customer ever gets ends with our website and an invitation to the WhatsApp group. It is sent once per customer, never again.</p>
    <label style={{ display: 'flex', gap: 8, alignItems: 'center' }}><input type="checkbox" style={{ width: 'auto' }} checked={!!w.enabled} onChange={e => set('enabled', e.target.checked)} /> Send the welcome to new customers</label>
    <label>WhatsApp group name<input value={w.group_name} onChange={e => set('group_name', e.target.value)} /></label>
    <label>WhatsApp group invite link<input value={w.group_link} onChange={e => set('group_link', e.target.value)} /></label>
    <p className="muted">Website shown: {w.site}</p>
    <label>Pause the AI after a staff message (minutes)<input type="number" min={1} max={1440} value={s.staff_pause_minutes} onChange={e => setS({ ...s, staff_pause_minutes: e.target.value })} /></label>
    <button className="btn" onClick={save}>Save</button> {msg && <b>{msg}</b>}
  </div>;
}
