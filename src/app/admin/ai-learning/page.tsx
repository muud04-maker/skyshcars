import { redirect } from 'next/navigation';
import { isAdmin } from '../../../lib/admin';
import AdminShell from '../_components/AdminShell';
import AiLearningClient from './AiLearningClient';

/*
  Part 7/20: private AI Learning Center. Admin only.
  The AI never trains itself: staff feedback becomes a candidate lesson, a human approves it, and the
  owner applies it (referral mapping / business knowledge / prompt context).
*/
export const dynamic = 'force-dynamic';
export const metadata = { title: 'AI Learning', robots: { index: false, follow: false, noarchive: true } };

export default async function Page() {
  if (!(await isAdmin())) redirect('/admin/login');
  return <AdminShell><main className="adminPage">
    <h1>AI Learning Center</h1>
    <p className="muted">Reviews of real replies: staff corrections, wrong answers, good answers and business rules. Nothing changes the AI until you approve and apply it.</p>
    <AiLearningClient />
  </main></AdminShell>;
}
