import { redirect } from 'next/navigation';
import { isAdmin } from '../../../lib/admin';
import AdminShell from '../_components/AdminShell';
import AllHistoryClient from './AllHistoryClient';

/*
  GOAL 1: one chronological stream across ALL customers and ALL channels (admin only).
  No need to open customers one by one, plus a single streaming TXT export of everything shown.
*/
export const dynamic = 'force-dynamic';
export const metadata = { title: 'All History', robots: { index: false, follow: false, noarchive: true } };

export default async function Page() {
  if (!(await isAdmin())) redirect('/admin/login');
  return <AdminShell><main className="adminPage">
    <h1>All History</h1>
    <p className="muted">Every customer, every channel, one chronological stream: inbound messages, AI replies, staff replies, referrals, quotes, notes, memory changes and AI learning events.</p>
    <AllHistoryClient />
  </main></AdminShell>;
}
