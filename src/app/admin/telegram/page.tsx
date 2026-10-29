import { redirect } from 'next/navigation';
import { isAdmin } from '../../../lib/admin';
import AdminShell from '../_components/AdminShell';
import TelegramAutomationClient from './TelegramAutomationClient';

export const dynamic = 'force-dynamic';

export default async function Page() {
  if (!(await isAdmin())) redirect('/admin/login');
  return <AdminShell><main className="adminPage">
    <div className="adminTitle"><div><h1>Telegram Automation</h1><p>Authorized supplier-group webhooks, original-photo ingestion, duplicate protection and automatic publication.</p></div></div>
    <TelegramAutomationClient />
  </main></AdminShell>;
}
