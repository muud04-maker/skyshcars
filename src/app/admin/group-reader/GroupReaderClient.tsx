'use client';
import { useEffect, useState } from 'react';

function ageMinutes(v: any) {
  if (!v) return null;
  const n = Date.now() - new Date(v).getTime();
  return Number.isFinite(n) ? Math.max(0, Math.floor(n / 60000)) : null;
}
function date(v: any) {
  return v ? new Date(String(v).replace(' ', 'T')).toLocaleString() : 'Never';
}

export default function GroupReaderClient() {
  const [d, setD] = useState<any>({ groups: [], bridges: [], runs: [], stats: {}, health: {} });
  const [name, setName] = useState('');
  const [msg, setMsg] = useState('');
  const [requesting, setRequesting] = useState(false);

  async function load() {
    const r = await fetch('/api/admin/group-reader', { cache: 'no-store' });
    const j = await r.json().catch(() => ({}));
    if (r.ok) setD(j);
    else setMsg(j.error || 'Could not load Group Reader status');
  }
  useEffect(() => {
    void load();
    const timer = setInterval(load, 10000);
    return () => clearInterval(timer);
  }, []);

  async function add() {
    if (!name.trim()) return;
    const r = await fetch('/api/admin/group-reader', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ group_name: name, enabled: true }),
    });
    const j = await r.json().catch(() => ({}));
    setMsg(r.ok ? 'Group added.' : j.error || 'Could not add group');
    setName('');
    void load();
  }
  async function toggle(group: any) {
    await fetch('/api/admin/group-reader', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...group, enabled: !group.enabled }),
    });
    void load();
  }

  const bridge = (d.bridges || [])[0];
  async function syncNow() {
    setRequesting(true);
    const r = await fetch('/api/admin/group-reader', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'request_sync', bridge_id: bridge?.bridge_id || 'primary' }),
    });
    const j = await r.json().catch(() => ({}));
    setRequesting(false);
    setMsg(r.ok ? 'Manual synchronization requested. The bridge will claim it on its next poll.' : j.error || 'Could not request sync');
    void load();
  }
  async function backfill() {
    setMsg('Backfilling identity references and image fingerprints…');
    const r = await fetch('/api/admin/imports/group', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'backfill', limit: 120 }),
    });
    const j = await r.json().catch(() => ({}));
    setMsg(r.ok ? `Backfill checked ${j.processed} media entries and added ${j.fingerprints_added} fingerprints.` : j.error || 'Backfill failed');
    void load();
  }

  const health = d.health || {};
  const stats = d.stats || {};
  const mins = ageMinutes(bridge?.last_heartbeat_at);
  const online = !!bridge && mins !== null && mins < 3 && bridge.status === 'online';
  let bridgeDetail: any = {};
  try { bridgeDetail = typeof bridge?.details === 'string' ? JSON.parse(bridge.details) : (bridge?.details || {}); } catch {}
  const bridgeLabel = online ? 'ONLINE'
    : !bridge ? 'NEVER CONNECTED'
    : bridge.status === 'qr_required' ? 'WAITING FOR QR SCAN'
    : bridge.status === 'starting' ? 'STARTING'
    : mins !== null && mins >= 3 ? `OFFLINE (last heartbeat ${mins} min ago)`
    : String(bridge.status || 'UNKNOWN').replaceAll('_', ' ').toUpperCase();

  return <>
    <section className="stats">
      <div className="stat"><b>{stats.newVehicles || 0}</b><span>New vehicles</span></div>
      <div className="stat"><b>{stats.existingVehicles || 0}</b><span>Existing vehicles detected</span></div>
      <div className="stat"><b>{stats.possibleDuplicates || 0}</b><span>Possible duplicates</span></div>
      <div className="stat"><b>{stats.pendingApproval || 0}</b><span>Pending approval</span></div>
      <div className="stat"><b>{stats.publishedVehicles || 0}</b><span>Published records</span></div>
      <div className="stat"><b>{stats.failedPublications || 0}</b><span>Failed publications</span></div>
    </section>

    <div className="settingsGrid">
      <div className="card">
        <h2>Group Reader health</h2>
        <b className={online ? 'ok' : 'bad'}>{bridgeLabel}</b>
        {bridgeDetail.lastError && <p className="muted">Last bridge error: {bridgeDetail.lastError}</p>}
        {bridge ? <>
          <p>WhatsApp account: {bridge.whatsapp_account || 'not reported'}</p>
          <p>Visible groups: {bridge.visible_groups ?? '?'} · Bridge version: {bridge.app_version || '?'}</p>
          <p>Last heartbeat: {date(bridge.last_heartbeat_at)}</p>
        </> : <p>No heartbeat has reached the website.</p>}
        <p><b>Last successful synchronization:</b> {date(health.lastSuccessfulSync)}</p>
        <p><b>Next scheduled synchronization:</b> {date(health.nextScheduledSync)}</p>
        <p className="muted">{health.schedule}</p>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button className="btn" onClick={syncNow} disabled={requesting}>{requesting ? 'Requesting…' : 'Synchronize now'}</button>
          <button className="miniBtn" onClick={backfill}>Backfill identity memory</button>
          <button className="miniBtn" onClick={load}>Refresh</button>
        </div>
        {msg && <p>{msg}</p>}
      </div>

      <div className="card">
        <h2>Authorized supplier groups</h2>
        <p className="muted">A discovered group ID is pinned. Display-name lookalikes are rejected; every listing still enters Inventory Review.</p>
        <div style={{ display: 'flex', gap: 8 }}>
          <input style={{ flex: 1 }} placeholder="Exact WhatsApp group name" value={name} onChange={(e) => setName(e.target.value)} />
          <button className="btn" onClick={add}>Add group</button>
        </div>
        <div style={{ display: 'grid', gap: 8, marginTop: 12 }}>
          {(d.groups || []).map((group: any) => <div key={group.id} style={{ display: 'flex', justifyContent: 'space-between', gap: 12, border: '1px solid #dce5ec', padding: 10, borderRadius: 8 }}>
            <div>
              <b>{group.group_name}</b>
              <div className="muted">{group.enabled ? 'Enabled' : 'Disabled'} · Last seen: {date(group.last_seen_at)}</div>
              <small>{group.group_external_id || 'Group ID not pinned yet'}</small>
            </div>
            <button className="miniBtn" onClick={() => toggle(group)}>{group.enabled ? 'Disable' : 'Enable'}</button>
          </div>)}
        </div>
      </div>
    </div>

    <div className="card" style={{ marginTop: 18 }}>
      <h2>Pending change approvals</h2>
      <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap' }}>
        <span><b>{stats.priceUpdates || 0}</b> price updates</span>
        <span><b>{stats.additionalPhotos || 0}</b> additional photos</span>
        <span><b>{stats.availabilityUpdates || 0}</b> sold/hidden reappearances</span>
        <a href="/admin/imports">Open Inventory Review</a>
      </div>
    </div>

    <div className="card" style={{ marginTop: 18 }}>
      <h2>Recent synchronization runs</h2>
      <div className="tableWrap" style={{ boxShadow: 'none', border: 0 }}>
        <table className="table">
          <thead><tr><th>Started</th><th>State</th><th>Messages</th><th>Media</th><th>Website saved</th><th>Error</th></tr></thead>
          <tbody>
            {(d.runs || []).length ? (d.runs || []).map((run: any) => <tr key={run.run_id}>
              <td>{date(run.started_at)}</td><td>{run.state}</td><td>{run.messages_received}</td><td>{run.media_received}</td>
              <td>{Number(run.website_saved) ? 'yes' : 'no'}</td><td style={{ maxWidth: 420 }}>{run.error || '—'}</td>
            </tr>) : <tr><td colSpan={6}>No synchronization run has been recorded yet.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>

    <div className="card" style={{ marginTop: 18 }}>
      <h2>Runner installation</h2>
      <p>The reader runs outside the Hostinger Node.js website because WhatsApp Web requires a persistent Chromium session.</p>
      <p>Use <code>tools/whatsapp-group-bridge/vps/install-ubuntu.sh</code>, then enable either the persistent service or the provided hourly 10-minute timer. Never run two readers on the same WhatsApp account.</p>
    </div>
  </>;
}
