/*
  Links a WhatsApp group member to the customers table by phone number, so one person has one
  customer record whether they wrote in a group or in a direct chat.
  Matching uses the same keys the WhatsApp webhook uses for direct chats (whatsapp_id = digits,
  phone = +digits), so a later direct message lands on the same customer.
*/
import { db, one, rows } from './db';

export async function customerIdForPhone(digits: string, name?: string | null, create = true) {
  const d = String(digits || '').replace(/\D/g, '');
  if (d.length < 7) return null;
  const found = await one<any>(`SELECT id FROM customers WHERE whatsapp_id=? OR phone IN (?,?)
    OR REPLACE(REPLACE(REPLACE(COALESCE(phone,''),'+',''),' ',''),'-','')=? ORDER BY (whatsapp_id=?) DESC, id LIMIT 1`, [d, '+' + d, d, d, d]);
  if (found) {
    // Fill gaps only; never overwrite what staff or the customer entered.
    await db().execute(`UPDATE customers SET whatsapp_id=COALESCE(NULLIF(whatsapp_id,''),?), full_name=COALESCE(NULLIF(full_name,''),?) WHERE id=?`, [d, name || null, found.id]);
    return Number(found.id);
  }
  if (!create) return null;
  const [r]: any = await db().execute(`INSERT INTO customers(full_name,phone,whatsapp_id,notes) VALUES(?,?,?,?)`,
    [name || null, '+' + d, d, 'First seen in a Sky Cars WhatsApp group']);
  return Number(r.insertId);
}

export async function linkMemberToCustomer(member: { id: number; phone: string | null; name: string | null }) {
  if (!member.phone) return null; // WhatsApp hid this member's number ("@lid" id): cannot link by phone
  const cur = await one<any>('SELECT customer_id FROM group_members WHERE id=?', [member.id]);
  if (cur?.customer_id) return Number(cur.customer_id);
  const customerId = await customerIdForPhone(member.phone, member.name);
  if (customerId) await db().execute('UPDATE group_members SET customer_id=? WHERE id=?', [customerId, member.id]);
  return customerId;
}

/** Links members logged before linking existed. Cheap and idempotent; called from the admin Group page. */
export async function backfillMemberLinks(limit = 200) {
  const list = await rows<any>(`SELECT id,phone,name FROM group_members WHERE customer_id IS NULL AND phone IS NOT NULL LIMIT ${Math.max(1, Math.min(1000, limit))}`);
  for (const m of list) { try { await linkMemberToCustomer({ id: Number(m.id), phone: m.phone, name: m.name }); } catch (e) { console.error('MEMBER_LINK', e); } }
  return list.length;
}
