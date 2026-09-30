import {redirect} from 'next/navigation';
import {isAdmin} from '../../lib/admin';

export default async function AdminLayout({children}:{children:React.ReactNode}){
  // Login must remain reachable even when no admin session exists.
  // Authentication is enforced by each protected admin page/API.
  return <>{children}</>;
}

export async function requireAdmin(){
  if(!(await isAdmin())) redirect('/admin/login');
}
