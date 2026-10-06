import { redirect } from 'next/navigation';
import { isAdmin } from '../../../../lib/admin';
import AdminShell from '../../_components/AdminShell';
import AddVehicleClient from './AddVehicleClient';
export const dynamic = 'force-dynamic';
export default async function Page() {
  if (!(await isAdmin())) redirect('/admin/login');
  return <AdminShell><main className="adminPage"><div className="adminTitle"><div><h1>Add Vehicle</h1><p>Five quick steps. Works on your phone. Only exact stock photos you upload here are used for customers and the AI.</p></div><a className="miniBtn" href="/admin/vehicles">Back to inventory</a></div><AddVehicleClient /></main></AdminShell>;
}
