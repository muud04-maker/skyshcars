import {redirect} from 'next/navigation';import {isAdmin} from '../../../lib/admin';import AdminShell from '../_components/AdminShell';import WhatsAppHealthClient from './WhatsAppHealthClient';
export const dynamic='force-dynamic';
export default async function Page(){if(!(await isAdmin()))redirect('/admin/login');return <AdminShell><main className="adminPage"><div className="adminTitle"><div><h1>WhatsApp Diagnostics</h1><p>Live proof that Meta webhooks arrive, messages enter MySQL, and replies are sent.</p></div></div><WhatsAppHealthClient/></main></AdminShell>}
