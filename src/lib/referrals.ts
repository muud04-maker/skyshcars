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
import { loadAiCars, aiCarById, type AiCar } from './ai-catalog';
import { sellableVehicleSql } from './exact-photos';
import { matchVehicles, type VehicleLite } from './ai-rules/match';

export type ReferralMethod = 'correction' | 'social_log' | 'headline' | 'none';
export type ResolvedReferral = { vehicle: AiCar | VehicleLite | null; aiEnabled: boolean; method: ReferralMethod };

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
  const [r]: any = await db().execute(
    `INSERT IGNORE INTO chat_referrals(message_id,conversation_id,channel,source_type,source_id,source_url,headline,body,media_url,ctwa_clid)
     VALUES(?,?,?,?,?,?,?,?,?,?)`,
    [messageId, conv.id, channelOf(conv.channel), str(ref.source_type, 60), str(ref.source_id, 191), str(ref.source_url, 512),
     str(ref.headline), str(ref.body, 2000), str(media.image_url || media.video_url || media.source_url || media.url, 512), str(ref.ctwa_clid, 191)]);
  return Number(r?.affectedRows) === 1 ? Number(r.insertId) : null;
}

/** Minimal facts for a car that is NOT in the AI catalog: name only, never price or photos. */
async function sellableSummary(vehicleId: number): Promise<VehicleLite | null> {
  const r = await one<any>(`SELECT v.id,v.stock_no,v.brand,v.model,v.trim_name,v.model_year FROM vehicles v
    WHERE v.id=? AND ${sellableVehicleSql('v')} LIMIT 1`, [vehicleId]);
  return r ? { id: Number(r.id), stock_no: r.stock_no, brand: r.brand, model: r.model, trim_name: r.trim_name, model_year: r.model_year == null ? null : Number(r.model_year) } : null;
}

/** Resolve a referral to a vehicle. Tries the saved correction, the Facebook publish log, then a strict headline match. */
export async function resolveReferral(channel: string, r: { source_id?: string | null; source_url?: string | null; headline?: string | null; body?: string | null }): Promise<ResolvedReferral> {
  const none: ResolvedReferral = { vehicle: null, aiEnabled: false, method: 'none' };
  try {
    await ensureReferralSchema();
    const key = referralSourceKey(channel, r.source_id, r.source_url);

    // A / C. Saved staff correction wins (a human already decided which car this post is).
    if (key) {
      const c = await one<any>('SELECT vehicle_id FROM referral_corrections WHERE source_key=? LIMIT 1', [key]).catch(() => null);
      if (c?.vehicle_id) {
        const ai = await aiCarById(Number(c.vehicle_id));
        if (ai) return { vehicle: ai, aiEnabled: true, method: 'correction' };
        const other = await sellableSummary(Number(c.vehicle_id));
        if (other) return { vehicle: other, aiEnabled: false, method: 'correction' };
      }
    }

    // B. The Facebook publisher recorded the real vehicle behind this post id.
    if (r.source_id) {
      const p = await one<any>(`SELECT vehicle_id FROM social_publish_log WHERE status='sent' AND external_id=? ORDER BY id DESC LIMIT 1`, [String(r.source_id)]).catch(() => null);
      if (p?.vehicle_id) {
        const ai = await aiCarById(Number(p.vehicle_id));
        if (ai) return { vehicle: ai, aiEnabled: true, method: 'social_log' };
        const other = await sellableSummary(Number(p.vehicle_id));
        if (other) return { vehicle: other, aiEnabled: false, method: 'social_log' };
      }
    }

    // C. Strict headline/body match against the cars the AI is allowed to sell.
    const q = [r.headline, r.body].filter(Boolean).join(' ');
    if (q) {
      const cars = await loadAiCars(400).catch(() => []);
      const m = matchVehicles(q, cars as any);
      if (m.kind === 'one' && m.vehicle) {
        const v = await aiCarById(Number(m.vehicle.id));
        if (v) return { vehicle: v, aiEnabled: true, method: 'headline' };
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
  const res = await resolveReferral(channelOf(conv.channel), { source_id: ref.source_id, source_url: ref.source_url, headline: ref.headline, body: ref.body });
  await db().execute(`UPDATE chat_referrals SET matched_vehicle_id=?, match_method=? WHERE message_id IN (${ids.map(() => '?').join(',')}) AND matched_vehicle_id IS NULL`,
    [res.vehicle?.id || null, res.method, ...ids]).catch(() => {});
  return res;
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
  return { source_key: key, vehicle_id: Number(input.vehicle_id) };
}

export async function recentReferrals(conversationId: number, limit = 10) {
  await ensureReferralSchema();
  return (await rows<any>(`SELECT id,message_id,channel,source_type,source_id,source_url,headline,body,media_url,matched_vehicle_id,match_method,created_at
    FROM chat_referrals WHERE conversation_id=? ORDER BY id DESC LIMIT ${Math.max(1, Math.min(50, limit))}`, [conversationId])).map(r => ({ ...r, id: Number(r.id), matched_vehicle_id: r.matched_vehicle_id ? Number(r.matched_vehicle_id) : null }));
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
