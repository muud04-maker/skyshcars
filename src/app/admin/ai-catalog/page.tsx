import { redirect } from 'next/navigation';
import { isAdmin } from '../../../lib/admin';
import AdminShell from '../_components/AdminShell';
import AiCatalogClient from './AiCatalogClient';
export const dynamic = 'force-dynamic';
export default async function Page() {
  if (!(await isAdmin())) redirect('/admin/login');
  return <AdminShell><main className="adminPage"><div className="adminTitle"><div><h1>AI Catalog</h1>
    <p>The cars the WhatsApp and Messenger AI is allowed to sell. Cars that are off are never offered, priced or photographed by the AI. The website is not affected.</p></div></div>
    <AiCatalogClient /></main></AdminShell>;
}
