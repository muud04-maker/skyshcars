/*
  Schema health (release check): prove each critical table exists WITH the columns the code needs.

  Why: every feature self-creates its tables at runtime, and a failed CREATE/ALTER used to be logged and
  then ignored - the app stayed "up" while the affected page failed or, worse, looked empty. This module
  runs the same ensure functions the features use and then asks INFORMATION_SCHEMA what is really there,
  so a broken migration is a visible error instead of a silently partial application.

  Read-only. Admin-only endpoint: /api/admin/schema-health.
*/
import { rows } from './db';

export type SchemaCheck = { table: string; ok: boolean; missing_columns: string[]; error: string | null };

const REQUIRED: { table: string; columns: string[]; ensure: () => Promise<any> }[] = [
  { table: 'staff_tasks', columns: ['request_type', 'dedupe_key', 'conversation_id', 'customer_id', 'stock_no', 'status', 'priority', 'handled_by', 'completed_at'], ensure: async () => (await import('./staff-tasks')).ensureStaffTasksSchema() },
  { table: 'ai_learning_events', columns: ['conversation_id', 'customer_id', 'message_id', 'question', 'ai_reply', 'correction', 'event_type', 'lesson', 'applies_to', 'status', 'confidence', 'category', 'evidence_ref', 'expires_at', 'undone_at'], ensure: async () => (await import('./ai-learning')).ensureAiLearningSchema() },
  { table: 'customer_facts', columns: ['customer_id', 'fact_key', 'fact_value', 'source', 'confidence', 'active'], ensure: async () => (await import('./customer-facts')).ensureCustomerFactsSchema() },
  { table: 'customer_fact_events', columns: ['customer_id', 'fact_key', 'old_value', 'new_value', 'action', 'source'], ensure: async () => (await import('./customer-facts')).ensureCustomerFactsSchema() },
  { table: 'staff_notes', columns: ['customer_id', 'note', 'author', 'active'], ensure: async () => (await import('./staff-notes')).ensureStaffNotesSchema() },
  { table: 'conversation_vehicle_events', columns: ['conversation_id', 'customer_id', 'vehicle_id', 'previous_vehicle_id', 'source'], ensure: async () => (await import('./vehicle-events')).ensureVehicleEventsSchema() },
  { table: 'daily_ai_sales_patterns', columns: ['pattern_date', 'pattern_type', 'pattern_key', 'pattern_value', 'sample_count', 'confidence'], ensure: async () => (await import('./sales-patterns')).ensureSalesPatternsSchema() },
  { table: 'chat_referrals', columns: ['conversation_id', 'channel', 'source_id', 'headline', 'matched_vehicle_id', 'match_method'], ensure: async () => (await import('./referrals')).ensureReferralSchema() },
  { table: 'conversation_state', columns: ['conversation_id', 'current_vehicle_id', 'pending_ai_reply_at', 'answered_through_id'], ensure: async () => (await import('./conversation-state')).ensureConversationState() },
  { table: 'ai_knowledge', columns: ['title', 'content', 'active', 'source', 'scope', 'version', 'status', 'priority', 'created_by', 'updated_by', 'approved_by', 'approved_at'], ensure: async () => (await import('./knowledge')).ensureAiKnowledgeSchema() },
  { table: 'ai_instruction_history', columns: ['instruction_id', 'version', 'action', 'snapshot', 'actor', 'created_at'], ensure: async () => (await import('./knowledge')).ensureAiKnowledgeSchema() },
];

/** Run every schema promise and verify the real columns. Never throws: returns a per-table verdict. */
export async function verifyCriticalSchemas(): Promise<{ ok: boolean; checked_at: string; checks: SchemaCheck[] }> {
  const checks: SchemaCheck[] = [];
  for (const req of REQUIRED) {
    let error: string | null = null;
    try { await req.ensure(); } catch (e: any) { error = String(e?.message || e); }
    let missing: string[] = [];
    try {
      const found = await rows<any>(`SELECT COLUMN_NAME n FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=?`, [req.table]);
      const have = new Set(found.map((r: any) => String(r.n)));
      missing = req.columns.filter((c) => !have.has(c));
      if (!found.length && !error) error = 'table does not exist';
    } catch (e: any) { error = error || String(e?.message || e); }
    checks.push({ table: req.table, ok: !error && missing.length === 0, missing_columns: missing, error });
  }
  return { ok: checks.every((c) => c.ok), checked_at: new Date().toISOString(), checks };
}
