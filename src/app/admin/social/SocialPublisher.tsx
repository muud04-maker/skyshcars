'use client';
import {useState} from 'react';
export default function SocialPublisher({initial,configured,vehicles,logs}:{initial:any,configured:any,vehicles:any[],logs:any[]}){
 const [s,setS]=useState(initial),[msg,setMsg]=useState(''),[vehicle,setVehicle]=useState('');
 async function save(){setMsg('Saving…');const r=await fetch('/api/admin/social',{method:'PATCH',headers:{'content-type':'application/json'},body:JSON.stringify(s)});const j=await r.json();setMsg(r.ok?'Saved':'Could not save');if(r.ok)setS(j.settings)}
 async function publish(channel:string){if(!vehicle){setMsg('Choose a vehicle first');return}setMsg('Publishing…');const r=await fetch('/api/admin/social',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({vehicle_id:Number(vehicle),channel})});const j=await r.json();setMsg(r.ok?JSON.stringify(j.result):j.error||'Publish failed')}
 return <>
  <div className="settingsGrid">
   <div className="card"><h2>Automatic publishing</h2><p className="muted">Runs once when a vehicle first becomes Available.</p>
    <label className="settingRow"><span>Facebook Page auto-post</span><input type="checkbox" checked={!!s.facebook_auto} onChange={e=>setS({...s,facebook_auto:e.target.checked})}/></label>
    <label className="settingRow"><span>WhatsApp active-chat auto-share</span><input type="checkbox" checked={!!s.whatsapp_active_chats_auto} onChange={e=>setS({...s,whatsapp_active_chats_auto:e.target.checked})}/></label>
    <p className="muted">Only approved real vehicle photos are used for Facebook/WhatsApp publishing. Reference images are website-only.</p>
    <button className="btn" onClick={save}>Save settings</button><p>{msg}</p>
   </div>
   <div className="card"><h2>Connection status</h2><div className="settingRow"><span>Facebook Page</span><b className={configured.facebook?'ok':'bad'}>{configured.facebook?'Configured':'Needs META_PAGE_ID + META_PAGE_ACCESS_TOKEN'}</b></div><div className="settingRow"><span>WhatsApp</span><b className={configured.whatsapp?'ok':'bad'}>{configured.whatsapp?'Configured':'Not configured'}</b></div><p className="muted">WhatsApp auto-share only sends to AI-mode customer chats active in the last 24 hours. This does not post to WhatsApp Status.</p></div>
  </div>
  <div className="card" style={{marginTop:18}}><h2>Publish a vehicle now</h2><select className="statusSelect" value={vehicle} onChange={e=>setVehicle(e.target.value)}><option value="">Choose available vehicle</option>{vehicles.map(v=><option value={v.id} key={v.id}>{v.stock_no} — {v.model_year||''} {v.brand||''} {v.model||''}</option>)}</select> <button className="miniBtn" onClick={()=>publish('facebook')}>Post Facebook</button> <button className="miniBtn" onClick={()=>publish('whatsapp')}>Share WhatsApp</button> <button className="miniBtn" onClick={()=>publish('both')}>Both</button></div>
  <div className="card" style={{marginTop:18}}><h2>Recent publishing activity</h2><div className="tableWrap"><table className="table"><thead><tr><th>Vehicle</th><th>Channel</th><th>Status</th><th>Time</th></tr></thead><tbody>{logs.map((l:any)=><tr key={l.id}><td>{l.stock_no||l.vehicle_id} {l.brand||''} {l.model||''}</td><td>{l.channel}</td><td>{l.status}</td><td>{String(l.created_at||'')}</td></tr>)}</tbody></table></div></div>
 </>
}
