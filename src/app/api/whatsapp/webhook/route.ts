import { after } from 'next/server';
import { inbound, alreadyProcessed } from '../../../../lib/conversations';
import { checkSignature, downloadWhatsAppMedia, whatsappVerifyToken } from '../../../../lib/meta';
import { db, one, dbConfigured } from '../../../../lib/db';
import { transcribeAudio, describeImage, mediaAiConfigured } from '../../../../lib/media-ai';
import { agentEvent } from '../../../../lib/agent-events';
import { scheduleReply } from '../../../../lib/sales-engine';
import { clearAiReply, clearStaffFlag, ensureConversationState, flagForStaff, pauseAi, scheduleAiReply } from '../../../../lib/conversation-state';
import { REPLY_DEBOUNCE_SECONDS } from '../../../../lib/ai-rules/ai-queue';
import { processDueAiReplies } from '../../../../lib/ai-queue-worker';
import { storeReferral } from '../../../../lib/referrals';
import { staffPauseMinutes } from '../../../../lib/staff';
import { isStaffEcho, looksLikeBusinessEcho } from '../../../../lib/ai-rules/staff';
import { isPlaceholderBody, mapMessageType, parseStaffEcho } from '../../../../lib/ai-rules/staff-echo';
import { isGroupRecipient } from '../../../../lib/intent';

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

/** Our own phone numbers, used to recognise staff replies echoed back by Meta. */
function ownWhatsAppNumbers() {
  return [process.env.WHATSAPP_PHONE_NUMBER_ID, process.env.WHATSAPP_DISPLAY_PHONE, process.env.WHATSAPP_BUSINESS_NUMBER].filter(Boolean) as string[];
}

/**
 * Part 6: a message staff sent from the WhatsApp app, echoed back by Meta (message_echoes).
 * Stored as a [STAFF] message, never answered, and the AI is paused so it does not talk over them.
 */
async function handleEcho(m: any) {
  const id = String(m?.id || '').trim();
  const customer = String(m?.to || '').trim();
  if (!id || !customer) return 0;
  const parsed = parseStaffEcho(m);

  // Find the chat: exact number first, then a digits-only match (Meta sometimes formats differently).
  let c: any = await one<any>('SELECT id FROM conversations WHERE channel=? AND external_user_id=? LIMIT 1', ['whatsapp', customer]).catch(() => null);
  if (!c?.id) {
    const digits = customer.replace(/\D/g, '');
    if (digits) c = await one<any>(`SELECT id FROM conversations WHERE channel='whatsapp'
      AND REPLACE(REPLACE(REPLACE(external_user_id,'+',''),' ',''),'-','')=? LIMIT 1`, [digits]).catch(() => null);
  }
  if (!c?.id) {
    await agentEvent(null, id, 'staff_echo', 'ignored', { reason: 'no_conversation', type: parsed.type, has_text: parsed.hasText });
    return 0;
  }

  // Never duplicate or reclassify: an echo of a message we already stored (AI or admin) stays as it is.
  const existing: any = await one<any>('SELECT id,sender,body,message_type FROM messages WHERE external_message_id=? LIMIT 1', [id]).catch(() => null);
  let action = 'inserted';
  if (existing?.id) {
    action = 'ignored_duplicate';
    if (parsed.hasText && isPlaceholderBody(existing.body)) {
      await db().execute('UPDATE messages SET body=?,message_type=? WHERE id=?', [parsed.body, mapMessageType(parsed.type), existing.id]).catch(() => {});
      action = 'reconciled';
    }
  } else {
    const [r]: any = await db().execute('INSERT IGNORE INTO messages(conversation_id,external_message_id,sender,direction,message_type,body,media_url) VALUES(?,?,?,?,?,?,?)',
      [c.id, id, 'human', 'outbound', mapMessageType(parsed.type), parsed.body, parsed.mediaId ? `meta:${parsed.mediaId}` : null]).catch(() => null);
    if (!r || Number(r.affectedRows) === 0) action = 'ignored_duplicate';
  }

  // A real staff reply clears the waiting/flag state and pauses the AI so it does not talk over them.
  await db().execute('UPDATE conversations SET last_message_at=NOW() WHERE id=?', [c.id]).catch(() => {});
  await clearStaffFlag(Number(c.id)).catch(() => {});
  const minutes = await staffPauseMinutes().catch(() => 15);
  await pauseAi(Number(c.id), minutes, 'staff').catch(() => {});
  // Staff replied: cancel any queued AI reply for this chat (staff always wins).
  await clearAiReply(Number(c.id)).catch(() => {});
  await agentEvent(Number(c.id), id, 'staff_echo', 'ok', {
    type: parsed.type, has_text: parsed.hasText, matched_outbound: !!existing?.id, action, minutes, chars: parsed.body.length,
  });
  return action === 'inserted' ? 1 : 0;
}

async function handle(m: any, contacts: any[], referral?: any) {
  const from = m.from;
  // Group messages (if Meta ever delivers them) are never answered: the AI never sends anything into a group.
  if (m.group_id || m.context?.group_id || isGroupRecipient(from)) {
    await agentEvent(null,m.id||null,'group_message','ignored',{reason:'never_reply_in_groups'}).catch(()=>{});
    return;
  }
  let d = describe(m);
  if (!from || !d) return;
  if (await alreadyProcessed(m.id)) {
    // Meta may deliver the same webhook more than once: stored once, answered once.
    await agentEvent(null,m.id,'duplicate_inbound','ignored',{reason:'already_processed'}).catch(()=>{});
    return;
  }
  const name = contacts.find(c => c.wa_id === from)?.profile?.name;
  let c: any;
  try {
    c = await inbound('whatsapp', from, d.storedText, m.id, { type: d.type, name, mediaRef: d.mediaId ? `meta:${d.mediaId}` : undefined });
  } catch (e: any) {
    if (e?.code === 'ER_DUP_ENTRY') { await agentEvent(null,m.id,'duplicate_inbound','ignored',{reason:'parallel_delivery'}).catch(()=>{}); return; }
    throw e;
  }
  await agentEvent(c.id,m.id,'inbound','ok',{type:m.type,mode:c.mode});
  // Part 3: remember which Facebook ad/post the customer tapped so the reply engine can resolve it.
  if (m.referral) await storeReferral({ id: Number(c.id), channel: 'whatsapp' }, String(m.id || ''), m.referral).catch(e=>console.error('REFERRAL',e));

  d=await prepareMedia(m,d,c);
  // Never switch the chat to HUMAN because of a photo, voice note or document: the AI answers or asks,
  // and the chat is flagged so staff can look at it.
  if (d.needsHuman) {
    await flagForStaff(Number(c.id), `${m.type} needs a look (media could not be read automatically)`).catch(()=>{});
    await agentEvent(c.id,m.id,'staff_flag','ok',{reason:`${m.type} could not be read automatically`}).catch(()=>{});
  }
  const sentAt=Number(m.timestamp||0);
  if (sentAt && Date.now()/1000-sentAt>STALE_MESSAGE_SECONDS) {
    await agentEvent(c.id,m.id,'reply','ignored',{reason:'stale_delivery',age_seconds:Math.round(Date.now()/1000-sentAt)});
    return;
  }
  // Normal AI reply: ONE minute after the LATEST customer message. The deadline is durable in MySQL
  // (restarts and parallel webhooks are safe; a newer message pushes it forward and merges the burst).
  await scheduleAiReply(Number(c.id), REPLY_DEBOUNCE_SECONDS, m.id || null).catch((e) => console.error('QUEUE_SCHEDULE', e));
  await agentEvent(c.id, m.id, 'ai_queued', 'ok', { delay_seconds: REPLY_DEBOUNCE_SECONDS });
  /*
    Best-effort accelerator: when this process is still alive a minute from now, the queued reply is
    sent at ~62s instead of waiting for the next cron tick. The once-a-minute cron
    (/api/cron/ai-replies) stays the RELIABLE processor - this timer is never the only path, and the
    deadline it races with lives in MySQL. Overlapping runners are safe: engine lock + answered
    marker + clearing the deadline mean one reply at most.
  */
  if (typeof after === 'function') {
    after(async () => {
      await new Promise((r) => setTimeout(r, REPLY_DEBOUNCE_SECONDS * 1000 + 2000));
      await processDueAiReplies(5).catch((e) => console.error('AI_FIRST_PROCESS', e));
    });
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
    await ensureConversationState().catch(e=>console.error('STATE_SCHEMA',e));
    let messageCount=0, statusCount=0, echoCount=0;
    for (const e of body.entry || []) for (const ch of e.changes || []) {
      const v = ch.value || {};
      for(const s of v.statuses||[]){
        statusCount++;
        if(s.id) await db().execute('UPDATE messages SET delivery_status=?,status_updated_at=NOW() WHERE external_message_id=?',[String(s.status||''),String(s.id)]).catch(()=>{});
      }
      // Part 6: staff replies from the WhatsApp app (Meta echoes them back to us).
      // Meta uses message_echoes (WhatsApp) and smb_message_echoes (WhatsApp Business app) for staff replies.
      for (const echo of [...(v.message_echoes || []), ...(v.smb_message_echoes || [])]) {
        try { echoCount += await handleEcho(echo); } catch (err:any) { console.error('WHATSAPP_ECHO_ERROR', err?.message || err); }
      }
      // Echoes can also arrive as a normal message sent FROM us TO a known customer.
      const contactIds = new Set<string>((v.contacts || []).map((x: any) => String(x?.wa_id || '')));
      for (const m of v.messages || []) {
        if (isStaffEcho(m, ownWhatsAppNumbers()) || looksLikeBusinessEcho(m, contactIds)) {
          try { echoCount += await handleEcho(m); } catch (err:any) { console.error('WHATSAPP_ECHO_ERROR', err?.message || err); }
          continue;
        }
        messageCount++;
        try { await handle(m, v.contacts || []); }
        catch (err: any) {
          await agentEvent(null,m?.id||null,'webhook_message_error','failed',err?.response?.data||err?.message||String(err));
          console.error('WHATSAPP_MESSAGE_ERROR', err?.response?.data || err);
        }
      }
    }
    await agentEvent(null,null,'webhook_received','ok',{messages:messageCount,statuses:statusCount,echoes:echoCount,signature_mode:sigMode});
  } catch (err:any) {
    await agentEvent(null,null,'webhook_parse_error','failed',err?.message||String(err));
    console.error('WHATSAPP_WEBHOOK', err);
  }
  return new Response('EVENT_RECEIVED');
}
