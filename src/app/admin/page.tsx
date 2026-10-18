import { redirect } from 'next/navigation';
import { isAdmin } from '../../lib/admin';
import { one, ping, dbConfigured } from '../../lib/db';
import { whatsappConfigured, whatsappConfigSummary } from '../../lib/meta';
import { facebookConfigured } from '../../lib/facebook';
import { customerAccountsEnabled } from '../../lib/auth-providers';
import { bridgeHealth, ensureGroupReaderSchema } from '../../lib/group-reader';
import { ensureAiCatalog, catalogCounts } from '../../lib/ai-catalog';
import { ensureConversationState } from '../../lib/conversation-state';
import { ensureAutomationSchema } from '../../lib/automation';
import AdminShell from './_components/AdminShell';
export const dynamic = 'force-dynamic';

type Tone = 'ok' | 'warn' | 'bad';
const dot: Record<Tone, string> = { ok: '#0b7a3b', warn: '#b7791f', bad: '#b3261e' };
const label: Record<Tone, string> = { ok: 'GREEN', warn: 'YELLOW', bad: 'RED' };

async function counts() {
  const zero = { leadsToday: 0, waiting: 0, quotesToday: 0, vehiclesToday: 0, pendingImports: 0, available: 0, aiEnabled: 0, reserved: 0, sold: 0, cars: 0, motorcycles: 0, aiChats: 0, humanChats: 0, pausedChats: 0, needsStaff: 0, waiting10: 0 };
  if (!dbConfigured()) return zero;
  try {
    await Promise.all([
      ensureConversationState().catch(() => {}),
      ensureGroupReaderSchema().catch(() => {}),
      ensureAutomationSchema().catch(() => {}),
      ensureAiCatalog().catch(() => {}),
    ]);
    const r: any = await one<any>(`SELECT
      (SELECT COUNT(*) FROM leads WHERE created_at >= CURDATE()) leadsToday,
      (SELECT COUNT(*) FROM conversations co WHERE COALESCE(co.archived_at, '1970-01-01') = '1970-01-01'
         AND (SELECT COALESCE(MAX(m1.id),0) FROM messages m1 WHERE m1.conversation_id=co.id AND m1.sender='customer' AND m1.direction='inbound')
           > (SELECT COALESCE(MAX(m2.id),0) FROM messages m2 WHERE m2.conversation_id=co.id AND m2.sender IN ('ai','human') AND m2.direction='outbound')) waiting,
      (SELECT COUNT(*) FROM quote_requests WHERE created_at >= CURDATE()) quotesToday,
      (SELECT COUNT(*) FROM vehicles WHERE created_at >= CURDATE()) vehiclesToday,
      (SELECT COUNT(*) FROM inventory_import_items WHERE review_status='pending') pendingImports,
      (SELECT COUNT(*) FROM vehicles WHERE status='available') available,
      (SELECT COUNT(*) FROM vehicles WHERE status='available' AND ai_enabled=1) aiEnabled,
      (SELECT COUNT(*) FROM vehicles WHERE status='reserved') reserved,
      (SELECT COUNT(*) FROM vehicles WHERE status='sold') sold,
      (SELECT COUNT(*) FROM vehicles WHERE category='car') cars,
      (SELECT COUNT(*) FROM vehicles WHERE category='motorcycle') motorcycles,
      (SELECT COUNT(*) FROM conversations WHERE mode='ai' AND COALESCE(archived_at,'1970-01-01')='1970-01-01') aiChats,
      (SELECT COUNT(*) FROM conversations WHERE mode='human' AND COALESCE(archived_at,'1970-01-01')='1970-01-01') humanChats,
      (SELECT COUNT(*) FROM conversations WHERE mode='paused' AND COALESCE(archived_at,'1970-01-01')='1970-01-01') pausedChats,
      (SELECT COUNT(*) FROM conversation_state WHERE needs_staff=1) needsStaff,
      (SELECT COUNT(*) FROM conversations co WHERE COALESCE(co.archived_at,'1970-01-01')='1970-01-01'
         AND (SELECT COALESCE(MAX(m1.id),0) FROM messages m1 WHERE m1.conversation_id=co.id AND m1.sender='customer' AND m1.direction='inbound')
           > (SELECT COALESCE(MAX(m2.id),0) FROM messages m2 WHERE m2.conversation_id=co.id AND m2.sender IN ('ai','human') AND m2.direction='outbound')
         AND (SELECT MAX(m3.created_at) FROM messages m3 WHERE m3.conversation_id=co.id AND m3.sender='customer' AND m3.direction='inbound') <= (NOW() - INTERVAL 10 MINUTE)) waiting10
    `);
    return { ...zero, ...Object.fromEntries(Object.entries(r || {}).map(([k, v]) => [k, Number(v || 0)])) };
  } catch { return zero; }
}

async function systems() {
  const out: { name: string; tone: Tone; detail: string }[] = [];
  let dbOk = false;
  try { if (dbConfigured()) { await ping(); dbOk = true; } } catch { dbOk = false; }
  out.push({ name: 'Database', tone: dbOk ? 'ok' : 'bad', detail: dbOk ? 'Connected' : 'Not connected' });
  out.push({ name: 'WhatsApp', tone: whatsappConfigured() ? 'ok' : 'warn', detail: whatsappConfigured() ? `Ready (${whatsappConfigSummary().signatureMode} signatures)` : 'Needs setup' });
  out.push({ name: 'DeepSeek AI', tone: process.env.DEEPSEEK_API_KEY ? 'ok' : 'warn', detail: process.env.DEEPSEEK_API_KEY ? 'Key present' : 'Needs setup' });
  out.push({ name: 'Facebook', tone: facebookConfigured() ? 'ok' : 'warn', detail: facebookConfigured() ? 'Page configured' : 'Needs setup' });
  let group: { name: string; tone: Tone; detail: string } = { name: 'Group Reader', tone: 'warn', detail: 'Needs setup' };
  if (dbOk) {
    try {
      const { rows } = await import('../../lib/db');
      const b: any = (await rows<any>('SELECT * FROM whatsapp_group_bridge_status ORDER BY last_heartbeat_at DESC LIMIT 1'))[0];
      const h = bridgeHealth(b);
      group = { name: 'Group Reader', tone: h.online ? 'ok' : h.state === 'never' ? 'warn' : 'bad', detail: h.online ? 'Online' : h.state === 'never' ? 'Never connected' : `Offline (${h.state})` };
    } catch { /* keep warn */ }
  }
  out.push(group);
  out.push({ name: 'Customer Auth', tone: customerAccountsEnabled() ? 'ok' : 'warn', detail: customerAccountsEnabled() ? 'On' : 'Off (needs AUTH_SECRET/database)' });
  return out;
}

function Tile({ label: l, value, href }: { label: string; value: number | string; href?: string }) {
  const inner = <><b>{value}</b><span>{l}</span></>;
  return href ? <a href={href} className="dashTile">{inner}</a> : <div className="dashTile">{inner}</div>;
}

export default async function Admin() {
  if (!(await isAdmin())) redirect('/admin/login');
  const [k, sys, cat] = await Promise.all([counts(), systems(), catalogCounts().catch(() => ({ aiCount: 0, availableCount: 0 }))]);
  return <AdminShell><main className="adminPage">
    <div className="adminTitle"><div><h1>Sky Cars Control Center</h1><p>Everything you need today: leads, chats, inventory, quotes and system status.</p></div>
      <div className={sys.every((s) => s.tone !== 'bad') ? 'livePill' : 'setupPill'}>{sys.every((s) => s.tone !== 'bad') ? 'ALL SYSTEMS OK' : 'CHECK SYSTEM STATUS'}</div></div>

    <section className="dashGrid">
      <div className="card"><h3>Today</h3>
        <div className="dashTiles">
          <Tile label="New leads" value={k.leadsToday} href="/admin/leads" />
          <Tile label="Waiting chats" value={k.waiting} href="/admin/whatsapp" />
          <Tile label="New quotes" value={k.quotesToday} href="/admin/quotes" />
          <Tile label="New vehicles" value={k.vehiclesToday} href="/admin/vehicles" />
          <Tile label="Group Reader drafts" value={k.pendingImports} href="/admin/imports" />
        </div>
      </div>
      <div className="card"><h3>Sales</h3>
        <div className="dashTiles">
          <Tile label="Available" value={k.available} href="/admin/vehicles" />
          <Tile label="AI-enabled" value={k.aiEnabled} href="/admin/ai-catalog" />
          <Tile label="Reserved" value={k.reserved} href="/admin/vehicles" />
          <Tile label="Sold" value={k.sold} href="/admin/vehicles" />
          <Tile label="Cars" value={k.cars} href="/admin/vehicles" />
          <Tile label="Motorcycles" value={k.motorcycles} href="/admin/vehicles" />
        </div>
        <p className="muted">The AI can sell {cat.aiCount} of {k.available} Available vehicles. <a href="/admin/ai-catalog">Open AI Catalog</a></p>
      </div>
      <div className="card"><h3>Communication</h3>
        <div className="dashTiles">
          <Tile label="AI active chats" value={k.aiChats} href="/admin/whatsapp" />
          <Tile label="Human chats" value={k.humanChats} href="/admin/whatsapp?filter=human" />
          <Tile label="Paused chats" value={k.pausedChats} href="/admin/whatsapp?filter=paused" />
          <Tile label="Needs staff" value={k.needsStaff} href="/admin/whatsapp?filter=needs_staff" />
          <Tile label="Waiting over 10 min" value={k.waiting10} href="/admin/whatsapp?filter=waiting" />
        </div>
      </div>
      <div className="card"><h3>System</h3>
        <div className="sysGrid">{sys.map((s) => <div key={s.name} className="sysRow">
          <span className="sysDot" style={{ background: dot[s.tone] }} />
          <b>{s.name}</b><small>{label[s.tone]} - {s.detail}</small>
        </div>)}</div>
        <p className="muted">Full diagnostics live in <a href="/admin/launch">Readiness</a>.</p>
      </div>
    </section>

    <div className="card" style={{ marginTop: 12 }}><h3>Quick actions</h3>
      <div className="pager">
        <a className="btn-primary" href="/admin/analytics">Open Business Analytics</a>
        <a className="btn" href="/admin/vehicles/new">+ Add vehicle</a>
        <a className="miniBtn" href="/admin/whatsapp">Inbox</a>
        <a className="miniBtn" href="/admin/ai-catalog">AI Catalog</a>
        <a className="miniBtn" href="/admin/imports">Inventory Review</a>
        <a className="miniBtn" href="/admin/quotes">Create quote</a>
        <a className="miniBtn" href="/admin/shipments">Create shipment</a>
        <a className="miniBtn" href="/admin/social">Social publishing</a>
        <a className="miniBtn" href="/admin/launch">Readiness</a>
        <a className="miniBtn" href="/admin/ai-test">Test the AI</a>
      </div>
    </div>
  </main></AdminShell>;
}
