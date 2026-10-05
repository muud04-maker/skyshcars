/*
  First-contact welcome, enforced in the database so it can never be sent twice:
  - welcome_log has a UNIQUE key per customer (phone digits; Messenger users: "fb:<psid>").
  - claimWelcome() is an atomic INSERT IGNORE made BEFORE sending. Only the caller that inserted
    the row may add the welcome. Webhook retries, parallel workers, catch-up, mode switches and
    reopened chats all hit the same unique key.
  - On first run every existing customer is back-filled, so people who already chatted never get it.
  Settings live in business_settings 'whatsapp_welcome' {enabled, group_link, group_name}.
*/
import { db, one } from './db';
import { DEFAULT_GROUP_LINK, DEFAULT_GROUP_NAME, type WelcomeConfig } from './ai-rules/welcome';

const SITE = () => (process.env.NEXT_PUBLIC_SITE_URL || 'https://skyshcars.com').replace(/\/$/, '');
const parse = (v: any) => { if (!v) return {}; if (typeof v === 'object') return v; try { return JSON.parse(v); } catch { return {}; } };

let ready: Promise<void> | null = null;
export function ensureWelcomeLog() {
  if (!ready) ready = (async () => {
    await db().execute(`CREATE TABLE IF NOT EXISTS welcome_log(
      customer_key VARCHAR(80) NOT NULL PRIMARY KEY,
      customer_id BIGINT UNSIGNED NULL,
      conversation_id BIGINT UNSIGNED NULL,
      source ENUM('sent','backfill') NOT NULL DEFAULT 'sent',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      INDEX(customer_id), INDEX(created_at), INDEX(source)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
    const [claim]: any = await db().execute(`INSERT IGNORE INTO business_settings(setting_key,setting_value) VALUES('welcome_backfill',?)`, [JSON.stringify({ done: false })]);
    if (Number(claim?.affectedRows) === 1) {
      // Everyone who exists now has "already been welcomed".
      await db().execute(`INSERT IGNORE INTO welcome_log(customer_key,customer_id,source)
        SELECT CONCAT('p:', REPLACE(REPLACE(REPLACE(COALESCE(NULLIF(whatsapp_id,''),phone),'+',''),' ',''),'-','')), id, 'backfill'
        FROM customers WHERE COALESCE(NULLIF(whatsapp_id,''),NULLIF(phone,'')) IS NOT NULL`);
      await db().execute(`INSERT IGNORE INTO welcome_log(customer_key,customer_id,conversation_id,source)
        SELECT CONCAT('p:', external_user_id), customer_id, id, 'backfill' FROM conversations WHERE channel='whatsapp' AND external_user_id IS NOT NULL`);
      await db().execute(`INSERT IGNORE INTO welcome_log(customer_key,customer_id,conversation_id,source)
        SELECT CONCAT('fb:', external_user_id), customer_id, id, 'backfill' FROM conversations WHERE channel='facebook' AND external_user_id IS NOT NULL`);
      await db().execute(`UPDATE business_settings SET setting_value=? WHERE setting_key='welcome_backfill'`, [JSON.stringify({ done: true, at: new Date().toISOString() })]);
    } else {
      // Another worker is back-filling right now: wait for it so we never welcome an existing customer.
      for (let i = 0; i < 30; i++) {
        const r = await one<any>(`SELECT setting_value FROM business_settings WHERE setting_key='welcome_backfill'`);
        if (parse(r?.setting_value).done) break;
        await new Promise(res => setTimeout(res, 500));
      }
    }
  })().catch(e => { ready = null; throw e; });
  return ready;
}

export { customerKey } from './ai-rules/engine-core';

export async function welcomeConfig(): Promise<WelcomeConfig> {
  try {
    const r = await one<any>(`SELECT setting_value FROM business_settings WHERE setting_key='whatsapp_welcome'`);
    const v = parse(r?.setting_value);
    return { enabled: v.enabled !== false, site: SITE(), groupLink: String(v.group_link || DEFAULT_GROUP_LINK), groupName: String(v.group_name || DEFAULT_GROUP_NAME) };
  } catch { return { enabled: true, site: SITE(), groupLink: DEFAULT_GROUP_LINK, groupName: DEFAULT_GROUP_NAME }; }
}

export async function saveWelcomeConfig(p: { enabled?: boolean; group_link?: string; group_name?: string }) {
  const cur = await welcomeConfig();
  const link = String(p.group_link ?? cur.groupLink).trim();
  if (link && !/^https:\/\/chat\.whatsapp\.com\//i.test(link)) throw new Error('The group link must start with https://chat.whatsapp.com/');
  const v = { enabled: p.enabled ?? cur.enabled, group_link: link || DEFAULT_GROUP_LINK, group_name: String(p.group_name ?? cur.groupName).trim().slice(0, 80) || DEFAULT_GROUP_NAME };
  await db().execute(`INSERT INTO business_settings(setting_key,setting_value) VALUES('whatsapp_welcome',?) ON DUPLICATE KEY UPDATE setting_value=VALUES(setting_value)`, [JSON.stringify(v)]);
  return v;
}

export async function welcomeAlreadySent(key: string) {
  await ensureWelcomeLog();
  return !!(await one<any>(`SELECT customer_key FROM welcome_log WHERE customer_key=?`, [key]));
}

/** Atomic claim. true = this caller (and only this caller) adds the welcome to the reply it is about to send. */
export async function claimWelcome(key: string, customerId: number | null, conversationId: number) {
  await ensureWelcomeLog();
  const [r]: any = await db().execute(`INSERT IGNORE INTO welcome_log(customer_key,customer_id,conversation_id,source) VALUES(?,?,?,'sent')`, [key, customerId, conversationId]);
  return Number(r?.affectedRows) === 1;
}

/** Undo a welcome claim after a failed delivery, so the one-time welcome rides the next successful reply. */
export async function releaseWelcome(key: string) {
  await ensureWelcomeLog();
  await db().execute(`DELETE FROM welcome_log WHERE customer_key=? AND source='sent'`, [key]);
}

export async function welcomesSentToday() {
  try { await ensureWelcomeLog(); const r = await one<any>(`SELECT COUNT(*) n FROM welcome_log WHERE source='sent' AND created_at >= CURDATE()`); return Number(r?.n || 0); }
  catch { return null; }
}
