/*
  Private staff notes per customer (Part 6). Owner/staff only: never shown to customers and never
  sent to the AI as customer-facing text (it is context for staff, not for the model).
*/
import { db, rows } from './db';

let ready: Promise<void> | null = null;
export function ensureStaffNotesSchema() {
  if (!ready) ready = db().execute(`CREATE TABLE IF NOT EXISTS staff_notes (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    customer_id BIGINT UNSIGNED NOT NULL,
    note TEXT NOT NULL,
    author VARCHAR(191) NULL,
    active TINYINT(1) NOT NULL DEFAULT 1,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_note_customer(customer_id,active,created_at)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`).then(() => undefined).catch(e => { ready = null; throw e; });
  return ready;
}

export async function notesForCustomer(customerId: number, limit = 50) {
  if (!customerId) return [];
  await ensureStaffNotesSchema();
  return rows<any>(`SELECT id,note,author,created_at,updated_at FROM staff_notes
    WHERE customer_id=? AND active=1 ORDER BY id DESC LIMIT ${Math.max(1, Math.min(200, limit))}`, [customerId]);
}

export async function addNote(customerId: number, note: string, author?: string | null) {
  const text = String(note == null ? '' : note).trim().slice(0, 4000);
  if (!customerId || !text) throw new Error('A note is required');
  await ensureStaffNotesSchema();
  const [r]: any = await db().execute('INSERT INTO staff_notes(customer_id,note,author) VALUES(?,?,?)', [customerId, text, String(author || 'admin').slice(0, 191)]);
  return { ok: true, id: Number(r?.insertId) };
}

export async function updateNote(customerId: number, id: number, note: string, author?: string | null) {
  const text = String(note == null ? '' : note).trim().slice(0, 4000);
  if (!text) throw new Error('A note is required');
  await ensureStaffNotesSchema();
  const [r]: any = await db().execute('UPDATE staff_notes SET note=?, author=? WHERE id=? AND customer_id=?', [text, String(author || 'admin').slice(0, 191), Number(id), customerId]);
  return { ok: true, changed: Number(r?.affectedRows || 0) };
}

/** Soft delete: the note disappears from the UI but the row is kept (no destructive delete). */
export async function deleteNote(customerId: number, id: number) {
  await ensureStaffNotesSchema();
  const [r]: any = await db().execute('UPDATE staff_notes SET active=0 WHERE id=? AND customer_id=?', [Number(id), customerId]);
  return { ok: true, changed: Number(r?.affectedRows || 0) };
}
