import {redirect} from 'next/navigation';
import {isAdmin} from '../../../lib/admin';
import AdminShell from '../_components/AdminShell';
import LaunchReadiness from './LaunchReadiness';
export const dynamic='force-dynamic';
export default async function Page(){if(!(await isAdmin()))redirect('/admin/login');return <AdminShell><main className="adminPage"><div className="adminTitle"><div><h1>Sell Now — Launch Readiness</h1><p>One place to verify the website, Facebook, WhatsApp AI, Group Reader, real inventory photos and Lab before you start promoting cars.</p></div></div><LaunchReadiness/></main></AdminShell>}
