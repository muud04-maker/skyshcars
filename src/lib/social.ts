import axios from 'axios';
import { db, one, rows } from './db';
import { sendWhatsApp, sendWhatsAppImage } from './meta';
import { outbound } from './conversations';

const SITE = (process.env.NEXT_PUBLIC_SITE_URL || 'https://skyshcars.com').replace(/\/$/, '');
const GRAPH_VERSION = process.env.META_GRAPH_VERSION || process.env.WHATSAPP_GRAPH_VERSION || 'v26.0';
const GRAPH = `https://graph.facebook.com/${GRAPH_VERSION}`;
const MODEL = process.env.DEEPSEEK_MODEL || 'deepseek-chat';

export type SocialSettings = {
  facebook_auto: boolean;
  whatsapp_active_chats_auto: boolean;
  allow_labeled_demo_images: boolean;
};

const DEFAULTS: SocialSettings = {
  facebook_auto: false,
  whatsapp_active_chats_auto: false,
  allow_labeled_demo_images: false,
};

export async function ensureSocialSchema() {
  await db().execute(`CREATE TABLE IF NOT EXISTS social_publish_log (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    vehicle_id BIGINT UNSIGNED NOT NULL,
    channel VARCHAR(40) NOT NULL,
    external_id VARCHAR(191) NULL,
    status ENUM('sent','skipped','failed') NOT NULL,
    details TEXT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    INDEX(vehicle_id), INDEX(channel), INDEX(created_at)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
}

export async function getSocialSettings(): Promise<SocialSettings> {
  try {
    const r: any = await one('SELECT setting_value FROM business_settings WHERE setting_key=?', ['social_auto_publish']);
    if (!r) return DEFAULTS;
    const v = typeof r.setting_value === 'string' ? JSON.parse(r.setting_value) : r.setting_value;
    return { ...DEFAULTS, ...(v || {}) };
  } catch {
    return DEFAULTS;
  }
}

export async function saveSocialSettings(settings: Partial<SocialSettings>) {
  const current = await getSocialSettings();
  const next = { ...current, ...settings };
  await db().execute(
    `INSERT INTO business_settings(setting_key,setting_value) VALUES('social_auto_publish',?)
     ON DUPLICATE KEY UPDATE setting_value=VALUES(setting_value),updated_at=CURRENT_TIMESTAMP`,
    [JSON.stringify(next)]
  );
  return next;
}

function abs(url?: string | null) {
  if (!url) return null;
  if (/^https?:\/\//i.test(url)) return url;
  return SITE + (url.startsWith('/') ? url : '/' + url);
}

export async function getVehicleForSocial(vehicleId: number) {
  return one<any>(`SELECT v.*,
    (SELECT url FROM vehicle_media m WHERE m.vehicle_id=v.id AND m.media_type='image' AND m.review_status='approved'
      ORDER BY m.is_cover DESC,m.sort_order,id LIMIT 1) cover_url
    FROM vehicles v WHERE v.id=? LIMIT 1`, [vehicleId]);
}

function safeCaption(v: any) {
  const title = `${v.model_year || ''} ${v.brand || ''} ${v.model || ''}`.trim() || 'Vehicle';
  const parts = [
    `New arrival: ${title}`,
    v.stock_no ? `Stock: ${v.stock_no}` : '',
    v.price_usd ? `Price: $${Number(v.price_usd).toLocaleString()}` : 'Price: ask for quote',
    v.mileage_km ? `Mileage: ${Number(v.mileage_km).toLocaleString()} km` : '',
    v.transmission ? `Transmission: ${v.transmission}` : '',
    `${SITE}/vehicles/${v.id}`,
  ].filter(Boolean);
  return parts.join('\n');
}

async function aiCaption(v: any) {
  if (!process.env.DEEPSEEK_API_KEY) return safeCaption(v);
  const facts = {
    stock_no: v.stock_no, category: v.category, brand: v.brand, model: v.model, trim_name: v.trim_name,
    model_year: v.model_year, mileage_km: v.mileage_km, transmission: v.transmission,
    fuel_type: v.fuel_type, color: v.color, price_usd: v.price_usd, location: v.location,
    link: `${SITE}/vehicles/${v.id}`,
  };
  try {
    const r = await axios.post('https://api.deepseek.com/chat/completions', {
      model: MODEL,
      temperature: 0.15,
      max_tokens: 220,
      messages: [
        { role: 'system', content: 'Write a short Facebook/WhatsApp vehicle post using ONLY the supplied facts. Never invent features, condition, shipping price, availability details, discounts, or claims. Keep it concise. Include stock number, price if present, and link. No markdown table.' },
        { role: 'user', content: JSON.stringify(facts) },
      ],
    }, { headers: { Authorization: `Bearer ${process.env.DEEPSEEK_API_KEY}`, 'Content-Type': 'application/json' }, timeout: 20000 });
    return r.data.choices?.[0]?.message?.content?.trim() || safeCaption(v);
  } catch (e) {
    console.error('SOCIAL_CAPTION_AI', e);
    return safeCaption(v);
  }
}

function imageFor(v: any, _settings: SocialSettings) {
  // Social and WhatsApp publishing use only approved real vehicle photos.
  // Reference/test imagery remains website-only and is never presented as the actual stock vehicle.
  if (v.cover_url) return { url: abs(v.cover_url)!, demo: false };
  return null;
}

async function loggedAlready(vehicleId: number, channel: string) {
  await ensureSocialSchema();
  const r = await one<any>("SELECT id FROM social_publish_log WHERE vehicle_id=? AND channel=? AND status='sent' LIMIT 1", [vehicleId, channel]);
  return !!r;
}

async function log(vehicleId: number, channel: string, status: 'sent'|'skipped'|'failed', details: any, externalId?: string | null) {
  await ensureSocialSchema();
  await db().execute('INSERT INTO social_publish_log(vehicle_id,channel,external_id,status,details) VALUES(?,?,?,?,?)',
    [vehicleId, channel, externalId || null, status, typeof details === 'string' ? details : JSON.stringify(details || {})]);
}

export async function publishVehicleToFacebook(vehicleId: number, force = false) {
  const settings = await getSocialSettings();
  const v: any = await getVehicleForSocial(vehicleId);
  if (!v || v.status !== 'available') return { ok: false, skipped: 'Vehicle is not available' };
  if (!force && await loggedAlready(vehicleId, 'facebook')) return { ok: true, skipped: 'Already posted' };
  if (!process.env.META_PAGE_ACCESS_TOKEN || !process.env.META_PAGE_ID) {
    await log(vehicleId, 'facebook', 'skipped', 'META_PAGE_ACCESS_TOKEN or META_PAGE_ID missing');
    return { ok: false, skipped: 'Facebook Page credentials are not configured' };
  }
  const caption = await aiCaption(v);
  const image = imageFor(v, settings);
  const message = caption;
  try {
    let r: any;
    if (image) {
      r = await axios.post(`${GRAPH}/${process.env.META_PAGE_ID}/photos`, {
        url: image.url, caption: message, published: true, access_token: process.env.META_PAGE_ACCESS_TOKEN,
      }, { timeout: 25000 });
    } else {
      r = await axios.post(`${GRAPH}/${process.env.META_PAGE_ID}/feed`, {
        message, access_token: process.env.META_PAGE_ACCESS_TOKEN,
      }, { timeout: 25000 });
    }
    const id = r.data?.post_id || r.data?.id || null;
    await log(vehicleId, 'facebook', 'sent', { image: image?.url || null }, id);
    return { ok: true, id };
  } catch (e: any) {
    const err = e?.response?.data || e?.message || String(e);
    await log(vehicleId, 'facebook', 'failed', err);
    return { ok: false, error: err };
  }
}

export async function publishVehicleToActiveWhatsAppChats(vehicleId: number, force = false) {
  const settings = await getSocialSettings();
  const v: any = await getVehicleForSocial(vehicleId);
  if (!v || v.status !== 'available') return { ok: false, skipped: 'Vehicle is not available' };
  if (!force && await loggedAlready(vehicleId, 'whatsapp')) return { ok: true, skipped: 'Already shared' };
  if (!process.env.WHATSAPP_ACCESS_TOKEN || !process.env.WHATSAPP_PHONE_NUMBER_ID) return { ok: false, skipped: 'WhatsApp is not configured' };
  const chats = await rows<any>(`SELECT id,external_user_id FROM conversations
    WHERE channel='whatsapp' AND mode='ai' AND last_message_at >= (NOW() - INTERVAL 24 HOUR)
    ORDER BY last_message_at DESC LIMIT 100`);
  if (!chats.length) {
    await log(vehicleId, 'whatsapp', 'skipped', 'No active AI WhatsApp chats in the last 24 hours');
    return { ok: true, sent: 0 };
  }
  const caption = await aiCaption(v);
  const image = imageFor(v, settings);
  const body = caption;
  let sent = 0, failed = 0;
  for (const c of chats) {
    try {
      if (image) await sendWhatsAppImage(c.external_user_id, image.url, body.slice(0, 1000));
      else await sendWhatsApp(c.external_user_id, body);
      await outbound(Number(c.id), 'ai', body, MODEL);
      sent++;
    } catch (e) {
      failed++;
      console.error('WHATSAPP_AUTO_SHARE', e);
    }
  }
  await log(vehicleId, 'whatsapp', sent ? 'sent' : 'failed', { sent, failed, image: image?.url || null });
  return { ok: sent > 0, sent, failed };
}

export async function autoPublishVehicle(vehicleId: number) {
  const settings = await getSocialSettings();
  const result: any = {};
  if (settings.facebook_auto) result.facebook = await publishVehicleToFacebook(vehicleId);
  if (settings.whatsapp_active_chats_auto) result.whatsapp = await publishVehicleToActiveWhatsAppChats(vehicleId);
  return result;
}

export async function recentSocialLogs() {
  await ensureSocialSchema();
  return rows<any>(`SELECT l.*,v.stock_no,v.brand,v.model FROM social_publish_log l
    LEFT JOIN vehicles v ON v.id=l.vehicle_id ORDER BY l.id DESC LIMIT 50`);
}
