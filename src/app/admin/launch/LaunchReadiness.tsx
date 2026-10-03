'use client';
import {useEffect,useState} from 'react';
const ICON:any={ok:'✓',warn:'!',fail:'✕',info:'i'};
const LABEL:any={ok:'Ready',warn:'Attention',fail:'Not working',info:'Info'};
const CLS:any={ok:'ok',warn:'bad',fail:'bad',info:''};
export default function LaunchReadiness(){
 const [d,setD]=useState<any>(null),[loading,setLoading]=useState(true),[err,setErr]=useState('');
 async function load(){setLoading(true);setErr('');try{const r=await fetch('/api/admin/readiness',{cache:'no-store'});if(!r.ok)throw new Error(`HTTP ${r.status}`);setD(await r.json())}catch(e:any){setErr(e?.message||'Could not run checks')}setLoading(false)}
 useEffect(()=>{load();const t=setInterval(load,60000);return()=>clearInterval(t)},[]);
 if(loading&&!d)return <div className="card"><p>Running live checks (database, WhatsApp, Facebook, AI, Group Reader)…</p></div>;
 const checks:any[]=d?.checks||[];const areas=Array.from(new Set(checks.map(c=>c.area)));
 return <>
  <div className="card" style={{marginBottom:18,display:'flex',justifyContent:'space-between',alignItems:'center',gap:12,flexWrap:'wrap'}}>
   <div><b className="ok">{d?.summary?.ok||0} ready</b> · <b className="bad">{d?.summary?.fail||0} not working</b> · <b>{d?.summary?.warn||0} need attention</b><br/><small className="muted">Live checks at {d?.checkedAt?new Date(d.checkedAt).toLocaleString():'—'}. Nothing is sent or posted by these checks.</small>{err&&<p className="bad">{err}</p>}{d?.needsSetup?.length>0&&<p style={{margin:'8px 0 0'}}>Settings still needed (add in Hostinger → Environment variables, then redeploy): {d.needsSetup.map((v:string)=><code key={v} style={{marginRight:6}}>{v}</code>)}</p>}</div>
   <button className="btn" disabled={loading} onClick={load}>{loading?'Checking…':'Run checks again'}</button>
  </div>
  <div className="launchGrid">{areas.map(a=><div className="card" key={a}><h2>{a}</h2>{checks.filter(c=>c.area===a).map(c=><div key={c.id} style={{borderTop:'1px solid #e3ebf2',padding:'8px 0'}}>
   <div style={{display:'flex',justifyContent:'space-between',gap:8}}><span>{c.label}</span><b className={CLS[c.status]}>{ICON[c.status]} {LABEL[c.status]}</b></div>
   <small className="muted">{c.detail}</small>{c.link&&<> <a href={c.link}>Open →</a></>}
  </div>)}</div>)}</div>
  <div className="card" style={{marginTop:18}}><h2>Launch order</h2><ol><li>Fix everything marked <b>Not working</b>.</li><li>Approve only vehicles you can genuinely sell, with exact stock-unit photos where possible.</li><li>Make sure the Group Reader bridge is online if supplier groups are your motorcycle source.</li><li>Use Social Auto-Post to test one real vehicle on Facebook.</li><li>After the test succeeds, enable automatic Facebook posting in Automation Center.</li><li>Send a WhatsApp message to the business number and confirm the AI reply.</li></ol></div>
 </>
}
