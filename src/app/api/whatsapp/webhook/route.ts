import { inbound, outbound, alreadyProcessed } from '../../../../lib/conversations';
import { salesReply, AI_MODEL } from '../../../../lib/ai';
import { planPhotos, sendPlannedPhotos } from '../../../../lib/whatsapp-photos';
import { checkSignature, sendWhatsApp, whatsappConfigured, downloadWhatsAppMedia, whatsappVerifyToken } from '../../../../lib/meta';
import { db, dbConfigured } from '../../../../lib/db';
import { transcribeAudio, describeImage, mediaAiConfigured } from '../../../../lib/media-ai';
import { agentEvent } from '../../../../lib/agent-events';
import { claimReply, markReplySent, markReplyFailed, markReplySkipped } from '../../../../lib/reply-guard';
import { isGroupRecipient, needsReply } from '../../../../lib/intent';

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
      if(!mediaAiConfigured()) throw new Error('Media understanding needs setup (see Readiness)');
      const transcript=await transcribeAudio(media.data,media.mimeType);
      if(!transcript) throw new Error('Voice transcription returned empty text');
      const body=`VOICE NOTE\nTranscript: ${transcript}`;
      await updateInboundBody(m.id,body);
      await agentEvent(c.id,m.id,'voice_transcription','ok',{chars:transcript.length});
      return {...d,storedText:body,aiText:`Customer sent a voice note. Transcript: ${transcript}`,needsHuman:false};
    }
    if(m.type==='image' && !d.aiText){
      if(!mediaAiConfigured()) throw new Error('Media understanding needs setup (see Readiness)');
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

const STALE_MESSAGE_SECONDS = 24 * 60 * 60; // Meta's customer-service window; never auto-reply to older deliveries

/** True when the customer has already sent a newer text message; that message's reply will cover both (no burst spam). */
async function supersededByNewer(conversationId:number, externalMessageId:string){
  const [r]:any=await db().execute(`SELECT 1 FROM messages n WHERE n.conversation_id=? AND n.sender='customer' AND n.direction='inbound' AND n.message_type='text'
    AND n.id > (SELECT MIN(x.id) FROM messages x WHERE x.external_message_id=?) LIMIT 1`,[conversationId,externalMessageId]);
  return !!r?.length;
}

/** The customer's own words: text, caption, voice transcript or button title. Images without a caption have none. */
function customerWords(m: any, d: Described) {
  if (m.type === 'text') return String(m.text?.body || '');
  if (m.type === 'button' || m.type === 'interactive') return 'request: ' + String(d.storedText || ''); // a button press is a request
  if (m.type === 'image') return String(m.image?.caption || '');
  if (m.type === 'video') return String(m.video?.caption || '');
  if (m.type === 'audio') return String(d.storedText || '').replace(/^VOICE NOTE\nTranscript:\s*/, '').replace(/^VOICE NOTE\nTranscription pending\.$/, '');
  return '';
}

async function handle(m: any, contacts: any[]) {
  const from = m.from;
  // Group messages (if Meta ever delivers them) are never answered: the AI never sends anything into a group.
  if (m.group_id || m.context?.group_id || isGroupRecipient(from)) {
    await agentEvent(null,m.id||null,'group_message','ignored',{reason:'never_reply_in_groups'}).catch(()=>{});
    return;
  }
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
  // Reply rule: only answer a question or a request. Thanks / ok / emojis / greetings alone get no reply.
  const lastOut:any=await db().execute(`SELECT body FROM messages WHERE conversation_id=? AND direction='outbound' ORDER BY id DESC LIMIT 1`,[c.id]).then(([r]:any)=>r?.[0]).catch(()=>null);
  if (!needsReply(customerWords(m,d), lastOut?.body)) {
    await agentEvent(c.id,m.id,'reply','ignored',{reason:'no_question_or_request'});
    return;
  }
  if (!whatsappConfigured()) {
    await agentEvent(c.id,m.id,'reply','skipped','WhatsApp sending needs setup (see Readiness)');
    return;
  }
  const sentAt=Number(m.timestamp||0);
  if (sentAt && Date.now()/1000-sentAt>STALE_MESSAGE_SECONDS) {
    await agentEvent(c.id,m.id,'reply','ignored',{reason:'stale_delivery',age_seconds:Math.round(Date.now()/1000-sentAt)});
    return;
  }

  const inboundKey=String(m.id||'').trim();
  const claimed=await claimReply(inboundKey,Number(c.id),'webhook',false);
  if(!claimed){
    await agentEvent(c.id,m.id,'reply','ignored',{reason:'reply_already_claimed'});
    return;
  }
  try{
    const photoPlan = await planPhotos(d.aiText, Number(c.id)).catch(async (e:any)=>{await agentEvent(c.id,m.id,'photo_plan','failed',e?.message||String(e));return null});
    const reply = await salesReply(d.aiText, c.id, photoPlan);
    if (!reply) throw new Error('AI returned no reply');
    // Customer sent another text while we were thinking: let that message's reply answer both.
    if (await supersededByNewer(Number(c.id),inboundKey)) {
      await markReplySkipped(inboundKey,'superseded_by_newer_message');
      await agentEvent(c.id,m.id,'reply','ignored',{reason:'superseded_by_newer_message'});
      return;
    }
    // Admin may have taken over while the AI was generating.
    const [nowMode]:any=await db().execute('SELECT mode FROM conversations WHERE id=? LIMIT 1',[c.id]);
    if (nowMode?.[0]?.mode !== 'ai') {
      await markReplySkipped(inboundKey,'admin_takeover');
      await agentEvent(c.id,m.id,'reply','ignored',{reason:'admin_takeover_during_generation'});
      return;
    }
    const waId=await sendWhatsApp(from, reply);
    // Mark sent immediately after Meta accepts the message, before any secondary DB work.
    // This makes webhook retries safe even if a later database insert fails.
    await markReplySent(inboundKey,waId);
    await outbound(c.id, 'ai', reply, AI_MODEL);
    await agentEvent(c.id,m.id,'reply','ok',{whatsapp_message_id:waId,chars:reply.length,photo_plan:photoPlan?.status||null});
    await sendPlannedPhotos(from,Number(c.id),photoPlan);
  }catch(e:any){
    const detail=e?.response?.data||e?.message||String(e);
    await markReplyFailed(inboundKey,detail).catch(()=>{});
    await agentEvent(c.id,m.id,'reply','failed',detail);
    console.error('WHATSAPP_REPLY_ERROR',detail);
  }
}

export async function POST(req: Request) {
  const raw = await req.text();
  const sig = checkSignature(raw, req.headers.get('x-hub-signature-256'));
  const sigMode = sig.mode;
  if (!sig.accept) {
    if (dbConfigured()) await agentEvent(null,null,'webhook_rejected','failed',{reason:'bad_signature',signature_mode:sigMode}).catch(()=>{});
    return new Response('Bad signature', { status: 401 });
  }
  // Monitor mode: signature is checked but not enforced; mismatches are recorded so Readiness can show them.
  if (sigMode === 'monitor' && sig.valid === false && dbConfigured()) await agentEvent(null,null,'signature_mismatch','warning',{signature_mode:sigMode}).catch(()=>{});
  if (!dbConfigured()) { console.error('WHATSAPP_WEBHOOK: database not configured'); return new Response('EVENT_RECEIVED'); }
  try {
    const body = JSON.parse(raw);
    // When the app secret is not configured, only accept the exact object type Meta
    // sends for WhatsApp Cloud API. This is compatibility mode, not a substitute for
    // adding WHATSAPP_APP_SECRET.
    if (sig.valid !== true && body?.object !== 'whatsapp_business_account') {
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
