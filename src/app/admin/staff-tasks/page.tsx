import { redirect } from 'next/navigation';
import { isAdmin } from '../../../lib/admin';
import AdminShell from '../_components/AdminShell';
import StaffTasksClient from './StaffTasksClient';

/*
  Brief priority 5 / items 87-89, 104-105: ONE auditable queue for the work only a human can finish -
  real photos, freight quotes, sourcing, serious buyers. Phone-friendly cards, no wide tables.
*/
export const dynamic = 'force-dynamic';
export const metadata = { title: 'Staff Tasks', robots: { index: false, follow: false, noarchive: true } };

export default async function Page() {
  if (!(await isAdmin())) redirect('/admin/login');
  return <AdminShell><main className="adminPage">
    <h1>Staff Tasks</h1>
    <p className="muted">Real requests the AI handed to you: photos of a specific unit, freight quotes, sourcing, serious buyers. Nothing here is sent to a customer automatically.</p>
    <StaffTasksClient />
  </main></AdminShell>;
}
