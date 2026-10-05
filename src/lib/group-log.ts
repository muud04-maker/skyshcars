/*
  Full log of authorized WhatsApp groups: every message (text, photos, sender, time) and every member.
  Admin-only. Nothing here is public: logged photos use the private "grp-" blob prefix, which the
  /media route serves to the public only after the photo is approved on a vehicle.
*/
import { createHash } from 'crypto';
import { db, one, rows } from './db';
import { saveBlob } from './media-store';
import { isQuestion } from './intent';
import { backfillMemberLinks, linkMemberToCustomer } from './member-link';

let ready: Promise<void> | null = null;
export function ensureGroupLogSchema() {
  if (!ready) ready = (async () => {
    await db().execute(`CREATE TABLE IF NOT EXISTS group_members(
      id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      sender_id VARCHAR(191) NOT NULL,
      phone VARCHAR(32) NULL,
      name VARCHAR(191) NULL,
      customer_id BIGINT UNSIGNED NULL,
      first_seen_at DATETIME NOT NULL,
      last_seen_at DATETIME NOT NULL,
      message_count INT UNSIGNED NOT NULL DEFAULT 0,
      UNIQUE KEY uq_member_sender(sender_id), INDEX(phone), INDEX(customer_id), INDEX(last_seen_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
    await db().execute(`CREATE TABLE IF NOT EXISTS group_messages(
      id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      message_id VARCHAR(191) NOT NULL,
      group_id VARCHAR(191) NULL,
      group_name VARCHAR(191) NOT NULL,
      member_id BIGINT UNSIGNED NULL,
      sender_id VARCHAR(191) NULL,
      sender_phone VARCHAR(32) NULL,
      sender_name VARCHAR(191) NULL,
      from_me BOOLEAN NOT NULL DEFAULT FALSE,
      body TEXT NULL,
      message_type VARCHAR(30) NOT NULL DEFAULT 'text',
      photo_count INT UNSIGNED NOT NULL DEFAULT 0,
      is_question BOOLEAN NOT NULL DEFAULT FALSE,
      is_listing BOOLEAN NOT NULL DEFAULT FALSE,
      import_item_id BIGINT UNSIGNED NULL,
      sent_at DATETIME NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      UNIQUE KEY uq_group_message(message_id), INDEX(group_name, sent_at), INDEX(member_id, sent_at),
      INDEX(sender_phone), INDEX(is_question), INDEX(sent_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
    await db().execute(`CREATE TABLE IF NOT EXISTS group_message_media(
      id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      group_message_id BIGINT UNSIGNED NOT NULL,
      url VARCHAR(255) NOT NULL,
      mime_type VARCHAR(100) NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(group_message_id) REFERENCES group_messages(id) ON DELETE CASCADE,
      UNIQUE KEY uq_gmm(group_message_id, url), INDEX(group_message_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
  })().catch(e => { ready = null; throw e; });
  return ready;
}

/** Digits-only phone from the bridge's phone field or a "<digits>@c.us" WhatsApp id. "@lid" ids are not phones. */
export function phoneFrom(senderPhone: any, senderId: any) {
  const p = String(senderPhone || '').replace(/\D/g, '');
  if (p.length >= 7 && p.length <= 15) return p;
  const m = /^(\d{7,15})@(c\.us|s\.whatsapp\.net)$/.exec(String(senderId || ''));
  return m ? m[1] : null;
}

const s = (v: any, n: number) => { const x = String(v ?? '').trim(); return x ? x.slice(0, n) : null; };
export function safeMessageId(raw: any) {
  const r = String(raw || '').trim();
  if (!r) return '';
  return r.length <= 190 ? r : 'h-' + createHash('sha256').update(r).digest('hex').slice(0, 48);
}

async function upsertMember(senderId: string, phone: string | null, name: string | null, at: Date) {
  await db().execute(`INSERT INTO group_members(sender_id,phone,name,first_seen_at,last_seen_at,message_count) VALUES(?,?,?,?,?,1)
    ON DUPLICATE KEY UPDATE phone=COALESCE(VALUES(phone),phone), name=COALESCE(VALUES(name),name),
      first_seen_at=LEAST(first_seen_at,VALUES(first_seen_at)), last_seen_at=GREATEST(last_seen_at,VALUES(last_seen_at)), message_count=message_count+1`,
    [senderId, phone, name, at, at]);
  const m = await one<any>('SELECT id,phone,name FROM group_members WHERE sender_id=? LIMIT 1', [senderId]);
  // One person = one customer record across groups and direct chats (linked by phone).
  if (m) { try { await linkMemberToCustomer({ id: Number(m.id), phone: m.phone, name: m.name }); } catch (e) { console.error('GROUP_MEMBER_LINK', e); } }
  return m ? Number(m.id) : null;
}

/** Stores one group message (idempotent on message id). Returns the row id and whether it was new. */
export async function logGroupMessage(p: any) {
  await ensureGroupLogSchema();
  const messageId = safeMessageId(p.messageId);
  if (!messageId) throw new Error('messageId is required');
  const existing = await one<any>('SELECT id FROM group_messages WHERE message_id=? LIMIT 1', [messageId]);
  if (existing) return { id: Number(existing.id), created: false };

  const at = (() => { const d = new Date(p.timestamp ? Number(p.timestamp) * (Number(p.timestamp) < 1e12 ? 1000 : 1) : p.receivedAt || Date.now()); return isNaN(d.getTime()) ? new Date() : d; })();
  const senderId = s(p.sender, 191) || 'unknown';
  const phone = phoneFrom(p.senderPhone, p.sender);
  const name = s(p.senderName, 191);
  const body = String(p.text || '').trim().slice(0, 20000) || null;
  const media = (Array.isArray(p.media) ? p.media : []).slice(0, 20);
  const memberId = await upsertMember(senderId, phone, name, at);

  const [r]: any = await db().execute(`INSERT IGNORE INTO group_messages(message_id,group_id,group_name,member_id,sender_id,sender_phone,sender_name,from_me,body,message_type,photo_count,is_question,sent_at)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [messageId, s(p.groupId, 191), s(p.groupName, 191) || 'unknown', memberId, senderId, phone, name, p.fromMe ? 1 : 0, body,
     s(p.type, 30) || (media.length ? 'image' : 'text'), 0, body && isQuestion(body) ? 1 : 0, at]);
  if (!Number(r.affectedRows)) { const again = await one<any>('SELECT id FROM group_messages WHERE message_id=?', [messageId]); return { id: Number(again?.id), created: false }; }
  const id = Number(r.insertId);
  let photos = 0;
  for (const m of media) {
    const mime = String(m?.mimeType || m?.mimetype || '').slice(0, 100);
    if (!/^image\//i.test(mime) || !m?.data) continue;
    const buf = Buffer.from(String(m.data), 'base64');
    if (!buf.length || buf.length > 12 * 1024 * 1024) continue;
    const hash = createHash('sha256').update(buf).digest('hex').slice(0, 24);
    const url = await saveBlob(`grp-log-${hash}`, mime, buf); // grp- prefix = private until approved
    await db().execute('INSERT IGNORE INTO group_message_media(group_message_id,url,mime_type) VALUES(?,?,?)', [id, url, mime]);
    photos++;
  }
  if (photos) await db().execute('UPDATE group_messages SET photo_count=? WHERE id=?', [photos, id]);
  return { id, created: true, photos };
}

/** Photos already logged for these message ids (used so listings do not need the photos uploaded twice). */
export async function loggedMediaFor(messageIds: string[]) {
  await ensureGroupLogSchema();
  const ids = messageIds.map(safeMessageId).filter(Boolean).slice(0, 50);
  if (!ids.length) return [];
  return rows<any>(`SELECT gm.url, gm.mime_type FROM group_message_media gm JOIN group_messages g ON g.id=gm.group_message_id
    WHERE g.message_id IN (${ids.map(() => '?').join(',')}) ORDER BY g.sent_at, gm.id`, ids);
}

export async function markMessages(messageIds: string[], fields: { is_listing?: boolean; import_item_id?: number | null }) {
  await ensureGroupLogSchema();
  const ids = messageIds.map(safeMessageId).filter(Boolean).slice(0, 50);
  if (!ids.length) return;
  await db().execute(`UPDATE group_messages SET is_listing=?, import_item_id=COALESCE(?,import_item_id) WHERE message_id IN (${ids.map(() => '?').join(',')})`,
    [fields.is_listing ? 1 : 0, fields.import_item_id ?? null, ...ids]);
}

// ---------- Admin queries ----------

export async function listMembers(opts: { q?: string; page?: number; size?: number }) {
  await ensureGroupLogSchema();
  try { await backfillMemberLinks(200); } catch (e) { console.error('MEMBER_BACKFILL', e); }
  const size = Math.min(100, Math.max(10, Number(opts.size) || 50)), page = Math.max(1, Number(opts.page) || 1);
  const q = String(opts.q || '').trim();
  const where = q ? 'WHERE (gm.name LIKE ? OR gm.phone LIKE ? OR gm.sender_id LIKE ?)' : '';
  const args = q ? [`%${q}%`, `%${q.replace(/\D/g, '') || q}%`, `%${q}%`] : [];
  const total = await one<any>(`SELECT COUNT(*) n FROM group_members gm ${where}`, args);
  const list = await rows<any>(`SELECT gm.*, (SELECT COUNT(*) FROM group_messages x WHERE x.member_id=gm.id AND x.is_question=1) questions
    FROM group_members gm ${where} ORDER BY gm.last_seen_at DESC LIMIT ${size} OFFSET ${(page - 1) * size}`, args);
  return { total: Number(total?.n || 0), page, size, members: list };
}

export async function listMessages(opts: { q?: string; group?: string; memberId?: number; questions?: boolean; page?: number; size?: number }) {
  await ensureGroupLogSchema();
  const size = Math.min(200, Math.max(20, Number(opts.size) || 50)), page = Math.max(1, Number(opts.page) || 1);
  const w: string[] = [], a: any[] = [];
  if (opts.q) { w.push('(g.body LIKE ? OR g.sender_name LIKE ? OR g.sender_phone LIKE ?)'); const q = String(opts.q).trim(); a.push(`%${q}%`, `%${q}%`, `%${q}%`); }
  if (opts.group) { w.push('g.group_name=?'); a.push(opts.group); }
  if (opts.memberId) { w.push('g.member_id=?'); a.push(Number(opts.memberId)); }
  if (opts.questions) w.push('g.is_question=1');
  const where = w.length ? 'WHERE ' + w.join(' AND ') : '';
  const total = await one<any>(`SELECT COUNT(*) n FROM group_messages g ${where}`, a);
  const list = await rows<any>(`SELECT g.id,g.group_name,g.member_id,g.sender_phone,g.sender_name,g.from_me,g.body,g.message_type,g.photo_count,g.is_question,g.is_listing,g.import_item_id,g.sent_at,
      (SELECT GROUP_CONCAT(m.url ORDER BY m.id SEPARATOR '\n') FROM group_message_media m WHERE m.group_message_id=g.id) photo_urls
    FROM group_messages g ${where} ORDER BY g.sent_at DESC, g.id DESC LIMIT ${size} OFFSET ${(page - 1) * size}`, a);
  const groups = await rows<any>('SELECT group_name, COUNT(*) n FROM group_messages GROUP BY group_name ORDER BY n DESC LIMIT 50');
  return { total: Number(total?.n || 0), page, size, messages: list, groups };
}
