import {redirect} from 'next/navigation';
import {isAdmin} from '../../../../lib/admin';
import {getAnalytics} from '../../../../lib/analytics';
import AnalyticsDashboard from '../_components/AnalyticsDashboard';

export const dynamic='force-dynamic';
export const metadata={title:'Sky Cars Analytics Print Report',robots:{index:false,follow:false,noarchive:true}};

const one=(v:any)=>Array.isArray(v)?String(v[0]||''):String(v||'');

export default async function Page({searchParams}:{searchParams:Promise<Record<string,string|string[]|undefined>>}){
  if(!(await isAdmin()))redirect('/admin/login');
  const sp=await searchParams;
  const report=await getAnalytics({range:one(sp.range)||'30d',from:one(sp.from),to:one(sp.to)});
  return <main className="adminPage analyticsPage analyticsPrintPage"><AnalyticsDashboard report={report} printMode/></main>;
}
