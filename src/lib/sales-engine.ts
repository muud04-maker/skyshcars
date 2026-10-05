/*
  Production wiring of the ONE reply path (logic: ai-rules/engine-core.ts).
  Every trigger uses it: WhatsApp webhook, Messenger webhook, return-to-AI catch-up, "AI reply now",
  the pause sweeper. Lock, burst merge, answered marker, reply rule, welcome-once and link filter live in the core.
*/
import axios from 'axios';
import { one, rows } from './db';
import { outbound } from './conversations';
import { agentEvent } from './agent-events';
import { sendWhatsApp, whatsappConfigured } from './meta';
import { flagForStaff, getState, markAnswered, setCurrentCar, tryLock, unlock } from './conversation-state';
import { resolveForBurst } from './referrals';
import { runEngine, type EngineDeps, type EngineResult, type Trigger } from './ai-rules/engine-core';
import { claimWelcome, releaseWelcome, welcomeAlreadySent, welcomeConfig } from './welcome';
import { composeReply } from './sales-compose';
import { sendPlannedPhotos } from './whatsapp-photos';

export type { EngineResult, Trigger };
const STALE_HOURS = 24; // WhatsApp customer-service window

const deps: EngineDeps = {
  sleep: ms => new Promise(r => setTimeout(r, ms)),
  now: () => Date.now(),
  loadConversation: async id => {
    const c = await one<any>(`SELECT id,channel,external_user_id,mode,customer_id FROM conversations WHERE id=? LIMIT 1`, [id]);
    return c ? { id: Number(c.id), channel: c.channel, external_user_id: String(c.external_user_id || ''), mode: c.mode, customer_id: c.customer_id ? Number(c.customer_id) : null } : null;
  },
  tryLock: id => tryLock(id),
  unlock: (id, t) => unlock(id, t),
  getState: async id => { const s = await getState(id); return { answered_through_id: s.answered_through_id, ai_paused_until: s.ai_paused_until ? s.ai_paused_until.getTime() : null }; },
  lastAnsweredOutboundId: async id => Number((await one<any>(`SELECT MAX(id) id FROM messages WHERE conversation_id=? AND direction='outbound' AND sender IN ('ai','human')`, [id]))?.id || 0),
  burst: async (id, afterId) => (await rows<any>(`SELECT id,message_type,body,external_message_id FROM messages
      WHERE conversation_id=? AND sender='customer' AND direction='inbound' AND id>? AND created_at >= (NOW() - INTERVAL ${STALE_HOURS} HOUR)
      ORDER BY id ASC LIMIT 20`, [id, afterId])).map(r => ({ ...r, id: Number(r.id) })),
  referralIds: async ids => {
    if (!ids.length) return new Set<number>();
    try { return new Set((await rows<any>(`SELECT message_id FROM chat_referrals WHERE message_id IN (${ids.map(() => '?').join(',')})`, ids)).map(x => Number(x.message_id))); }
    catch { return new Set<number>(); }
  },
  isFirstContact: async (conv, firstId) => {
    const r = conv.customer_id
      ? await one<any>(`SELECT COUNT(*) n FROM messages m JOIN conversations c ON c.id=m.conversation_id WHERE c.customer_id=? AND m.direction='inbound' AND m.id<?`, [conv.customer_id, firstId])
      : await one<any>(`SELECT COUNT(*) n FROM messages WHERE conversation_id=? AND direction='inbound' AND id<?`, [conv.id, firstId]);
    return Number(r?.n || 0) === 0;
  },
  lastOutboundBody: async (id, beforeId) => (await one<any>(`SELECT body FROM messages WHERE conversation_id=? AND direction='outbound' AND sender IN ('ai','human') AND id<? ORDER BY id DESC LIMIT 1`, [id, beforeId]))?.body || null,
  hasNewerCustomerMessage: async (id, afterId) => !!(await one<any>(`SELECT id FROM messages WHERE conversation_id=? AND sender='customer' AND direction='inbound' AND id>? AND created_at >= (NOW() - INTERVAL ${STALE_HOURS} HOUR) LIMIT 1`, [id, afterId])),
  markAnswered: (id, through) => markAnswered(id, through),
  channelReady: conv => conv.channel === 'whatsapp' ? whatsappConfigured() : conv.channel === 'facebook',
  resolveReferral: (conv, burst) => resolveForBurst({ id: conv.id, channel: conv.channel }, burst.map(b => Number(b.id))),
  setCurrentCar: (id, vehicleId, source) => setCurrentCar(id, vehicleId, source),
  welcomeConfig: () => welcomeConfig(),
  welcomeAlreadySent: key => welcomeAlreadySent(key),
  claimWelcome: (key, cid, convId) => claimWelcome(key, cid, convId),
  releaseWelcome: key => releaseWelcome(key),
  compose: i => composeReply(i),
  sendText: async (conv, text) => {
    if (conv.channel === 'whatsapp') return sendWhatsApp(conv.external_user_id, text);
    const { GRAPH, facebookConfigured, resolvePageToken } = await import('./facebook');
    if (!facebookConfigured()) throw new Error('Messenger sending needs setup (see Readiness)');
    const token = await resolvePageToken();
    const r = await axios.post(`${GRAPH}/me/messages`, { recipient: { id: conv.external_user_id }, messaging_type: 'RESPONSE', message: { text: text.slice(0, 2000) } }, { params: { access_token: token }, timeout: 20000 });
    return r.data?.message_id || null;
  },
  storeOutbound: (id, text, o) => outbound(id, 'ai', text, o.model || undefined, { externalId: o.externalId || null, status: o.status || null, error: o.error || null }),
  sendPhotos: async (conv, id, plan) => { if (conv.channel === 'whatsapp') await sendPlannedPhotos(conv.external_user_id, id, plan); },
  flagStaff: (id, reason) => flagForStaff(id, reason),
  event: (id, ext, type, status, details) => agentEvent(id, ext, type, status, details).catch(() => {}) as any,
};

/** Produce and send at most one reply for the unanswered customer burst of this chat. */
export function runReplyEngine(conversationId: number, opts: { trigger: Trigger; force?: boolean } = { trigger: 'webhook' }): Promise<EngineResult> {
  return runEngine(deps, conversationId, opts);
}

/** Called from webhooks: never throws. */
export function scheduleReply(conversationId: number, trigger: Trigger = 'webhook') {
  return runReplyEngine(conversationId, { trigger }).catch(e => { console.error('REPLY_ENGINE', e); return { status: 'failed' } as EngineResult; });
}

/**
 * Part 6: after a staff pause expires, let the AI answer a customer who is still waiting.
 * Run from the automation cron so the AI returns by itself without waiting for a new message.
 */
export async function sweepDuePauses(limit = 25) {
  const due = await rows<any>(`SELECT c.id FROM conversations c
    JOIN conversation_state s ON s.conversation_id=c.id
    WHERE c.mode='ai' AND s.ai_paused_until IS NOT NULL AND s.ai_paused_until <= NOW()
      AND EXISTS (SELECT 1 FROM messages m WHERE m.conversation_id=c.id AND m.sender='customer' AND m.direction='inbound' AND m.id > s.answered_through_id)
    ORDER BY s.ai_paused_until ASC LIMIT ${Math.max(1, Math.min(100, limit))}`).catch(() => []);
  const results: any[] = [];
  for (const r of due) results.push({ conversation_id: Number(r.id), result: await runReplyEngine(Number(r.id), { trigger: 'sweep' }).catch(e => ({ status: 'failed', reason: String(e) })) });
  return results;
}
