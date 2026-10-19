'use client';
import {useState} from 'react';
import {waLink} from '../../lib/site';

export default function Contact(){
  const [message,setMessage]=useState('');
  const [busy,setBusy]=useState(false);
  async function send(e:any){
    e.preventDefault();
    setBusy(true);
    try{
      const form=new FormData(e.currentTarget);
      const response=await fetch('/api/contact',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(Object.fromEntries(form))});
      setMessage(response.ok?'Message received. Our team will contact you.':'Unable to send. Please use WhatsApp.');
    }catch{
      setMessage('Unable to send. Please use WhatsApp.');
    }finally{
      setBusy(false);
    }
  }
  return <main className="wrap pageContact theme-editorial">
    <section className="editorialHero">
      <span className="eyebrow">CONTACT</span>
      <h1>Tell us what you need.</h1>
      <p>Share the vehicle, destination or question and our team will follow up. For the fastest conversation, use WhatsApp.</p>
    </section>
    <div className="contactGrid">
      <form className="card contactPanel" onSubmit={send}>
        <h2>Send a message</h2>
        <div className="contactFields">
          <label>Name<input name="name" required autoComplete="name" placeholder="Your name"/></label>
          <label>WhatsApp / phone<input name="phone" autoComplete="tel" placeholder="Optional"/></label>
          <label className="wide">Email<input name="email" type="email" autoComplete="email" placeholder="Optional"/></label>
          <label className="wide">How can we help?<textarea name="message" required placeholder="Vehicle, destination or question"/></label>
        </div>
        <button className="btn" disabled={busy}>{busy?'Sending…':'Send message'}</button>
        {message&&<p className="status" role="status" aria-live="polite">{message}</p>}
      </form>
      <aside className="card contactAside">
        <span className="eyebrow">DIRECT CONTACT</span>
        <h2>WhatsApp the team</h2>
        <p>Send a vehicle link or stock number and ask for current photos, availability or a shipping quote.</p>
        <div className="emptyActions"><a className="btn" href={waLink('Hello Sky Cars, I would like help with a vehicle.')} target="_blank" rel="noreferrer">WhatsApp the team</a><a className="btn alt" href="/quote">Request a quote</a></div>
      </aside>
    </div>
  </main>;
}
