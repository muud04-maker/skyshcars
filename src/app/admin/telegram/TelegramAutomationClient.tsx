'use client';
import { useEffect, useState } from 'react';

function dt(value: any) {
  return value ? new Date(String(value).replace(' ', 'T')).toLocaleString() : 'Never';
}
function parse(value: any) {
  if (!value) return {};
  if (typeof value === 'object') return value;
  try { return JSON.parse(value); } catch { return {}; }
}

export default function TelegramAutomationClient() {
  const [data, setData] = useState<any>({ settings: {}, counts: {}, photos: {}, source_messages: [], imports: [], events: [], facebook: [], sample_vehicles: [] });
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState('');
  const [sample, setSample] = useState('');
  const [test, setTest] = useState<any>(null);

  async function load() {
    const response = await fetch('/api/admin/telegram', { cache: 'no-store' });
    const json = await response.json().catch(() => ({}));
    if (response.ok) setData(json);
    else setMessage(json.error || 'Could not load Telegram Automation');
  }
  useEffect(() => { void load(); }, []);

  async function post(action: string, extra: any = {}) {
    setBusy(action);
    const response = await fetch('/api/admin/telegram', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, ...extra }),
    });
    const json = await response.json().catch(() => ({}));
    setBusy('');
    await load();
    return { ok: response.ok, json };
  }
  async function save() {
    setBusy('save');
    const response = await fetch('/api/admin/telegram', {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data.settings),
    });
    const json = await response.json().catch(() => ({}));
    setBusy('');
    setMessage(response.ok ? 'Telegram automation settings saved.' : json.error || 'Save failed');
    await load();
  }
  async function probe() {
    const result = await post('probe');
    setMessage(result.ok ? (result.json.connection?.ok ? 'Telegram connection verified.' : result.json.connection?.error || 'Telegram needs attention.') : result.json.error || 'Connection check failed');
  }
  async function register() {
    const result = await post('register_webhook');
    setMessage(result.ok ? 'Telegram webhook registered and checked.' : result.json.error || 'Webhook registration failed');
  }
  async function retry() {
    const result = await post('retry');
    setMessage(result.ok ? `Retry completed. ${result.json.processed?.length || 0} job group(s) processed.` : result.json.error || 'Retry failed');
  }
  async function processQueue() {
    const result = await post('process_queue');
    setMessage(result.ok ? `${result.json.processed?.length || 0} durable Telegram job group(s) processed.` : result.json.error || 'Queue processing failed');
  }
  async function repairImports() {
    if (!confirm('Reconcile approved Telegram imports with their stored original photos and verified fields? Hidden vehicles stay Hidden.')) return;
    const result = await post('repair_imports');
    setMessage(result.ok ? `Import repair completed for ${result.json.repaired?.length || 0} approved listing(s).` : result.json.error || 'Import repair failed');
  }
  async function repairSourceAssociations() {
    if (!confirm('Repair the known mixed Telegram source albums? This keeps every source record, reuses pending vehicles, and never publishes.')) return;
    const result = await post('repair_source_associations');
    setMessage(result.ok
      ? `Source repair completed for ${result.json.repaired?.length || 0} pending vehicle(s). Nothing was published.`
      : result.json.error || 'Source repair failed');
  }
  async function runDiagnostic() {
    const result = await post('v37_diagnostic');
    setTest(result.json);
    setMessage(result.ok ? 'V37 diagnostic completed. It did not publish a vehicle.' : result.json.error || 'V37 diagnostic failed');
  }
  async function runV38Diagnostic() {
    const result = await post('v38_diagnostic');
    setTest(result.json);
    setMessage(result.ok ? 'V38 source diagnostic completed. No supplier text or vehicle was published.' : result.json.error || 'V38 diagnostic failed');
  }
  async function runSample() {
    if (!sample) { setMessage('Choose an available sample vehicle.'); return; }
    const result = await post('test_sample', { vehicle_id: Number(sample) });
    setTest(result.json);
    setMessage(result.ok ? 'Sample preflight passed. Nothing was published.' : 'Sample preflight found one or more gaps. Nothing was published.');
  }

  const settings = data.settings || {};
  const config = data.config || {};
  const connection = data.connection || {};
  const details = connection.details || {};
  const counts = data.counts || {};
  const photos = data.photos || {};
  const whatsapp = data.whatsapp_group?.status || {};
  const toggle = (key: string) => <label className="automationToggle">
    <input type="checkbox" checked={!!settings[key]} disabled={key === 'auto_whatsapp_group'} onChange={(event) => setData({ ...data, settings: { ...settings, [key]: event.target.checked } })} />
    <span>{key.replaceAll('_', ' ')}</span>
  </label>;

  return <>
    <section className="stats">
      <div className="stat"><b>{counts.updates || 0}</b><span>Updates received</span></div>
      <div className="stat"><b>{counts.imported || 0}</b><span>Vehicles processed</span></div>
      <div className="stat"><b>{counts.confirmed_duplicates || 0}</b><span>Existing vehicles detected</span></div>
      <div className="stat"><b>{counts.possible_duplicates || 0}</b><span>Possible duplicates</span></div>
      <div className="stat"><b>{counts.pending || 0}</b><span>Pending review</span></div>
      <div className="stat"><b>{counts.failed_jobs || 0}</b><span>Failed jobs</span></div>
    </section>
    {message && <div className="status"><b>{message}</b></div>}

    <div className="settingsGrid">
      <div className="card">
        <div className="sectionHead"><div><h2>Automatic publishing</h2><p>Complete, verified Telegram listings with duplicate risk below 80%, a source price in USD and original photos are eligible for automatic publishing. Risk at 80% or above stays in review.</p></div><span className={'badge ' + (settings.auto_publish ? '' : 'pending')}>{settings.auto_publish ? 'On' : 'Off'}</span></div>
        <div className="automationGrid">
          {toggle('enabled')}{toggle('auto_publish')}{toggle('auto_approve_new')}{toggle('auto_facebook')}{toggle('auto_whatsapp_group')}
        </div>
        <label style={{ display: 'block', marginTop: 14 }}>Minimum extraction confidence
          <input type="number" min="0.5" max="1" step="0.05" value={settings.min_extraction_confidence ?? 0.65} onChange={(event) => setData({ ...data, settings: { ...settings, min_extraction_confidence: Number(event.target.value) } })} />
        </label>
        <div className="formGrid" style={{ marginTop: 12 }}>
          <label>Fixed selling markup (USD)<input type="number" min="0" step="1" value={settings.markup_usd ?? ''} placeholder="Not configured" onChange={(event) => setData({ ...data, settings: { ...settings, markup_usd: event.target.value === '' ? null : Number(event.target.value) } })} /></label>
          <label>Selling markup (%)<input type="number" min="0" step="0.1" value={settings.markup_percent ?? ''} placeholder="Optional fallback" onChange={(event) => setData({ ...data, settings: { ...settings, markup_percent: event.target.value === '' ? null : Number(event.target.value) } })} /></label>
        </div>
        <p className="muted">Supplier cost is never treated as the final selling price without one of these explicit policies. If neither is configured, complete imports remain in review.</p>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 14 }}>
          <button className="btn" disabled={busy === 'save'} onClick={save}>Save settings</button>
          <button className="miniBtn" disabled={busy === 'retry'} onClick={retry}>Retry failed jobs</button>
          <button className="miniBtn" disabled={busy === 'process_queue'} onClick={processQueue}>Process durable queue</button>
          <button className="miniBtn" disabled={busy === 'repair_imports'} onClick={repairImports}>Repair approved imports</button>
          <button className="miniBtn" disabled={busy === 'repair_source_associations'} onClick={repairSourceAssociations}>Repair mixed Telegram sources</button>
          <button className="miniBtn" disabled={busy === 'v37_diagnostic'} onClick={runDiagnostic}>Run V37 diagnostic</button>
          <button className="miniBtn" disabled={busy === 'v38_diagnostic'} onClick={runV38Diagnostic}>Run V38 diagnostic</button>
        </div>
      </div>

      <div className="card">
        <h2>Telegram connection</h2>
        <div className="settingRow"><span>Environment</span><b className={config.configured ? 'ok' : 'bad'}>{config.configured ? 'Configured' : 'Configuration required'}</b></div>
        <div className="settingRow"><span>TELEGRAM_BOT_TOKEN</span><b className={config.bot_token_present ? 'ok' : 'bad'}>{config.bot_token_present ? 'Present' : 'Missing'}</b></div>
        <div className="settingRow"><span>TELEGRAM_WEBHOOK_SECRET</span><b className={config.webhook_secret_present ? 'ok' : 'bad'}>{config.webhook_secret_present ? 'Present' : 'Missing'}</b></div>
        <div className="settingRow"><span>TELEGRAM_SOURCE_CHAT_ID</span><b className={config.source_chat_id_present ? 'ok' : 'bad'}>{config.source_chat_id_present ? 'Present' : 'Missing'}</b></div>
        <div className="settingRow"><span>Connection state</span><b className={connection.state === 'connected' ? 'ok' : 'bad'}>{String(connection.state || 'not checked').replaceAll('_', ' ')}</b></div>
        <p><b>Last heartbeat:</b> {dt(connection.checked_at)}</p>
        {details.group && <p><b>Group:</b> {details.group.title} · <code>{details.group.id}</code></p>}
        {details.bot && <p><b>Bot:</b> @{details.bot.username || 'unknown'} · Administrator: {details.bot_is_admin ? 'yes' : 'not verified'}</p>}
        {details.webhook && <p><b>Webhook:</b> {details.webhook.matches ? 'registered URL matches' : 'not registered or URL differs'} · Pending updates: {details.webhook.pending_update_count ?? '—'}</p>}
        {connection.last_error && <p className="bad">{connection.last_error}</p>}
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button className="btn" disabled={busy === 'probe'} onClick={probe}>Verify connection</button>
          <button className="miniBtn" disabled={busy === 'register_webhook'} onClick={register}>Register webhook</button>
        </div>
      </div>
    </div>

    <div className="settingsGrid" style={{ marginTop: 18 }}>
      <div className="card">
        <h2>Website and Facebook</h2>
        <div className="settingRow"><span>Last Telegram message</span><b>{dt(data.last_received)}</b></div>
        <div className="settingRow"><span>Photos processed</span><b>{photos.processed || 0} / {photos.total || 0}</b></div>
        <div className="settingRow"><span>Approved to Sell Now</span><b>{counts.approved || 0}</b></div>
        <div className="settingRow"><span>Facebook publication records</span><b>{(data.facebook || []).length}</b></div>
        <p className="muted">Facebook posts are de-duplicated by vehicle and channel. Uncertain API responses remain blocked until reconciled.</p>
      </div>
      <div className="card">
        <h2>WhatsApp group delivery</h2>
        <div className="settingRow"><span>Target group</span><code>{whatsapp.target_group_id || '120363429404519527@g.us'}</code></div>
        <div className="settingRow"><span>Status</span><b className="bad">{String(whatsapp.state || 'disabled').toUpperCase()}</b></div>
        <p>{whatsapp.reason}</p>
        {whatsapp.missing_requirement && <p className="muted"><b>Missing requirement:</b> {whatsapp.missing_requirement}</p>}
      </div>
    </div>

    <div className="card" style={{ marginTop: 18 }}>
      <div className="sectionHead"><div><h2>Authorized sample-vehicle preflight</h2><p>Checks Telegram, source group, bot administration, webhook, USD price and original photo. It never publishes.</p></div></div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <select value={sample} onChange={(event) => setSample(event.target.value)}>
          <option value="">Choose available vehicle</option>
          {(data.sample_vehicles || []).map((vehicle: any) => <option key={vehicle.id} value={vehicle.id}>{vehicle.stock_no} — {vehicle.model_year || ''} {vehicle.brand || ''} {vehicle.model || ''} — ${Number(vehicle.price_usd || 0).toLocaleString()}</option>)}
        </select>
        <button className="btn" disabled={busy === 'test_sample'} onClick={runSample}>Run preflight</button>
      </div>
      {test && <pre style={{ whiteSpace: 'pre-wrap', maxHeight: 300, overflow: 'auto' }}>{JSON.stringify(test, null, 2)}</pre>}
    </div>

    <div className="card" style={{ marginTop: 18 }}>
      <h2>Recent Telegram source messages</h2>
      <div className="tableWrap" style={{ boxShadow: 'none', border: 0 }}><table className="table">
        <thead><tr><th>Received</th><th>Message</th><th>Reply to</th><th>Kind</th><th>Album</th><th>State</th><th>Import</th><th>Vehicle</th><th>Error</th></tr></thead>
        <tbody>{(data.source_messages || []).length ? data.source_messages.map((row: any) => <tr key={row.id}>
          <td>{dt(row.received_at)}</td><td>{row.message_id}{row.edit_date ? ' (edited)' : ''}</td><td>{row.reply_to_message_id || '—'}</td><td>{row.message_kind}</td>
          <td>{row.media_group_id ? 'yes' : '—'}</td><td>{row.processing_state}{row.retry_count ? ` · retries ${row.retry_count}` : ''}</td>
          <td>{row.import_item_id || '—'}</td><td>{row.vehicle_id || '—'}</td><td style={{ maxWidth: 340 }}>{row.error || '—'}</td>
        </tr>) : <tr><td colSpan={9}>No Telegram messages received yet.</td></tr>}</tbody>
      </table></div>
    </div>

    <div className="card" style={{ marginTop: 18 }}>
      <h2>Recent imported vehicles</h2>
      <div className="tableWrap" style={{ boxShadow: 'none', border: 0 }}><table className="table">
        <thead><tr><th>Import</th><th>Vehicle</th><th>Class</th><th>Association</th><th>Risk</th><th>Review</th><th>Approval</th><th>Photos</th><th>Extraction</th></tr></thead>
        <tbody>{(data.imports || []).length ? data.imports.map((row: any) => <tr key={row.id}>
          <td>{row.id}</td><td>{row.stock_no || row.vehicle_id || '—'} {row.brand || ''} {row.model || ''} {row.model_year || ''}</td>
          <td>{row.match_status}</td><td>{row.association_status || 'unknown'}</td><td>{row.duplicate_risk == null ? '—' : `${Math.round(Number(row.duplicate_risk) * 100)}%`}</td>
          <td>{row.review_status}</td><td>{row.approval_method || '—'}</td><td>{row.media_count}</td>
          <td>{row.extraction_confidence == null ? '—' : `${Math.round(Number(row.extraction_confidence) * 100)}%`}</td>
        </tr>) : <tr><td colSpan={9}>No Telegram imports yet.</td></tr>}</tbody>
      </table></div>
    </div>

    <div className="card" style={{ marginTop: 18 }}>
      <h2>Facebook publication history</h2>
      <div className="tableWrap" style={{ boxShadow: 'none', border: 0 }}><table className="table">
        <thead><tr><th>Time</th><th>Vehicle</th><th>Status</th><th>Facebook ID</th><th>Details</th></tr></thead>
        <tbody>{(data.facebook || []).length ? data.facebook.map((row: any) => <tr key={row.id}>
          <td>{dt(row.created_at)}</td><td>{row.stock_no} {row.brand || ''} {row.model || ''}</td><td>{row.status}</td>
          <td>{row.external_id || '—'}</td><td style={{ maxWidth: 420, whiteSpace: 'pre-wrap' }}>{String(row.details || '').slice(0, 400)}</td>
        </tr>) : <tr><td colSpan={5}>No Telegram vehicle Facebook posts yet.</td></tr>}</tbody>
      </table></div>
    </div>
  </>;
}
