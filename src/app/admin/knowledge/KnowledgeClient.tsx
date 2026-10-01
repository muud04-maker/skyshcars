'use client';
import {useEffect,useState} from 'react';

type K={id:number;title:string;content:string;active:number|boolean;updated_at:string};
export default function KnowledgeClient(){
 const [items,setItems]=useState<K[]>([]),[title,setTitle]=useState(''),[content,setContent]=useState(''),[busy,setBusy]=useState(false),[msg,setMsg]=useState('');
 async function load(){const r=await fetch('/api/admin/knowledge',{cache:'no-store'});if(r.ok)setItems((await r.json()).items||[])}
 useEffect(()=>{load()},[]);
 async function add(e:React.FormEvent){e.preventDefault();setBusy(true);setMsg('');const r=await fetch('/api/admin/knowledge',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({title,content})});setBusy(false);if(!r.ok){setMsg('Could not save');return}setTitle('');setContent('');setMsg('Saved. New WhatsApp replies can use this knowledge.');load()}
 async function toggle(x:K){await fetch('/api/admin/knowledge',{method:'PATCH',headers:{'content-type':'application/json'},body:JSON.stringify({id:x.id,active:!Boolean(x.active)})});load()}
 async function del(id:number){if(!confirm('Delete this knowledge item?'))return;await fetch('/api/admin/knowledge?id='+id,{method:'DELETE'});load()}
 return <><form className="card knowledgeForm" onSubmit={add}><h2>Teach the sales assistant</h2><p className="muted">Add real business rules, common answers, sourcing instructions, payment process, or anything you want the assistant to remember. Do not put passwords here.</p><label>Title<input value={title} onChange={e=>setTitle(e.target.value)} placeholder="Example: How we handle unavailable vehicles"/></label><label>What the assistant should know<textarea value={content} onChange={e=>setContent(e.target.value)} placeholder="Example: If the exact car is not listed, ask for model, year, budget and destination, then tell the customer our sourcing team can check supplier stock."/></label><button className="btn" disabled={busy||!title.trim()||!content.trim()}>Save knowledge</button>{msg&&<p className="success">{msg}</p>}</form><div className="knowledgeGrid">{items.map(x=><div className="card" key={x.id}><div className="knowledgeHead"><b>{x.title}</b><span className={'badge '+(x.active?'':'pending')}>{x.active?'Active':'Paused'}</span></div><p style={{whiteSpace:'pre-wrap'}}>{x.content}</p><div className="mediaActions"><button className="miniBtn" onClick={()=>toggle(x)}>{x.active?'Pause':'Activate'}</button><button className="miniBtn danger" onClick={()=>del(x.id)}>Delete</button></div></div>)}</div></>
}
