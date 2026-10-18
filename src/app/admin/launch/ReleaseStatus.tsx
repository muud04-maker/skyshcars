'use client';
import { useEffect, useState } from 'react';

/*
  Release diagnostics (brief section 12). Presence of a key is never reported as "working": each row is a
  real probe from /api/admin/release-status (schema query, stored webhook event, queue row, bridge
  heartbeat). Optional features are labelled separately from launch blockers.
*/
const when = (v: any) => (v ? new Date(String(v).replace(' ', 'T')).toLocaleString() : 'never seen');

export default function ReleaseStatus() {
  const [d, setD] = useState<any>(null);
  const [err, setErr] = useState('');
  async function load() {
    setErr('');
    const r = await fetch('/api/admin/release-status', { cache: 'no-store' });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) { setErr(j.error || 'Could not read the release status'); return; }
    setD(j);
  }
  useEffect(() => { void load(); }, []);
  const row = (label: string, ok: boolean | null, detail: string, optional = false) => <div className="chFact" key={label}>
    <span><b style={{ color: ok === false ? '#a52626' : ok ? '#08733d' : '#5c7184' }}>{ok === false ? 'ACTION' : ok ? 'OK' : 'INFO'}</b> · {label}{optional ? ' (optional)' : ''}</span>
    <small className="muted">{detail}</small>
  </div>;
  return <div className="card" style={{ marginBottom: 18 }}>
    <div className="cardTop"><h2 style={{ margin: 0 }}>Release diagnostics</h2><button type="button" className="miniBtn" onClick={() => void load()}>Recheck</button></div>
    <p className="muted">Live probes only. Secrets are never displayed, and a configured key is not claimed to work until its own check passes.</p>
    {err ? <p className="error">{err}</p> : null}
    {!d ? <p className="muted">Checking...</p> : <>
      {row('Deployed commit', d.deployed_commit ? true : null, d.deployed_commit || 'Set DEPLOYED_COMMIT in Hostinger to display the exact deployed hash.')}
      {row('Database schema', d.schema?.ok, d.schema?.ok ? 'All critical tables and columns present.' : `Broken: ${(d.schema?.failed || []).map((f: any) => f.table).join(', ') || 'unknown'}`)}
      {row('Last WhatsApp webhook receipt', d.last_webhook_at ? true : false, when(d.last_webhook_at))}
      {row('Last AI activity', d.last_ai_activity_at ? true : null, `${when(d.last_ai_activity_at)} · ${d.ai_queue_pending} reply(ies) queued`)}
      {row('WhatsApp signature', d.signature?.enforced, `${d.signature?.mode}${d.signature?.secret_present ? '' : ' - add WHATSAPP_APP_SECRET and set REQUIRE_WHATSAPP_SIGNATURE=true'}`)}
      {row('Staff tasks', true, `${d.tasks?.pending} pending · ${d.tasks?.in_progress} in progress`)}
      {row('Media AI (image/voice understanding)', d.media_ai?.configured, d.media_ai?.note, true)}
      {row('Group reader bridge', d.group_reader?.online, `${d.group_reader?.online ? 'online' : 'offline'} · last heartbeat ${when(d.group_reader?.bridge_seen)} · ${d.group_reader?.pending_drafts} pending draft(s)`, true)}
    </>}
  </div>;
}
