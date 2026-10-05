import axios from 'axios';
import { db, one, rows } from './db';

const MODEL = process.env.DEEPSEEK_MODEL || 'deepseek-chat';

/*
  Persistent memory of one person. It combines their direct chats (messages table, every channel)
  with what they wrote in Sky Cars WhatsApp groups (group_messages, linked by phone via group_members.customer_id).
  Full history is kept forever in those tables; customer_memory holds only the AI summary.
*/

let schemaReady: Promise<void> | null = null;
export function ensureCustomerMemorySchema() {
  if (!schemaReady) schemaReady = (async () => {
    await db().execute(`CREATE TABLE IF NOT EXISTS customer_memory (
      customer_id BIGINT UNSIGNED PRIMARY KEY,
      summary TEXT NULL,
      preferences_json JSON NULL,
      last_vehicle_id BIGINT UNSIGNED NULL,
      last_stock_no VARCHAR(60) NULL,
      message_count INT NOT NULL DEFAULT 0,
      summarized_through_message_id BIGINT UNSIGNED NULL,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      FOREIGN KEY(customer_id) REFERENCES customers(id) ON DELETE CASCADE,
      INDEX(last_vehicle_id), INDEX(updated_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
    try { await db().execute(`ALTER TABLE customer_memory ADD COLUMN summarized_through_group_message_id BIGINT UNSIGNED NULL`); }
    catch (e: any) { if (e?.code !== 'ER_DUP_FIELDNAME') throw e; }
  })().catch(e => { schemaReady = null; throw e; });
  return schemaReady;
}

/** What this person wrote in authorized WhatsApp groups, oldest first. Empty if the group log is not set up yet. */
export async function groupMessagesForCustomer(customerId: number, limit = 40) {
  if (!customerId) return [];
  try {
    const r = await rows<any>(`SELECT g.id,g.group_name,g.body,g.photo_count,g.is_question,g.sent_at FROM group_messages g
      JOIN group_members gm ON gm.id=g.member_id WHERE gm.customer_id=? AND g.from_me=0 ORDER BY g.sent_at DESC, g.id DESC LIMIT ${Math.max(1, Math.min(300, limit))}`, [customerId]);
    return r.reverse();
  } catch { return []; }
}

function groupLines(list: any[]) {
  return list.map(g => `[${new Date(g.sent_at).toISOString().slice(0, 16).replace('T', ' ')}] in group "${g.group_name}": ${String(g.body || '').slice(0, 500) || '(photo)'}${g.photo_count && g.body ? ` [+${g.photo_count} photo]` : ''}`);
}

export async function memoryForConversation(conversationId: number) {
  await ensureCustomerMemorySchema();
  const m = await one<any>(`SELECT c.customer_id, cm.* FROM conversations c LEFT JOIN customer_memory cm ON cm.customer_id=c.customer_id WHERE c.id=? LIMIT 1`, [conversationId]);
  if (!m?.customer_id) return m;
  // Recent group activity is passed raw (not only summarized) so the AI can refer to it accurately.
  const group = await groupMessagesForCustomer(Number(m.customer_id), 30);
  return { ...m, customer_id: undefined, said_in_whatsapp_groups: group.length ? groupLines(group) : undefined };
}

export async function refreshCustomerMemory(conversationId: number) {
  const conv: any = await one(`SELECT customer_id FROM conversations WHERE id=? LIMIT 1`, [conversationId]);
  if (!conv?.customer_id) return null;
  return refreshCustomerMemoryById(Number(conv.customer_id));
}

export async function refreshCustomerMemoryById(customerId: number) {
  if (!process.env.DEEPSEEK_API_KEY || !customerId) return null;
  await ensureCustomerMemorySchema();
  const msgs = await rows<any>(`SELECT m.id,m.sender,m.body FROM messages m JOIN conversations cx ON cx.id=m.conversation_id WHERE cx.customer_id=? AND m.sender IN ('customer','human','ai') ORDER BY m.id DESC LIMIT 300`, [customerId]);
  const group = await groupMessagesForCustomer(customerId, 100);
  if (!msgs.length && !group.length) return null;
  const newestId = Number(msgs[0]?.id || 0), newestGroupId = group.length ? Number(group[group.length - 1].id) : 0;
  const current: any = await one(`SELECT * FROM customer_memory WHERE customer_id=?`, [customerId]);
  if (current && Number(current.summarized_through_message_id || 0) >= newestId && Number(current.summarized_through_group_message_id || 0) >= newestGroupId) return current;
  const transcript = msgs.reverse().map(m => `${m.sender.toUpperCase()}: ${String(m.body || '')}`).join('\n');
  const groupText = group.length ? `\n\nWhat this person wrote in Sky Cars WhatsApp groups (public group chat, not a private conversation):\n${groupLines(group).join('\n')}` : '';
  const prompt = `Read this Sky Cars customer history and return ONLY compact JSON with keys: summary, preferred_brands (array), preferred_models (array), budget_usd (number|null), destination_country (string|null), destination_port (string|null), preferred_language (string|null), last_vehicle_stock_no (string|null), purchase_intent (string|null). The summary must say what they asked in groups and in direct chat. Do not invent facts. Preserve human staff decisions.\n\nDirect conversation:\n${transcript || '(none yet)'}${groupText}`;
  try {
    const r = await axios.post('https://api.deepseek.com/chat/completions', { model: MODEL, temperature: 0, max_tokens: 600, messages: [{ role: 'user', content: prompt }] }, { headers: { Authorization: `Bearer ${process.env.DEEPSEEK_API_KEY}`, 'Content-Type': 'application/json' }, timeout: 20000 });
    const text = String(r.data.choices?.[0]?.message?.content || '').trim().replace(/^```json\s*/i, '').replace(/```$/, '').trim();
    const parsed = JSON.parse(text);
    const stock = String(parsed.last_vehicle_stock_no || '').trim() || null;
    let lastVehicleId: any = null;
    if (stock) { const v: any = await one('SELECT id FROM vehicles WHERE stock_no=? LIMIT 1', [stock]); lastVehicleId = v?.id || null; }
    await db().execute(`INSERT INTO customer_memory(customer_id,summary,preferences_json,last_vehicle_id,last_stock_no,message_count,summarized_through_message_id,summarized_through_group_message_id)
      VALUES(?,?,?,?,?,?,?,?) ON DUPLICATE KEY UPDATE summary=VALUES(summary),preferences_json=VALUES(preferences_json),last_vehicle_id=VALUES(last_vehicle_id),last_stock_no=VALUES(last_stock_no),message_count=VALUES(message_count),summarized_through_message_id=VALUES(summarized_through_message_id),summarized_through_group_message_id=VALUES(summarized_through_group_message_id)`,
      [customerId, String(parsed.summary || '').slice(0, 4000) || null, JSON.stringify(parsed), lastVehicleId, stock, msgs.length + group.length, newestId || null, newestGroupId || null]);
    return { summary: parsed.summary, preferences_json: parsed, last_vehicle_id: lastVehicleId, last_stock_no: stock };
  } catch (e) { console.error('CUSTOMER_MEMORY_REFRESH', e); return current || null; }
}
