import {redirect} from 'next/navigation';
import {isAdmin} from '../../../lib/admin';
import {getAnalytics} from '../../../lib/analytics';
import AdminShell from '../_components/AdminShell';
import AnalyticsDashboard from './_components/AnalyticsDashboard';

export const dynamic='force-dynamic';
export const metadata={title:'Business Analytics | Sky Cars',robots:{index:false,follow:false,noarchive:true}};

const one=(v:any)=>Array.isArray(v)?String(v[0]||''):String(v||'');

export default async function Page({searchParams}:{searchParams:Promise<Record<string,string|string[]|undefined>>}){
  if(!(await isAdmin()))redirect('/admin/login');
  const sp=await searchParams;
  const report=await getAnalytics({range:one(sp.range)||'30d',from:one(sp.from),to:one(sp.to)});
  return <AdminShell><main className="adminPage analyticsPage"><AnalyticsDashboard report={report}/></main></AdminShell>;
}
