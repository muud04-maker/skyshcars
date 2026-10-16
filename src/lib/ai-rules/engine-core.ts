/*
  Reply engine core (no database, no network: everything comes in through `deps`).
  Production deps are MySQL/Meta (src/lib/sales-engine.ts); tests use an in-memory store with the same
  atomic semantics, so retries, parallel workers and the welcome-once rule are tested for real.
*/
import { decideReply, wordsFromStored, type BurstMsg } from './reply-policy';
import { askedForGroup, askedForWebsite, detectLanguage, stripPromoLinks, withWelcome, type Lang, type WelcomeConfig } from './welcome';
import { withBlock, welcomeBlock } from './welcome';
import { stripInventedHistory } from './reply-guard';
import { enforcePhotoHonesty, needsStaffPhotoRequest } from './photo-guard';
import { holdingLine, isHolding } from './hold';
import { applyStaffOverride } from './staff-override';

export type Trigger = 'webhook' | 'catch_up' | 'manual' | 'sweep';
export type Conv = { id: number; channel: string; external_user_id: string; mode: string; customer_id: number | null };
export type BurstRow = { id: number; message_type: string; body: string; external_message_id?: string | null };
export type ResolvedReferral = { vehicle: any; aiEnabled: boolean; method: string };
export type ComposeIn = {
  conversationId: number; burst: BurstRow[]; words: string; firstContact: boolean;
  welcomeDue: boolean; welcomeSent: boolean; referral: boolean;
  referralVehicle?: any; referralAiEnabled?: boolean;
};
export type ComposeOut = { text: string; lang?: string; model?: string | null; vehicleId?: number | null; photoPlan?: any; needsStaff?: string | null; facts?: any; notes?: string[]; allowedNames?: string[] };

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
  resolveReferral(conv: Conv, burst: BurstRow[]): Promise<ResolvedReferral | null>;
  setCurrentCar(conversationId: number, vehicleId: number, source: string): Promise<void>;
  /** Pause the AI after a holding reply so it waits for the owner instead of guessing. */
  holdForStaff(conversationId: number): Promise<void>;
  /** The last thing a colleague said in this chat (used to stop the AI contradicting staff). */
  lastStaffBody(conversationId: number): Promise<string | null>;
  /** Optional: a hold line / welcome block generated for an arbitrary customer language. */
  holdText?(lang: string): Promise<string>;
  welcomeBlockText?(lang: string): Promise<string>;
  /** Latest customer vs latest person/AI outbound message ids (turn-based safety). */
  turnState?(conversationId: number): Promise<{ lastInboundId: number; lastOutboundId: number; lastInboundAtMs?: number; lastStaffAtMs?: number }>;
  welcomeConfig(): Promise<WelcomeConfig>;
  welcomeAlreadySent(key: string): Promise<boolean>;
  claimWelcome(key: string, customerId: number | null, conversationId: number): Promise<boolean>;
  releaseWelcome(key: string): Promise<void>;
  compose(i: ComposeIn): Promise<ComposeOut>;
  sendText(conv: Conv, text: string): Promise<string | null>;
  storeOutbound(id: number, text: string, o: { externalId?: string | null; status?: string; model?: string | null; error?: string | null }): Promise<void>;
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
      // AI answers in 'ai' and 'both'. TAKE OVER ('human') and 'paused' stay silent.
      if (!['ai', 'both'].includes(String(fresh?.mode || 'ai'))) { result = { status: 'skipped', reason: 'human_mode' }; break; }
      // Turn state is read once per round: it decides both the staff-silence rule and whether a
      // staff PAUSE still applies (a pause only silences the turn the human answered).
      const turn = (!opts.force && deps.turnState) ? await deps.turnState(conversationId).catch(() => null) : null;
      const state = await deps.getState(conversationId);
      const paused = state.ai_paused_until && state.ai_paused_until > deps.now();
      if (paused && opts.trigger !== 'manual') {
        const customerSpokeAfterStaff = !!(turn && turn.lastInboundAtMs && (!turn.lastStaffAtMs || turn.lastInboundAtMs > turn.lastStaffAtMs));
        if (!customerSpokeAfterStaff) { result = { status: 'skipped', reason: 'ai_paused' }; break; }
      }
      let afterId = state.answered_through_id;
      if (opts.force) afterId = Math.min(afterId, await deps.lastAnsweredOutboundId(conversationId));
      const burst = await deps.burst(conversationId, afterId);
      if (!burst.length) { result = { status: 'skipped', reason: 'nothing_new' }; break; }
      // Turn-based safety: the AI may only speak when the latest CUSTOMER message is newer than the
      // latest outbound (AI or human). A staff reply therefore silences the AI until the customer
      // writes again - no timer ever reactivates it. "AI Reply Now" (force) is the explicit override.
      if (!opts.force && turn) {
        if (turn.lastOutboundId > turn.lastInboundId) {
          await deps.markAnswered(conversationId, turn.lastInboundId).catch(() => {});
          await deps.event(conversationId, null, 'reply', 'ignored', { reason: 'waiting_for_customer', trigger: opts.trigger });
          result = { status: 'skipped', reason: 'waiting_for_customer' };
          break;
        }
      }
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
      const hasReferral = msgs.some(m => m.referral);
      // Part 3: resolve the exact Facebook post/ad the customer tapped and remember it as the current car.
      let referral: ResolvedReferral | null = null;
      if (hasReferral) {
        referral = await deps.resolveReferral(conv, burst).catch(() => null);
        if (referral?.vehicle?.id) await deps.setCurrentCar(conversationId, Number(referral.vehicle.id), referral.method).catch(() => {});
        await deps.event(conversationId, burst[0].external_message_id || null,
          referral?.vehicle ? 'referral_matched' : 'referral_unmatched', 'ok',
          { method: referral?.method || 'none', vehicle_id: referral?.vehicle?.id || null }).catch(() => {});
      }
      const key = customerKey(conv.channel, conv.external_user_id);
      const wcfg = await deps.welcomeConfig();
      const welcomeDue = wcfg.enabled && !(await deps.welcomeAlreadySent(key));
      const composed = await deps.compose({ conversationId, burst, words, firstContact, welcomeDue, welcomeSent: !welcomeDue,
        referral: hasReferral, referralVehicle: referral?.vehicle || null, referralAiEnabled: referral ? referral.aiEnabled : false });

      // More messages arrived while composing: answer them together in the next round.
      if (round < 2 && await deps.hasNewerCustomerMessage(conversationId, lastId)) continue;
      const now = await deps.loadConversation(conversationId);
      if (!['ai', 'both'].includes(String(now?.mode || 'ai'))) { result = { status: 'skipped', reason: 'staff_took_over' }; break; }
      const st = await deps.getState(conversationId);
      if (st.answered_through_id >= lastId && !opts.force) { result = { status: 'skipped', reason: 'already_answered' }; break; }
      if (st.ai_paused_until && st.ai_paused_until > deps.now() && opts.trigger !== 'manual') {
        // Same rule as above: a staff pause only silences the turn the human already answered.
        const spokeAfterStaff = !!(turn && turn.lastInboundAtMs && (!turn.lastStaffAtMs || turn.lastInboundAtMs > turn.lastStaffAtMs));
        if (!spokeAfterStaff) { result = { status: 'skipped', reason: 'staff_replied' }; break; }
      }

      let welcome = false;
      let text: string;
      if (composed.needsStaff) {
        // No verified answer: flag the chat for staff, send ONE short holding line, then WAIT for the owner.
        await deps.flagStaff(conversationId, composed.needsStaff);
        await deps.holdForStaff(conversationId).catch(() => {});
        const lastOut = await deps.lastOutboundBody(conversationId, Number.MAX_SAFE_INTEGER).catch(() => null);
        if (isHolding(lastOut)) {
          // Never repeat the holding message.
          await deps.markAnswered(conversationId, lastId);
          await deps.event(conversationId, lastExt, 'reply', 'ignored', { reason: 'holding_already_sent' });
          result = { status: 'skipped', reason: 'holding_already_sent' };
          break;
        }
        const holdLang = composed.lang || detectLanguage(words);
        text = deps.holdText ? await deps.holdText(holdLang).catch(() => holdingLine(holdLang)) : holdingLine(holdLang);
      } else {
        // Code-level link filter on every AI reply (staff messages never pass here).
        text = stripPromoLinks(composed.text, { site: wcfg.site, allowSite: askedForWebsite(words), allowGroup: askedForGroup(words) });
        // Never let the AI invent a car the customer "was looking at" (failure E).
        text = stripInventedHistory(text, composed.allowedNames || []);
        /*
          Phase 4: never promise photos that will not arrive. Production evidence showed 2 of 5
          delivered photo promises with no photo at all, so this is enforced in code, not in the
          prompt. When there are no exact photos, the customer is told honestly AND staff get a
          tracked request so the real photos can be fetched from the yard.
        */
        const photoGuard = enforcePhotoHonesty(text, composed.photoPlan);
        text = photoGuard.text;
        if (photoGuard.changed !== 'none') {
          await deps.event(conversationId, lastExt, 'photo_promise_guarded', 'ok', {
            plan_status: composed.photoPlan?.status || null, action: photoGuard.changed, stock_no: composed.photoPlan?.stockNo || null,
          }).catch(() => {});
        }
        if (needsStaffPhotoRequest(composed.photoPlan)) {
          await deps.flagStaff(conversationId, `photo request: no exact photos for ${composed.photoPlan?.stockNo || composed.photoPlan?.title || 'that vehicle'}`).catch(() => {});
          await deps.event(conversationId, lastExt, 'photo_request', 'needs_staff', { stock_no: composed.photoPlan?.stockNo || null }).catch(() => {});
        }
        // A colleague already told the customer this car is sold / not available: never contradict them.
        const staffText = deps.lastStaffBody ? await deps.lastStaffBody(conversationId).catch(() => null) : null;
        text = applyStaffOverride(text, staffText);
      }
      // The FIRST reply of a new customer always carries the website + WhatsApp-group invitation -
      // a normal answer AND a holding reply. Claimed atomically BEFORE sending, so webhook retries
      // and parallel workers can never send the welcome twice.
      if (welcomeDue && await deps.claimWelcome(key, conv.customer_id, conversationId)) {
        welcome = true;
        const lang = composed.lang || detectLanguage(words);
        const block = deps.welcomeBlockText ? await deps.welcomeBlockText(lang).catch(() => welcomeBlock(lang as Lang, wcfg)) : welcomeBlock(lang as Lang, wcfg);
        text = withBlock(text, block);
      }
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
        await deps.storeOutbound(conversationId, text, { status: 'failed', model: composed.model || null, error: typeof detail === 'string' ? detail : JSON.stringify(detail).slice(0, 300) }).catch(() => {});
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
