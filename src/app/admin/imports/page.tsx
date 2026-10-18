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
  const [counts,bridge]=await Promise.all([
    one<any>(`SELECT COUNT(*) total, SUM(review_status='pending') pending, SUM(review_status='approved') approved, SUM(review_status='rejected') rejected, MAX(created_at) last_at FROM inventory_import_items`).catch(()=>null),
    rows<any>(`SELECT bridge_online,last_seen_at FROM whatsapp_group_bridge_status ORDER BY id DESC LIMIT 1`).catch(()=>[]),
  ]);
  const b=bridge[0]||null;
  return <AdminShell><main className="adminPage">
    <div className="adminTitle"><div><h1>Inventory Review &amp; Import</h1><p>Import approved Sky Cars data and review supplier inventory before publication.</p></div></div>
    <section className="stats">
      <div className="stat"><b>{Number(counts?.total||0)}</b><span>Supplier posts received</span></div>
      <div className="stat"><b>{Number(counts?.pending||0)}</b><span>Awaiting review</span></div>
      <div className="stat"><b>{Number(counts?.approved||0)}</b><span>Approved</span></div>
      <div className="stat"><b>{Number(counts?.rejected||0)}</b><span>Rejected</span></div>
      <div className="stat"><b>{counts?.last_at?new Date(String(counts.last_at).replace(' ','T')).toLocaleDateString():'never'}</b><span>Last import</span></div>
    </section>
    <div className={b?.bridge_online?'status':'status danger'}>
      <b>Group reader bridge:</b> {b?(b.bridge_online?'online':'offline')+(b.last_seen_at?` - last heartbeat ${new Date(String(b.last_seen_at).replace(' ','T')).toLocaleString()}`:''):'no heartbeat recorded'}
      {' - '}{Number(counts?.pending||0)===0?'No drafts are waiting: that is an empty queue, not a disconnection - check the bridge heartbeat above.':'Pending drafts are listed below for review.'}
    </div>
    <V16ImportClient/>
    <div className="setupAlert"><b>Supplier rule:</b> supplier identity stays internal. New supplier vehicles enter review before they become public. Re-running the 50-vehicle import is safe: existing stock numbers are skipped, never duplicated.</div>
  </main></AdminShell>;
}