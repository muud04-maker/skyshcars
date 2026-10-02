import {redirect,notFound} from 'next/navigation';
import {isLabOwner} from '../../../../lib/lab-auth';
import {labApp} from '../../../../lib/lab';
export const dynamic='force-dynamic';
export const metadata={robots:{index:false,follow:false,noarchive:true}};
export default async function Page({params}:{params:Promise<{slug:string}>}){
 if(!(await isLabOwner()))redirect('/lab/login');
 const {slug}=await params;const app=await labApp(slug);if(!app)notFound();
 return <main style={{minHeight:'100vh',background:'#0b1220',color:'#eef5ff',padding:20}}>
  <div style={{maxWidth:1440,margin:'0 auto'}}>
   <div style={{display:'flex',justifyContent:'space-between',gap:12,alignItems:'center',marginBottom:16}}><div><small style={{opacity:.6}}>PRIVATE LAB · {app.status}</small><h1 style={{margin:'4px 0'}}>{app.name}</h1></div><a href="/" style={{color:'#ffd34e'}}>← Lab dashboard</a></div>
   {app.launch_url?<iframe src={app.launch_url} title={app.name} style={{width:'100%',height:'calc(100vh - 130px)',border:'1px solid #273650',borderRadius:14,background:'#fff'}} sandbox="allow-forms allow-modals allow-popups allow-presentation allow-same-origin allow-scripts allow-downloads"/>:<div style={{padding:40,border:'1px solid #273650',borderRadius:14,background:'#111c2f'}}><h2>Development slot ready</h2><p>Add a deployment URL from the Lab dashboard when this app is ready.</p></div>}
  </div>
 </main>
}
