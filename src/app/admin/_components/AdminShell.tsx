'use client';
import {useRouter} from 'next/navigation';
export default function AdminShell({children}:{children:React.ReactNode}){
 const r=useRouter();
 async function logout(){await fetch('/api/admin/logout',{method:'POST'});r.push('/admin/login');r.refresh()}
 return <><div className="adminTop"><a href="/admin"><b>SKY CARS ADMIN</b></a><nav><a href="/admin/vehicles">Vehicles</a><a href="/admin/customers">Customers</a><a href="/admin/quotes">Quotes</a><a href="/admin/shipments">Tracking</a><a href="/admin/whatsapp">WhatsApp</a><a href="/admin/settings">Settings</a><button onClick={logout}>Log out</button></nav></div>{children}</>
}
