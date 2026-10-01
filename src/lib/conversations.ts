import { db, one, rows } from './db';

type Channel = 'whatsapp' | 'facebook';
type MsgType = 'text' | 'image' | 'video' | 'audio' | 'document' | 'other';

/** Returns true if we already stored this Meta message (Meta retries webhooks). */
export async function alreadyProcessed(externalMessageId?: string) {
  if (!externalMessageId) return false;
  return !!(await one('SELECT id FROM messages WHERE external_message_id=? LIMIT 1', [externalMessageId]));
}

/** Store an inbound customer message; creates the conversation + customer record on first contact. */
export async function inbound(channel: Channel, externalId: string, text: string,
  externalMessageId?: string, opts: { type?: MsgType; name?: string; mediaRef?: string } = {}) {
  let c: any = await one('SELECT * FROM conversations WHERE channel=? AND external_user_id=? LIMIT 1', [channel, externalId]);
  if (!c) {
    const idCol = channel === 'whatsapp' ? 'whatsapp_id' : 'facebook_psid';
    let cust: any = await one(`SELECT id FROM customers WHERE ${idCol}=? LIMIT 1`, [externalId]);
    if (!cust) {
      const [r]: any = await db().execute(
        `INSERT INTO customers(full_name,phone,${idCol}) VALUES(?,?,?)`,
        [opts.name || null, channel === 'whatsapp' ? '+' + externalId : null, externalId]);
      cust = { id: r.insertId };
    }
    // INSERT IGNORE protects against two simultaneous first messages
    await db().execute(
      'INSERT IGNORE INTO conversations(customer_id,channel,external_user_id,mode,last_message_at) VALUES(?,?,?,?,NOW())',
      [cust.id, channel, externalId, 'ai']);
    c = await one('SELECT * FROM conversations WHERE channel=? AND external_user_id=? LIMIT 1', [channel, externalId]);
  } else {
    await db().execute('UPDATE conversations SET last_message_at=NOW() WHERE id=?', [c.id]);
  }
  await db().execute(
    'INSERT INTO messages(conversation_id,external_message_id,sender,direction,message_type,body,media_url) VALUES(?,?,?,?,?,?,?)',
    [c.id, externalMessageId || null, 'customer', 'inbound', opts.type || 'text', text, opts.mediaRef || null]);
  return c;
}

export async function outbound(conversationId: number, sender: 'ai' | 'human', text: string, model?: string) {
  await db().execute(
    'INSERT INTO messages(conversation_id,sender,direction,message_type,body,ai_model) VALUES(?,?,?,?,?,?)',
    [conversationId, sender, 'outbound', 'text', text, model || null]);
  await db().execute('UPDATE conversations SET last_message_at=NOW() WHERE id=?', [conversationId]);
}

/** Recent history (oldest first) for AI context. */
export async function history(conversationId: number, n = 30) {
  const r = await rows<any>(
    `SELECT sender,body FROM messages WHERE conversation_id=? AND sender IN ('customer','ai','human')
     ORDER BY id DESC LIMIT ${Math.max(1, Math.min(120, n))}`, [conversationId]);
  return r.reverse();
}
