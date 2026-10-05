/*
  Reply engine core (no database, no network: everything comes in through `deps`).
  Production deps are MySQL/Meta (src/lib/sales-engine.ts); tests use an in-memory store with the same
  atomic semantics, so retries, parallel workers and the welcome-once rule are tested for real.
*/
import { decideReply, wordsFromStored, type BurstMsg } from './reply-policy';
import { askedForGroup, askedForWebsite, detectLanguage, stripPromoLinks, withWelcome, type Lang, type WelcomeConfig } from './welcome';

export type Trigger = 'webhook' | 'catch_up' | 'manual' | 'sweep';
export type Conv = { id: number; channel: string; external_user_id: string; mode: string; customer_id: number | null };
export type BurstRow = { id: number; message_type: string; body: string; external_message_id?: string | null };
export type ComposeIn = { conversationId: number; burst: BurstRow[]; words: string; firstContact: boolean; welcomeDue: boolean; welcomeSent: boolean; referral: boolean };
export type ComposeOut = { text: string; lang?: Lang; model?: string | null; vehicleId?: number | null; photoPlan?: any; needsStaff?: string | null; facts?: any; notes?: string[] };

export type EngineDeps = {
  sleep(ms: number): Promise<void>;
  loadConversation(id: number): Promise<Conv | null>;
  tryLock(id: number): Promise<string | null>;
  unlock(id: number, token: string): Promise<void>;
  getState(id: number): Promise<{ answered_through_id: number; ai_paused_until: number | null }>;
  lastAnsweredOutboundId(id: number): Promise<number>;
  burst(id: number, afterId: number): Promise<BurstRow[]>;
  referralIds(ids: number[]): Promise<Set<number>>;
  isFirstContact(conv: Conv, firstBurstId: number): Promise<boolean>;
  lastOutboundBody(id: number, beforeId: number): Promise<string | null>;
  hasNewerCustomerMessage(id: number, afterId: number): Promise<boolean>;
  markAnswered(id: number, throughId: number): Promise<void>;
  channelReady(conv: Conv): boolean;
  welcomeConfig(): Promise<WelcomeConfig>;
  welcomeAlreadySent(key: string): Promise<boolean>;
  claimWelcome(key: string, customerId: number | null, conversationId: number): Promise<boolean>;
  releaseWelcome(key: string): Promise<void>;
  compose(i: ComposeIn): Promise<ComposeOut>;
  sendText(conv: Conv, text: string): Promise<string | null>;
  storeOutbound(id: number, text: string, o: { externalId?: string | null; status?: string; model?: string | null }): Promise<void>;
  sendPhotos(conv: Conv, id: number, plan: any): Promise<void>;
  flagStaff(id: number, reason: string): Promise<void>;
  event(id: number | null, extId: string | null, type: string, status: string, details?: any): Promise<void>;
  now(): number;
};

export type EngineResult = { status: 'sent' | 'skipped' | 'failed'; reason?: string; reply?: string; welcome?: boolean; composed?: ComposeOut };

export const BURST_WAIT_MS = 3000;

/** Stable key per person: WhatsApp phone digits, or the Messenger id. */
export function customerKey(channel: string, externalUserId: string) {
  const id = String(externalUserId || '').trim();
  return channel === 'facebook' ? `fb:${id}` : `p:${id.replace(/\D/g, '')}`;
}

export async function runEngine(deps: EngineDeps, conversationId: number, opts: { trigger: Trigger; force?: boolean; burstWaitMs?: number }): Promise<EngineResult> {
  const conv = await deps.loadConversation(conversationId);
  if (!conv || !['whatsapp', 'facebook'].includes(conv.channel)) return { status: 'skipped', reason: 'not_a_chat' };
  let token: string | null = null;
  // Another worker holding this chat answers everything it sees; wait briefly, then leave it to them.
  for (let i = 0; i < 10 && !token; i++) { token = await deps.tryLock(conversationId); if (!token) await deps.sleep(1000); }
  if (!token) { await deps.event(conversationId, null, 'reply', 'ignored', { reason: 'another_worker_is_replying', trigger: opts.trigger }); return { status: 'skipped', reason: 'locked' }; }
  let result: EngineResult = { status: 'skipped', reason: 'nothing_new' };
  try {
    if (opts.trigger === 'webhook') await deps.sleep(opts.burstWaitMs ?? BURST_WAIT_MS); // merge rapid messages
    for (let round = 0; round < 3; round++) {
      const fresh = await deps.loadConversation(conversationId);
      if (fresh?.mode !== 'ai') { result = { status: 'skipped', reason: 'human_mode' }; break; }
      const state = await deps.getState(conversationId);
      const paused = state.ai_paused_until && state.ai_paused_until > deps.now();
      if (paused && opts.trigger !== 'manual') { result = { status: 'skipped', reason: 'ai_paused' }; break; }
      let afterId = state.answered_through_id;
      if (opts.force) afterId = Math.min(afterId, await deps.lastAnsweredOutboundId(conversationId));
      const burst = await deps.burst(conversationId, afterId);
      if (!burst.length) { result = { status: 'skipped', reason: 'nothing_new' }; break; }
      const lastId = Number(burst[burst.length - 1].id);
      const lastExt = burst[burst.length - 1].external_message_id || null;
      const refIds = await deps.referralIds(burst.map(b => Number(b.id)));
      const msgs: BurstMsg[] = burst.map(b => ({ type: b.message_type, words: wordsFromStored(b.message_type, b.body), referral: refIds.has(Number(b.id)) }));
      const firstContact = await deps.isFirstContact(conv, Number(burst[0].id));
      const lastOut = await deps.lastOutboundBody(conversationId, Number(burst[0].id));
      const decision = opts.force ? { reply: true, reason: 'manual' } : decideReply({ burst: msgs, firstContact, lastOutbound: lastOut, recipient: conv.external_user_id });
      if (!decision.reply) {
        await deps.markAnswered(conversationId, lastId);
        await deps.event(conversationId, lastExt, 'reply', 'ignored', { reason: decision.reason });
        result = { status: 'skipped', reason: decision.reason };
        break;
      }
      if (!deps.channelReady(conv)) { await deps.event(conversationId, null, 'reply', 'skipped', 'Sending needs setup (see Readiness)'); result = { status: 'skipped', reason: 'not_configured' }; break; }

      const words = msgs.map(m => m.words).filter(Boolean).join('\n');
      const key = customerKey(conv.channel, conv.external_user_id);
      const wcfg = await deps.welcomeConfig();
      const welcomeDue = wcfg.enabled && !(await deps.welcomeAlreadySent(key));
      const composed = await deps.compose({ conversationId, burst, words, firstContact, welcomeDue, welcomeSent: !welcomeDue, referral: msgs.some(m => m.referral) });

      // More messages arrived while composing: answer them together in the next round.
      if (round < 2 && await deps.hasNewerCustomerMessage(conversationId, lastId)) continue;
      const now = await deps.loadConversation(conversationId);
      if (now?.mode !== 'ai') { result = { status: 'skipped', reason: 'staff_took_over' }; break; }
      const st = await deps.getState(conversationId);
      if (st.answered_through_id >= lastId && !opts.force) { result = { status: 'skipped', reason: 'already_answered' }; break; }
      if (st.ai_paused_until && st.ai_paused_until > deps.now() && opts.trigger !== 'manual') { result = { status: 'skipped', reason: 'staff_replied' }; break; }

      // Code-level link filter on every AI reply (staff messages never pass here).
      let text = stripPromoLinks(composed.text, { site: wcfg.site, allowSite: askedForWebsite(words), allowGroup: askedForGroup(words) });
      let welcome = false;
      // Atomic claim BEFORE sending: only one caller can ever add the welcome for this person.
      if (welcomeDue && await deps.claimWelcome(key, conv.customer_id, conversationId)) {
        welcome = true;
        text = withWelcome(text, composed.lang || detectLanguage(words), wcfg);
      }
      if (composed.needsStaff) await deps.flagStaff(conversationId, composed.needsStaff);
      if (!text.trim()) { await deps.markAnswered(conversationId, lastId); result = { status: 'skipped', reason: 'empty_reply' }; break; }

      await deps.markAnswered(conversationId, lastId); // before sending: a crash or timeout can never cause a second send
      try {
        const extId = await deps.sendText(conv, text);
        await deps.storeOutbound(conversationId, text, { externalId: extId, model: composed.model || null });
        await deps.event(conversationId, lastExt, 'reply', 'ok', { trigger: opts.trigger, reason: decision.reason, merged: burst.length, welcome, vehicle_id: composed.vehicleId || null });
        if (composed.photoPlan) await deps.sendPhotos(conv, conversationId, composed.photoPlan);
        result = { status: 'sent', reason: decision.reason, reply: text, welcome, composed };
      } catch (e: any) {
        const detail = e?.response?.data?.error || e?.response?.data || e?.message || String(e);
        await deps.storeOutbound(conversationId, text, { status: 'failed', model: composed.model || null }).catch(() => {});
        // Delivery failed: release the welcome claim so the one-time welcome is never burned
        // for a message the customer never received (it will ride the next successful reply).
        if (welcome) await deps.releaseWelcome(key).catch(() => {});
        await deps.event(conversationId, lastExt, 'reply', 'failed', { trigger: opts.trigger, error: detail });
        result = { status: 'failed', reason: typeof detail === 'string' ? detail : JSON.stringify(detail).slice(0, 300), welcome };
      }
      break;
    }
  } catch (e: any) {
    await deps.event(conversationId, null, 'reply', 'failed', { trigger: opts.trigger, error: e?.message || String(e) }).catch(() => {});
    result = { status: 'failed', reason: e?.message || 'error' };
  } finally {
    await deps.unlock(conversationId, token).catch(() => {});
  }
  // A message that arrived after our last check but before unlock: answer it now.
  if (opts.trigger === 'webhook' && result.status !== 'failed') {
    const st = await deps.getState(conversationId).catch(() => null);
    if (st && await deps.hasNewerCustomerMessage(conversationId, st.answered_through_id).catch(() => false)) return runEngine(deps, conversationId, { trigger: 'sweep' });
  }
  return result;
}
