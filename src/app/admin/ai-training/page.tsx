import { redirect } from 'next/navigation';
import { isAdmin } from '../../../lib/admin';
import AdminShell from '../_components/AdminShell';
import AiTrainingCenter from './AiTrainingCenter';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'AI Training & Command Center', robots: { index: false, follow: false, noarchive: true } };

export default async function Page() {
  if (!(await isAdmin())) redirect('/admin/login');
  return <AdminShell><main className="adminPage aiTrainingPage">
    <div className="adminTitle">
      <div><h1>AI Training &amp; Command Center</h1><p>Teach, test, correct and govern the sales assistant from approved MySQL knowledge without a redeployment.</p></div>
      <div className="livePill">LIVE RUNTIME RULES</div>
    </div>
    <AiTrainingCenter />
  </main></AdminShell>;
}
