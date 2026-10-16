import { redirect } from 'next/navigation';
import { isAdmin } from '../../../../lib/admin';
import AdminShell from '../../_components/AdminShell';
import VehicleForm from '../_components/VehicleForm';
export const dynamic = 'force-dynamic';
export default async function Page() {
  if (!(await isAdmin())) redirect('/admin/login');
  return <AdminShell><main className="adminPage"><div className="adminTitle"><div><h1>Add Vehicle</h1><p>Everything on one page: details, pricing, exact photos and sales settings - one Save.</p></div><a className="miniBtn" href="/admin/vehicles">Back to inventory</a></div><VehicleForm mode="create" /></main></AdminShell>;
}
