import { inbound, outbound, alreadyProcessed } from '../../../../lib/conversations';
import { salesReply, AI_MODEL, vehicleMediaForMessage } from '../../../../lib/ai';
import { signatureOk, sendWhatsApp, sendWhatsAppImage, whatsappConfigured, downloadWhatsAppMedia, whatsappVerifyToken, whatsappSignatureMode } from '../../../../lib/meta';
import { db, dbConfigured } from '../../../../lib/db';
import { transcribeAudio, describeImage, mediaAiConfigured } from '../../../../lib/media-ai';
import { agentEvent } from '../../../../lib/agent-events';
import { claimReply, markReplySent, markReplyFailed } from '../../../../lib/reply-guard';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const u = new URL(req.url);
  if (u.searchParams.get('hub.mode') === 'subscribe' && whatsappVerifyToken() &&
      u.searchParams.get('hub.verify_token') === whatsappVerifyToken())
    return new Response(u.searchParams.get('hub.challenge') || '');
  return new Response('Forbidden', { status: 403 });
}

type Described = { storedText: string; aiText?: string; type: any; mediaId?: string; needsHuman?: boolean };
function describe(m: any): Described | null {
  switch (m.type) {
    case 'text': {
      const text = String(m.text?.body || '').trim();
      return text ? { storedText: text, aiText: text, type: 'text' } : null;
    }
    case 'image': {
      const caption = String(m.image?.caption || '').trim();
      return {
        storedText: caption ? `PHOTO\nCaption: ${caption}` : 'PHOTO\nImage received.',
        aiText: caption ? `Customer sent a photo with this caption: ${caption}. Continue naturally from the conversation. Do not invent unseen details.` : undefined,
        type: 'image', mediaId: m.image?.id, needsHuman: false,
      };
    }
    case 'audio':
      return { storedText: 'VOICE NOTE\nTranscription pending.', type: 'audio', mediaId: m.audio?.id, needsHuman: false };
    case 'video': {
      const caption = String(m.video?.caption || '').trim();
      return {
        storedText: caption ? `VIDEO\nCaption: ${caption}` : 'VIDEO\nNo caption supplied — human review required.',
        aiText: caption ? `Customer sent a video with this caption: ${caption}. Continue naturally and answer the caption using verified Sky Cars facts. Do not make any claim about unseen video details.` : undefined,
        type: 'video', mediaId: m.video?.id, needsHuman: !caption,
      };
    }
    case 'document': return { storedText: `[Customer sent a document${m.document?.filename ? ': ' + m.document.filename : ''}]`, type: 'document', mediaId: m.document?.id, needsHuman: true };
    case 'button': {
      const text = String(m.button?.text || '').trim();
      return text ? { storedText: text, aiText: text, type: 'text' } : null;
    }
    case 'interactive': {
      const text = String(m.interactive?.button_reply?.title || m.interactive?.list_reply?.title || '').trim();
      return text ? { storedText: text, aiText: text, type: 'text' } : null;
    }
    default: return { storedText: `[Unsupported message: ${m.type}]`, type: 'other', needsHuman: true };
  }
}

async function updateInboundBody(externalMessageId:string, body:string){
  await db().execute('UPDATE messages SET body=? WHERE external_message_id=? LIMIT 1',[body,externalMessageId]);
}

async function prepareMedia(m:any,d:Described,c:any){
  if(!d.mediaId) return d;
  if(m.type!=='audio' && m.type!=='image') return d;
  try{
    const media=await downloadWhatsAppMedia(d.mediaId);
    if(m.type==='audio'){
      if(!mediaAiConfigured()) throw new Error('Media AI key not configured');
      const transcript=await transcribeAudio(media.data,media.mimeType);
      if(!transcript) throw new Error('Voice transcription returned empty text');
      const body=`VOICE NOTE\nTranscript: ${transcript}`;
      await updateInboundBody(m.id,body);
      await agentEvent(c.id,m.id,'voice_transcription','ok',{chars:transcript.length});
      return {...d,storedText:body,aiText:`Customer sent a voice note. Transcript: ${transcript}`,needsHuman:false};
    }
    if(m.type==='image' && !d.aiText){
      if(!mediaAiConfigured()) throw new Error('Media AI key not configured');
      const visual=await describeImage(media.data,media.mimeType);
      if(!visual) throw new Error('Image analysis returned empty text');
      const body=`PHOTO\nVisual description: ${visual}`;
      await updateInboundBody(m.id,body);
      await agentEvent(c.id,m.id,'image_analysis','ok',{chars:visual.length});
      return {...d,storedText:body,aiText:`Customer sent a photo. Visual description from the media analyzer: ${visual}. Use it only as visual context; vehicle inventory/price/availability claims must still come from verified database facts.`,needsHuman:false};
    }
  }catch(e:any){
    await agentEvent(c.id,m.id,m.type==='audio'?'voice_transcription':'image_analysis','failed',e?.message||String(e));
    return {...d,needsHuman:true};
  }
  return d;
}

async function sendVehicleImages(from:string,text:string,conversationId:number){
  try {
    const wantsImage = /\b(photo|photos|picture|pictures|image|images|show me|let me see|send.*pic|send.*photo|car.*pic|vehicle.*pic)\b/i.test(text);
    if (!wantsImage) return;
    const media = await vehicleMediaForMessage(text, conversationId);
    if (media) {
      const imgs = Array.isArray((media as any).images) ? (media as any).images.slice(0,3) : [media.image];
      for (let i=0;i<imgs.length;i++) await sendWhatsAppImage(from, imgs[i], i===0 ? media.caption : `${media.title} • photo ${i+1}`);
      await outbound(conversationId, 'ai', `[${imgs.length} vehicle photo${imgs.length>1?'s':''} sent] ${media.caption}`, AI_MODEL);
    }
  } catch (err:any) {
    await agentEvent(conversationId,null,'vehicle_image_send','failed',err?.message||String(err));
    console.error('WHATSAPP_SEND_VEHICLE_IMAGE', err);
  }
}

async function handle(m: any, contacts: any[]) {
  const from = m.from;
  let d = describe(m);
  if (!from || !d) return;
  if (await alreadyProcessed(m.id)) {
    // Meta may deliver the same webhook more than once. Never auto-send another reply
    // for a message we already stored; this prevents unsolicited/duplicate WhatsApp texts.
    await agentEvent(null,m.id,'duplicate_inbound','ignored',{reason:'already_processed'}).catch(()=>{});
    return;
  }

  const name = contacts.find(c => c.wa_id === from)?.profile?.name;
  const c: any = await inbound('whatsapp', from, d.storedText, m.id, {
    type: d.type,
    name,
    mediaRef: d.mediaId ? `meta:${d.mediaId}` : undefined,
  });
  await agentEvent(c.id,m.id,'inbound','ok',{type:m.type,mode:c.mode});

  d=await prepareMedia(m,d,c);

  if (d.needsHuman) {
    await db().execute("UPDATE conversations SET mode='human', takeover_by='media-review', takeover_at=NOW() WHERE id=?", [c.id]);
    await agentEvent(c.id,m.id,'handoff','human',{reason:`${m.type} requires review or media AI is not configured`});
    return;
  }

  // Re-read mode after any media processing so an admin takeover wins immediately.
  const [modeRows]:any=await db().execute('SELECT mode FROM conversations WHERE id=? LIMIT 1',[c.id]);
  if (modeRows?.[0]?.mode !== 'ai') return;
  if (!d.aiText) return;
  if (!whatsappConfigured()) {
    await agentEvent(c.id,m.id,'reply','failed','WhatsApp send credentials not configured');
    return;
  }

  const inboundKey=String(m.id||'').trim();
  const claimed=await claimReply(inboundKey,Number(c.id),'webhook',false);
  if(!claimed){
    await agentEvent(c.id,m.id,'reply','ignored',{reason:'reply_already_claimed'});
    return;
  }
  try{
    const reply = await salesReply(d.aiText, c.id);
    if (!reply) throw new Error('AI returned no reply');
    const waId=await sendWhatsApp(from, reply);
    // Mark sent immediately after Meta accepts the message, before any secondary DB work.
    // This makes webhook retries safe even if a later database insert fails.
    await markReplySent(inboundKey,waId);
    await outbound(c.id, 'ai', reply, AI_MODEL);
    await agentEvent(c.id,m.id,'reply','ok',{whatsapp_message_id:waId,chars:reply.length});
    await sendVehicleImages(from,d.aiText,c.id);
  }catch(e:any){
    const detail=e?.response?.data||e?.message||String(e);
    await markReplyFailed(inboundKey,detail).catch(()=>{});
    await agentEvent(c.id,m.id,'reply','failed',detail);
    console.error('WHATSAPP_REPLY_ERROR',detail);
  }
}

export async function POST(req: Request) {
  const raw = await req.text();
  const sigMode = whatsappSignatureMode();
  if (!signatureOk(raw, req.headers.get('x-hub-signature-256'))) {
    if (dbConfigured()) await agentEvent(null,null,'webhook_rejected','failed',{reason:'bad_signature',signature_mode:sigMode}).catch(()=>{});
    return new Response('Bad signature', { status: 401 });
  }
  if (!dbConfigured()) { console.error('WHATSAPP_WEBHOOK: database not configured'); return new Response('EVENT_RECEIVED'); }
  try {
    const body = JSON.parse(raw);
    // When the app secret is not configured, only accept the exact object type Meta
    // sends for WhatsApp Cloud API. This is compatibility mode, not a substitute for
    // adding WHATSAPP_APP_SECRET.
    if (sigMode === 'compatibility' && body?.object !== 'whatsapp_business_account') {
      await agentEvent(null,null,'webhook_rejected','failed',{reason:'unexpected_object',object:body?.object||null,signature_mode:sigMode});
      return new Response('Bad webhook object', { status: 400 });
    }
    let messageCount=0, statusCount=0;
    for (const e of body.entry || []) for (const ch of e.changes || []) {
      const v = ch.value || {};
      for(const s of v.statuses||[]){
        statusCount++;
        if(s.id) await db().execute('UPDATE messages SET delivery_status=? WHERE external_message_id=?',[String(s.status||''),String(s.id)]).catch(()=>{});
      }
      for (const m of v.messages || []) {
        messageCount++;
        try { await handle(m, v.contacts || []); }
        catch (err: any) {
          await agentEvent(null,m?.id||null,'webhook_message_error','failed',err?.response?.data||err?.message||String(err));
          console.error('WHATSAPP_MESSAGE_ERROR', err?.response?.data || err);
        }
      }
    }
    await agentEvent(null,null,'webhook_received','ok',{messages:messageCount,statuses:statusCount,signature_mode:sigMode});
  } catch (err:any) {
    await agentEvent(null,null,'webhook_parse_error','failed',err?.message||String(err));
    console.error('WHATSAPP_WEBHOOK', err);
  }
  return new Response('EVENT_RECEIVED');
}
