'use client';
import {useState} from 'react';

function TokenStatus({fb}:{fb:any}){
 if(!fb)return null;
 const src=fb.tokenSource==='page_token'?'Page token':fb.tokenSource==='user_token'?'Derived from a user token':'Not connected — see Readiness';
 return <div style={{display:'grid',gap:4,fontSize:14}}>
  {fb.name&&<p style={{margin:0}}><b>{fb.name}</b><br/><small>Page ID {fb.id}</small></p>}
  <div className="settingRow"><span>Token source</span><b>{src}</b></div>
  {fb.debugAvailable&&<><div className="settingRow"><span>Expires</span><b className={fb.neverExpires||((fb.daysLeft??99)>=14)?'ok':'bad'}>{fb.neverExpires?'Never (long-lived Page token)':fb.expiresAt?`${new Date(fb.expiresAt).toLocaleDateString()} (${fb.daysLeft} days)`:'Unknown'}</b></div>
  <div className="settingRow"><span>Posting permission</span><b className={fb.missingScopes&&fb.missingScopes.length===0?'ok':'bad'}>{fb.missingScopes?(fb.missingScopes.length?`Missing ${fb.missingScopes.join(', ')}`:'pages_manage_posts ✓'):'Unknown'}</b></div></>}
  {fb.error&&<p className="bad" style={{margin:0}}>{fb.error}</p>}
  {(fb.warnings||[]).map((w:string)=><p key={w} className="muted" style={{margin:0}}>⚠ {w}</p>)}
 </div>
}

export default function SocialPublisher({initial:_,configured,vehicles,logs}:{initial:any,configured:any,vehicles:any[],logs:any[]}){
 const [msg,setMsg]=useState(''),[vehicle,setVehicle]=useState(''),[live,setLive]=useState(configured),[busy,setBusy]=useState(false);
 async function test(){setBusy(true);setMsg('Checking live Facebook and WhatsApp connections…');const r=await fetch('/api/admin/social',{cache:'no-store'});const j=await r.json();setLive(j.configured||{});setMsg(j?.configured?.facebook?'Facebook Page connection verified (nothing was posted).':'Facebook connection needs attention — see Connection status.');setBusy(false)}
 async function send(channel:string,repost=false):Promise<any>{const r=await fetch('/api/admin/social',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({vehicle_id:Number(vehicle),channel,repost})});return {ok:r.ok,j:await r.json().catch(()=>({}))}}
 async function publish(channel:string){
  if(!vehicle){setMsg('Choose a vehicle first');return}
  const v=vehicles.find(x=>String(x.id)===String(vehicle));
  if((channel==='facebook'||channel==='both')&&v&&!Number(v.has_real_photo)&&!confirm('This vehicle has no exact photo. Facebook will get a text + link post saying exact photos are available on request. Continue?'))return;
  setBusy(true);setMsg('Publishing…');
  let {ok,j}=await send(channel);
  if(ok&&j.result?.facebook?.alreadyPosted&&confirm(`${j.result.facebook.skipped}. Post this vehicle to Facebook again?`)){({ok,j}=await send('facebook',true))}
  if(!ok){setMsg(j.error||'Publish failed')}else{const parts=[];const fb=j.result?.facebook;if(fb)parts.push(fb.ok&&!fb.skipped?`Facebook post published${fb.exactPhoto?' with exact photo':' as link post'}${fb.id?` (${fb.id})`:''}`:`Facebook: ${fb.error||fb.skipped||'failed'}`);if(j.result?.whatsapp)parts.push(j.result.whatsapp.ok?`WhatsApp shared to ${j.result.whatsapp.sent??0} opted-in active chat(s)`:`WhatsApp: ${j.result.whatsapp.skipped||'failed'}`);setMsg(parts.join(' · ')||'Done')}
  setBusy(false)
 }
 const selected=vehicles.find(v=>String(v.id)===String(vehicle));
 return <>
  <div className="settingsGrid">
   <div className="card"><h2>Publishing controls</h2><p className="muted">Manual posting is handled here. Automatic new-vehicle campaigns are controlled only in <a href="/admin/automation">Automation Center</a> so there is one source of truth.</p><p>Each vehicle is posted to Facebook <b>once</b>. Automatic posts are only made when the vehicle has an <b>exact photo</b> of the unit; otherwise they are skipped and logged.</p><a className="btn" href="/admin/automation">Open Automation Center</a></div>
   <div className="card"><h2>Connection status</h2>
    <div className="settingRow"><span>Facebook Page</span><b className={live.facebook?'ok':'bad'}>{live.facebook?'Connected':'Needs attention'}</b></div>
    <TokenStatus fb={live.facebookDetails}/>
    <div className="settingRow"><span>WhatsApp Cloud API</span><b className={live.whatsapp?'ok':'bad'}>{live.whatsapp?'Configured':'Not configured'}</b></div>
    <button className="miniBtn" disabled={busy} onClick={test}>Test connection</button>
    <p className="muted">The test only reads the Page and token details; it never posts.</p>
   </div>
  </div>
  <div className="card" style={{marginTop:18}}><h2>Publish a vehicle now</h2><select className="statusSelect" value={vehicle} onChange={e=>setVehicle(e.target.value)}><option value="">Choose available vehicle</option>{vehicles.map(v=><option value={v.id} key={v.id}>{v.stock_no} — {v.model_year||''} {v.brand||''} {v.model||''}{Number(v.has_real_photo)?' · exact photo':' · no exact photo'}{Number(v.fb_posted)?' · already on Facebook':''}</option>)}</select>{selected&&<p className="muted">{Number(selected.has_real_photo)?'✓ Has an exact photo of this unit — it will be posted with that photo.':'No exact photo of this unit. A manual Facebook post will be text + link and will say exact photos are available on request. Automatic posting skips this vehicle.'}{Number(selected.fb_posted)?' Already posted to Facebook — you will be asked before posting again.':''}</p>}<button className="miniBtn" disabled={busy} onClick={()=>publish('facebook')}>Post Facebook</button> <button className="miniBtn" disabled={busy} onClick={()=>publish('whatsapp')}>Share WhatsApp</button> <button className="miniBtn" disabled={busy} onClick={()=>publish('both')}>Both</button><p><b>{msg}</b></p></div>
  <div className="card" style={{marginTop:18}}><h2>Recent publishing activity</h2><div className="tableWrap"><table className="table"><thead><tr><th>Vehicle</th><th>Channel</th><th>Status</th><th>Details</th><th>Time</th></tr></thead><tbody>{logs.length?logs.map((l:any)=><tr key={l.id}><td>{l.stock_no||l.vehicle_id} {l.brand||''} {l.model||''}</td><td>{l.channel}</td><td>{l.status}</td><td style={{maxWidth:360,whiteSpace:'pre-wrap'}}>{String(l.details||'').slice(0,300)}</td><td>{String(l.created_at||'')}</td></tr>):<tr><td colSpan={5}>No publishing activity yet.</td></tr>}</tbody></table></div></div>
 </>
}
