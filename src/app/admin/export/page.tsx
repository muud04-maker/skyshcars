import { redirect } from 'next/navigation';
import { canManageAdmins } from '../../../lib/admin';
import AdminShell from '../_components/AdminShell';
export const dynamic = 'force-dynamic';

const items: [string, string, string][] = [
  ['vehicles', 'Vehicles', 'Every vehicle with price, status and specs (no supplier data).'],
  ['customers', 'Customers', 'Customer names, phone, email and country.'],
  ['leads', 'Leads', 'Website contact messages and leads.'],
  ['quotes', 'Quote requests', 'All quote requests and their status.'],
];

export default async function Page() {
  if (!(await canManageAdmins())) redirect('/admin/login');
  return <AdminShell><main className="adminPage"><h1>Backup / Export</h1>
    <p className="muted">Download your business data as an Excel-friendly CSV file. Do this regularly and keep the files somewhere safe. Passwords, API keys and private supplier prices are never included. Every download is recorded in the Audit Log.</p>
    <div className="knowledgeGrid">{items.map(([k, t, d]) => <div className="card" key={k}><b>{t}</b><p className="muted">{d}</p><a className="btn" href={`/api/admin/export/${k}`}>Download {t} CSV</a></div>)}</div>
    <div className="setupAlert"><b>Also back up the database itself.</b><br />In Hostinger hPanel go to Databases → phpMyAdmin → Export, or enable Hostinger automatic backups. CSV files are a convenience copy, not a full database backup.</div>
  </main></AdminShell>;
}
