import {redirect} from 'next/navigation';
import {isAdmin} from '../../../lib/admin';
import {one,rows} from '../../../lib/db';
import AdminShell from '../_components/AdminShell';
import V16ImportClient from './V16ImportClient';
export const dynamic='force-dynamic';
export default async function Page(){
  if(!(await isAdmin()))redirect('/admin/login');
  /*
    Import/bridge state (brief section 7): last run, counts by review status, and whether the group
    bridge is actually reporting - so "no drafts" is never confused with "service disconnected".
  */
  const [counts,bridge,telegram]=await Promise.all([
    one<any>(`SELECT COUNT(*) total, SUM(review_status='pending') pending, SUM(review_status='approved') approved, SUM(review_status='rejected') rejected, MAX(created_at) last_at FROM inventory_import_items`).catch(()=>null),
    rows<any>(`SELECT status,last_heartbeat_at,details,TIMESTAMPDIFF(MINUTE,last_heartbeat_at,NOW()) minutes_ago FROM whatsapp_group_bridge_status ORDER BY last_heartbeat_at DESC LIMIT 1`).catch(()=>[]),
    one<any>(`SELECT state,group_id,group_title,bot_username,bot_is_admin,pending_updates,last_error,checked_at FROM telegram_connection_state WHERE id=1`).catch(()=>null),
  ]);
  const b=bridge[0]||null;
  const bridgeOnline=!!b&&b.status==='online'&&Number(b.minutes_ago)>=0&&Number(b.minutes_ago)<3;
  return <AdminShell><main className="adminPage">
    <div className="adminTitle"><div><h1>Inventory Review &amp; Import</h1><p>Import approved Sky Cars data and review supplier inventory before publication.</p></div></div>
    <section className="stats">
      <div className="stat"><b>{Number(counts?.total||0)}</b><span>Supplier posts received</span></div>
      <div className="stat"><b>{Number(counts?.pending||0)}</b><span>Awaiting review</span></div>
      <div className="stat"><b>{Number(counts?.approved||0)}</b><span>Approved</span></div>
      <div className="stat"><b>{Number(counts?.rejected||0)}</b><span>Rejected</span></div>
      <div className="stat"><b>{counts?.last_at?new Date(String(counts.last_at).replace(' ','T')).toLocaleDateString():'never'}</b><span>Last import</span></div>
    </section>
    <div className={telegram?.state==='connected'?'status':'status danger'}>
      <b>Telegram automation:</b>{' '}
      {telegram?.state==='connected'
        ? `connected to ${telegram.group_title||'Skyshcars'} · @${telegram.bot_username||'bot'} · pending updates ${Number(telegram.pending_updates||0)}`
        : String(telegram?.state||'not checked').replaceAll('_',' ')}
      {telegram?.last_error ? ` · ${telegram.last_error}` : ''}
      {' · '}{Number(counts?.pending||0)===0?'No imports are waiting: this is an empty queue, not a disconnection.':'Pending imports are listed below.'}
    </div>
    <div className={bridgeOnline?'status':'card'}>
      <b>Legacy WhatsApp Group Reader:</b> {b?`${bridgeOnline?'online':String(b.status||'offline').replaceAll('_',' ')}${b.last_heartbeat_at?` - last heartbeat ${new Date(String(b.last_heartbeat_at).replace(' ','T')).toLocaleString()}`:''}`:'no heartbeat recorded'}.
      This status is independent of Telegram and does not make the Telegram connection unhealthy.
    </div>
    <V16ImportClient/>
    <div className="setupAlert"><b>Supplier rule:</b> supplier identity stays internal. New supplier vehicles enter review before they become public. Re-running the 50-vehicle import is safe: existing stock numbers are skipped, never duplicated.</div>
  </main></AdminShell>;
}
