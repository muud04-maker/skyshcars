import { redirect } from 'next/navigation';
import { isAdmin } from '../../../lib/admin';
import AdminShell from '../_components/AdminShell';
import CustomerHistoryClient from './CustomerHistoryClient';

/*
  Part 5/6/19: private Customer History + Customer 360 page. Admin only, never public, and built as
  a phone-first list -> history -> back flow (no wide table that needs sideways scrolling).
*/
export const dynamic = 'force-dynamic';
export const metadata = { title: 'Customer History', robots: { index: false, follow: false, noarchive: true } };

export default async function Page() {
  if (!(await isAdmin())) redirect('/admin/login');
  return <AdminShell><main className="adminPage">
    <h1>Customer History</h1>
    <p className="muted">Every customer, every channel, one complete history: messages, AI and staff replies, referrals, quotes, memory and private notes.</p>
    <CustomerHistoryClient />
  </main></AdminShell>;
}
