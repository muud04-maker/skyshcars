import { redirect } from 'next/navigation';
import { isAdmin } from '../../../lib/admin';
import AdminShell from '../_components/AdminShell';
import PhotoCheckClient from './PhotoCheckClient';
export const dynamic = 'force-dynamic';
export default async function Page() {
  if (!(await isAdmin())) redirect('/admin/login');
  return <AdminShell><main className="adminPage"><div className="adminTitle"><div><h1>Photo Check</h1>
    <p>Why the WhatsApp assistant does or does not send photos of each Available vehicle. Only exact photos in JPEG or PNG that WhatsApp can download are sent.</p></div></div>
    <PhotoCheckClient /></main></AdminShell>;
}
