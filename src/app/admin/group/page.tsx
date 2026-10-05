import { redirect } from 'next/navigation';
import { isAdmin } from '../../../lib/admin';
import AdminShell from '../_components/AdminShell';
import GroupClient from './GroupClient';
export const dynamic = 'force-dynamic';
export default async function Page() {
  if (!(await isAdmin())) redirect('/admin/login');
  return <AdminShell><main className="adminPage"><div className="adminTitle"><div><h1>WhatsApp Groups</h1>
    <p>Every message from authorized groups, and every member. Questions are highlighted. Private: never shown on the website.</p></div></div>
    <GroupClient /></main></AdminShell>;
}
