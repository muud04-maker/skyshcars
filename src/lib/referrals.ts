/*
  Facebook / Meta ad & post referrals (Part 3).

  When a customer taps a Facebook vehicle post/ad, Meta sends `message.referral`. We store it and
  resolve it to a stock vehicle, in this order:
    A. a saved staff correction (source_id / source_url -> vehicle_id)
    B. Facebook publish log (social_publish_log.external_id = source_id, status='sent')
    C. strict headline/body match against the AI catalog (ai-rules/match.ts; truncated "... headlines ok)

  The reply engine then knows the exact car, so the AI never asks "which vehicle?" when the
  customer already told us by tapping a post.
*/
import { db, one, rows } from './db';
import { aiCarById, loadReferralInventory, type AiCar } from './ai-catalog';
import { sellableVehicleSql } from './exact-photos';
import { type VehicleLite } from './ai-rules/match';
import { rankReferralCandidates, referralHintFromCandidates, referralLooksMismatched, referralPrice, referralStock, type ReferralHint } from './ai-rules/referral-match';
import { categoryHint, normalize } from './ai-rules/match';
import { lastHumanVehicleSelection } from './vehicle-events';
import { patternHintForTokens } from './sales-patterns';

export type ReferralMethod = 'correction' | 'social_log' | 'url' | 'conversation' | 'human' | 'headline' | 'pattern' | 'none';
/** A unit we recognised but may not be allowed to quote: name/stock/year (+ status) only, never price. */
export type ReferralSummary = VehicleLite & { status?: string | null };
export type ResolvedReferral = {
  vehicle: AiCar | ReferralSummary | null;
  aiEnabled: boolean;
  method: ReferralMethod;
  headline?: string | null;
  body?: string | null;
  sourceUrl?: string | null;
  advertisedPrice?: number | null;
  candidates?: ReferralSummary[];
  hint?: ReferralHint | null;
};

let ready: Promise<void> | null = null;
export function ensureReferralSchema() {
  if (!ready) ready = (async () => {
    await db().execute(`CREATE TABLE IF NOT EXISTS chat_referrals(
      id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      message_id BIGINT UNSIGNED NULL,
      conversation_id BIGINT UNSIGNED NULL,
      channel ENUM('whatsapp','facebook') NOT NULL,
      source_type VARCHAR(60) NULL, source_id VARCHAR(191) NULL, source_url VARCHAR(512) NULL,
      headline VARCHAR(500) NULL, body TEXT NULL, media_url VARCHAR(512) NULL, ctwa_clid VARCHAR(191) NULL,
      matched_vehicle_id BIGINT UNSIGNED NULL, match_method VARCHAR(20) NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      UNIQUE KEY uq_referral_message(message_id),
      INDEX(conversation_id), INDEX(source_id), INDEX(matched_vehicle_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
    await db().execute(`CREATE TABLE IF NOT EXISTS referral_corrections(
      source_key VARCHAR(191) NOT NULL PRIMARY KEY,
      channel ENUM('whatsapp','facebook') NOT NULL,
      source_id VARCHAR(191) NULL, source_url VARCHAR(512) NULL,
      vehicle_id BIGINT UNSIGNED NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX(vehicle_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
  })().catch(e => { ready = null; throw e; });
  return ready;
}

const str = (v: any, n = 500) => { const s = v == null ? '' : String(v).trim(); return s ? s.slice(0, n) : null; };
const channelOf = (c: any) => (c === 'facebook' ? 'facebook' : 'whatsapp');

/** Stable key for a saved correction: prefer the post id, fall back to its URL. */
export function referralSourceKey(channel: string, sourceId?: string | null, sourceUrl?: string | null) {
  const id = str(sourceId, 191); if (id) return `${channelOf(channel)}:id:${id}`;
  const url = str(sourceUrl, 191); if (url) return `${channelOf(channel)}:url:${url}`;
  return null;
}

/** Store the referral a webhook delivered with an inbound message (deduped by message id). */
export async function storeReferral(conv: { id: number; channel: string }, externalMessageId: string | null, ref: any) {
  if (!ref || !conv?.id) return null;
  await ensureReferralSchema();
  let messageId: number | null = null;
  if (externalMessageId) {
    const m = await one<any>('SELECT id FROM messages WHERE external_message_id=? LIMIT 1', [externalMessageId]).catch(() => null);
    messageId = m?.id ? Number(m.id) : null;
  }
  const media = ref.media || {};
  /*
    Meta sends the ad identity in different places depending on the surface (Messenger post
    referral, Click-to-WhatsApp ad, ads_context_data). Read every known field so a motorcycle ad
    is never stored with an empty headline - that is what made the AI answer about another car.
  */
  const ads = ref.ads_context_data || {};
  const sourceId = str(ref.source_id, 191) || str(ads.post_id, 191) || str(ref.post_id, 191) || str(ads.ad_ref, 191) || str(ref.ref, 191);
  const sourceUrl = str(ref.source_url, 512) || str(ref.referer_uri, 512) || str(ads.post_url, 512) || str(ads.ad_url, 512);
  const headline = str(ref.headline, 500) || str(ads.ad_title, 500) || str(ref.title, 500) || str(ads.title, 500) || str(ads.headline, 500);
  const body = str(ref.body, 2000) || str(ads.ad_body, 2000) || str(ads.body, 2000) || str(ads.ad_creative_body, 2000) || str(ads.description, 2000);
  const [r]: any = await db().execute(
    `INSERT IGNORE INTO chat_referrals(message_id,conversation_id,channel,source_type,source_id,source_url,headline,body,media_url,ctwa_clid)
     VALUES(?,?,?,?,?,?,?,?,?,?)`,
    [messageId, conv.id, channelOf(conv.channel), str(ref.source_type || ref.source || ref.type, 60), sourceId, sourceUrl,
     headline, body, str(media.image_url || media.video_url || media.source_url || media.url || ads.photo_url || ads.video_url, 512), str(ref.ctwa_clid, 191)]);
  return Number(r?.affectedRows) === 1 ? Number(r.insertId) : null;
}

/**
 * Minimal facts for a unit that is NOT quotable by the AI: name/stock/year/category plus its status.
 * Never price or photos. A correction the owner saved is honoured even when the unit is sold or
 * reserved, so a corrected referral can never fall through to fuzzy matching again.
 */
async function vehicleSummary(vehicleId: number, opts: { sellableOnly?: boolean } = {}): Promise<ReferralSummary | null> {
  const r = await one<any>(`SELECT v.id,v.stock_no,v.category,v.brand,v.model,v.trim_name,v.model_year,v.status FROM vehicles v
    WHERE v.id=?${opts.sellableOnly ? ` AND ${sellableVehicleSql('v')}` : ''} LIMIT 1`, [vehicleId]);
  return r ? {
    id: Number(r.id), stock_no: r.stock_no, category: r.category || null, brand: r.brand, model: r.model, trim_name: r.trim_name,
    model_year: r.model_year == null ? null : Number(r.model_year), status: r.status == null ? null : String(r.status),
  } : null;
}

/**
  Resolve a tapped Facebook post/ad to a vehicle, in this exact order (GOAL 5):
    1. saved admin referral correction        (a human decision - always wins)
    2. exact publish/referral id or stock     (the ad itself names the unit)
    3. exact current conversation vehicle     (only with real evidence in the ad text)
    4. exact recent HUMAN selection in this conversation (only with evidence)
    5. exact model/year/category evidence     (strict referral match)
    6. same-day human pattern                 (WEAK evidence, never overrides 1-5)
    7. catalog matching                       (part of the strict match above)
    8. clarification (returns nothing -> the reply asks ONE short question)
  A motorcycle lead can never resolve to a car, and brand-only evidence never becomes a single match.
*/
export async function resolveReferral(
  channel: string,
  r: { source_id?: string | null; source_url?: string | null; headline?: string | null; body?: string | null },
  opts: { conversationId?: number | null } = {},
): Promise<ResolvedReferral> {
  const context = {
    headline: str(r.headline, 500),
    body: str(r.body, 2000),
    sourceUrl: str(r.source_url, 512),
    advertisedPrice: referralPrice([r.headline, r.body].filter(Boolean).join(' ')),
  };
  const none: ResolvedReferral = { vehicle: null, aiEnabled: false, method: 'none', ...context };
  try {
    await ensureReferralSchema();
    const key = referralSourceKey(channel, r.source_id, r.source_url);

    // A / C. Saved staff correction wins (a human already decided which car this post is).
    if (key) {
      const c = await one<any>('SELECT vehicle_id FROM referral_corrections WHERE source_key=? LIMIT 1', [key]).catch(() => null);
      if (c?.vehicle_id) {
        const ai = await aiCarById(Number(c.vehicle_id));
        if (ai) return { vehicle: ai, aiEnabled: true, method: 'correction', ...context };
        const other = await vehicleSummary(Number(c.vehicle_id));
        if (other) return { vehicle: other, aiEnabled: false, method: 'correction', ...context };
      }
    }

    // A canonical Sky Cars vehicle URL is a trusted exact identifier.
    if (r.source_url) {
      try {
        const u = new URL(String(r.source_url));
        if (/^(www\.)?skyshcars\.com$/i.test(u.hostname)) {
          const id = /^\/vehicles\/(\d{1,10})(?:\/|$)/.exec(u.pathname)?.[1];
          if (id) {
            const ai = await aiCarById(Number(id));
            if (ai) return { vehicle: ai, aiEnabled: true, method: 'url', ...context };
            const other = await vehicleSummary(Number(id));
            if (other) return { vehicle: other, aiEnabled: false, method: 'url', ...context };
          }
        }
      } catch { /* non-URL referral sources are normal */ }
    }

    // B. The Facebook publisher recorded the real vehicle behind this post id.
    if (r.source_id) {
      const p = await one<any>(`SELECT vehicle_id FROM social_publish_log WHERE status='sent' AND external_id=? ORDER BY id DESC LIMIT 1`, [String(r.source_id)]).catch(() => null);
      if (p?.vehicle_id) {
        const ai = await aiCarById(Number(p.vehicle_id));
        if (ai) return { vehicle: ai, aiEnabled: true, method: 'social_log', ...context };
        const other = await vehicleSummary(Number(p.vehicle_id));
        if (other) return { vehicle: other, aiEnabled: false, method: 'social_log', ...context };
      }
    }

    const text = [r.headline, r.body].filter(Boolean).join(' ');

    /*
      C. The chat itself may already know the exact unit (steps 3 and 4). This is ONLY accepted when
      the ad text really names that vehicle's model or stock, so it can never invent a match, and the
      category must agree with the ad.
    */
    if (opts.conversationId && text) {
      const state = await one<any>('SELECT current_vehicle_id,current_vehicle_source FROM conversation_state WHERE conversation_id=? LIMIT 1', [Number(opts.conversationId)]).catch(() => null);
      const humanSel = await lastHumanVehicleSelection(Number(opts.conversationId)).catch(() => null);
      const wantCategory = categoryHint(text);
      const consider: { id: number; method: ReferralMethod }[] = [];
      if (state?.current_vehicle_id) consider.push({ id: Number(state.current_vehicle_id), method: 'conversation' });
      if (humanSel?.vehicle_id && Number(humanSel.vehicle_id) !== Number(state?.current_vehicle_id || 0)) consider.push({ id: Number(humanSel.vehicle_id), method: 'human' });
      for (const cand of consider) {
        const v = await vehicleSummary(cand.id);
        if (!v) continue;
        if (wantCategory && v.category && String(v.category) !== wantCategory) continue;
        if (referralLooksMismatched(text, v)) continue;   // the ad must really name this model/stock
        const ai = await aiCarById(cand.id);
        if (ai) return { vehicle: ai, aiEnabled: true, method: cand.method, ...context };
        return { vehicle: v, aiEnabled: false, method: cand.method, ...context };
      }
    }

    /*
      D. Strict referral match against EVERY sellable unit (cars and motorcycles, AI-enabled or not).
      The tapped post names one exact vehicle; the matcher requires model evidence and treats the
      category as a hard filter, so a Honda motorcycle can never resolve to a Honda car.
    */
    const q = text;
    if (q) {
      const inventory = await loadReferralInventory(800).catch(() => []);
      const decision = rankReferralCandidates(q, inventory as any, { price: referralPrice(q), stock: referralStock(q) });
      if (decision.kind === 'one') {
        const id = Number(decision.vehicle.id);
        if (decision.vehicle.ai_enabled) {
          const v = await aiCarById(id);
          if (v) return { vehicle: v, aiEnabled: true, method: 'headline', ...context };
        }
        const other = await vehicleSummary(id);
        if (other) return { vehicle: other, aiEnabled: false, method: 'headline', ...context };
      }
      if (decision.kind === 'candidates') {
        /*
          The ad names a real model/year but more than one stock unit remains plausible. Keep that
          known model as a hint so the reply acknowledges it and asks for the exact link/stock,
          instead of falling back to the incorrect generic "Which vehicle do you mean?".
        */
        const candidates = decision.list.map((v: any) => ({
          id: Number(v.id), stock_no: v.stock_no, category: v.category || null, brand: v.brand,
          model: v.model, trim_name: v.trim_name, model_year: v.model_year == null ? null : Number(v.model_year),
        })) as ReferralSummary[];
        return {
          vehicle: null, aiEnabled: false, method: 'headline', ...context,
          candidates, hint: referralHintFromCandidates(decision.list),
        };
      }
    }

    /*
      E. Last resort before asking: today's HUMAN patterns (step 6) as WEAK evidence only. It is used
      only when nothing exact matched, and only when the pattern's category agrees with the ad.
    */
    if (q) {
      const wantCategory = categoryHint(q);
      const tokens = normalize(q).split(' ').filter((t) => t.length >= 4);
      const hint = tokens.length ? await patternHintForTokens(tokens, { category: wantCategory }).catch(() => null) : null;
      if (hint) {
        const inventory = await loadReferralInventory(800).catch(() => []);
        const named = inventory.find((v: any) => hint.value && String(hint.value).toLowerCase().includes(String(v.model || '').toLowerCase()) && String(v.model || '').length >= 3);
        if (named) {
          const v = await vehicleSummary(Number(named.id));
          if (v && (!wantCategory || !v.category || String(v.category) === wantCategory)) {
            return { vehicle: v, aiEnabled: false, method: 'pattern', ...context };
          }
        }
      }
    }
  } catch (e) { console.error('REFERRAL_RESOLVE', e); }
  return none;
}

/** Resolve the referral(s) attached to a customer burst and remember the match on the stored rows. */
export async function resolveForBurst(conv: { id: number; channel: string }, messageIds: number[]): Promise<ResolvedReferral> {
  const ids = messageIds.map(Number).filter(Boolean);
  if (!ids.length) return { vehicle: null, aiEnabled: false, method: 'none' };
  await ensureReferralSchema();
  const ref = await one<any>(`SELECT * FROM chat_referrals WHERE message_id IN (${ids.map(() => '?').join(',')}) ORDER BY id DESC LIMIT 1`, ids).catch(() => null);
  if (!ref) return { vehicle: null, aiEnabled: false, method: 'none' };
  // The burst's conversation is passed through so an existing exact unit (current or human-selected)
  // can be reused before falling back to text matching (GOAL 5 steps 3 and 4).
  const res = await resolveReferral(channelOf(conv.channel), { source_id: ref.source_id, source_url: ref.source_url, headline: ref.headline, body: ref.body }, { conversationId: Number(conv.id) });
  await db().execute(`UPDATE chat_referrals SET matched_vehicle_id=?, match_method=? WHERE message_id IN (${ids.map(() => '?').join(',')}) AND matched_vehicle_id IS NULL`,
    [res.vehicle?.id || null, res.method, ...ids]).catch(() => {});
  return {
    ...res,
    headline: res.headline || ref.headline || null,
    body: res.body || ref.body || null,
    sourceUrl: res.sourceUrl || ref.source_url || null,
  };
}

/** Admin: remember which car a Facebook post id really is. */
export async function setReferralCorrection(input: { channel?: string; source_id?: string | null; source_url?: string | null; vehicle_id: number }) {
  await ensureReferralSchema();
  const key = referralSourceKey(input.channel || 'whatsapp', input.source_id, input.source_url);
  if (!key) throw new Error('A referral source id or url is required');
  const v = await one<any>('SELECT id FROM vehicles WHERE id=? LIMIT 1', [Number(input.vehicle_id)]);
  if (!v) throw new Error('Vehicle not found');
  await db().execute(`INSERT INTO referral_corrections(source_key,channel,source_id,source_url,vehicle_id) VALUES(?,?,?,?,?)
    ON DUPLICATE KEY UPDATE vehicle_id=VALUES(vehicle_id), source_id=VALUES(source_id), source_url=VALUES(source_url)`,
    [key, channelOf(input.channel), str(input.source_id, 191), str(input.source_url, 512), Number(input.vehicle_id)]);
  // Apply the correction to any stored referral rows that share this source.
  if (input.source_id) await db().execute(`UPDATE chat_referrals SET matched_vehicle_id=?, match_method='correction' WHERE source_id=?`, [Number(input.vehicle_id), String(input.source_id)]).catch(() => {});
  if (input.source_url) await db().execute(`UPDATE chat_referrals SET matched_vehicle_id=?, match_method='correction' WHERE source_url=?`, [Number(input.vehicle_id), String(input.source_url)]).catch(() => {});
  return { source_key: key, vehicle_id: Number(input.vehicle_id) };
}

export async function recentReferrals(conversationId: number, limit = 10) {
  await ensureReferralSchema();
  /*
    The admin needs to see WHICH vehicle a tapped post resolved to, and whether it looks right, e.g.
    "Facebook referral: Motorcycle Honda CBR1000" -> "Resolved vehicle: Stock 859 - Honda CBR1000".
    Extra read-only columns; no schema change.
  */
  return (await rows<any>(`SELECT r.id,r.message_id,r.channel,r.source_type,r.source_id,r.source_url,r.headline,r.body,r.media_url,
      r.matched_vehicle_id,r.match_method,r.created_at,
      v.stock_no resolved_stock_no, v.category resolved_category, v.model_year resolved_year,
      v.brand resolved_brand, v.model resolved_model, v.trim_name resolved_trim, v.status resolved_status
    FROM chat_referrals r LEFT JOIN vehicles v ON v.id=r.matched_vehicle_id
    WHERE r.conversation_id=? ORDER BY r.id DESC LIMIT ${Math.max(1, Math.min(50, limit))}`, [conversationId]))
    .map(r => ({
      ...r,
      id: Number(r.id),
      matched_vehicle_id: r.matched_vehicle_id ? Number(r.matched_vehicle_id) : null,
      resolved_vehicle: r.matched_vehicle_id
        ? [r.resolved_year, r.resolved_brand, r.resolved_model, r.resolved_trim].filter(Boolean).join(' ') || null
        : null,
    }));
}

export async function referralStats(days = 7) {
  try {
    await ensureReferralSchema();
    const d = Math.max(1, Math.min(90, Math.round(Number(days) || 7)));
    const r = await one<any>(`SELECT COUNT(*) total, SUM(CASE WHEN matched_vehicle_id IS NOT NULL THEN 1 ELSE 0 END) matched
      FROM chat_referrals WHERE created_at >= (NOW() - INTERVAL ? DAY)`, [d]);
    const total = Number(r?.total || 0), matched = Number(r?.matched || 0);
    return { total, matched, rate: total ? Math.round((matched / total) * 100) : null };
  } catch { return { total: 0, matched: 0, rate: null }; }
}
