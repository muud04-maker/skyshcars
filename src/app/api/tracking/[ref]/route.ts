import {one,rows,dbConfigured} from '../../../../lib/db';
import {clientIp,rateLimit} from '../../../../lib/ratelimit';
export const dynamic='force-dynamic';
// Public shipment tracking. Never errors with technical details; switches off quietly without a database.
export async function GET(req:Request,{params}:{params:Promise<{ref:string}>}){
  const {ref:raw}=await params;const ref=String(raw||'').trim().slice(0,80);
  if(!ref)return Response.json({error:'Enter your tracking reference.'},{status:400});
  if(!rateLimit('tracking:'+clientIp(req),30,10*60*1000).ok)return Response.json({error:'Too many lookups. Please wait a few minutes and try again.'},{status:429});
  if(!dbConfigured())return Response.json({error:'Tracking is temporarily unavailable. Please contact us on WhatsApp for an update.'},{status:503});
  try{
    const s:any=await one('SELECT tracking_reference,current_status,vessel_name,container_no,eta,public_note FROM shipments WHERE tracking_reference=? LIMIT 1',[ref]);
    if(!s)return Response.json({error:'We could not find that tracking reference. Please check it and try again.'},{status:404});
    const events=await rows('SELECT status,title,public_description,event_time FROM tracking_events WHERE shipment_id=(SELECT id FROM shipments WHERE tracking_reference=? LIMIT 1) ORDER BY event_time DESC',[ref]);
    return Response.json({...s,events});
  }catch(e){console.error('TRACKING',e);return Response.json({error:'Tracking is temporarily unavailable. Please contact us on WhatsApp for an update.'},{status:503})}
}
