/*
  One single TXT file with the complete AI learning log (GOAL 2): streamed in batches, admin only.
  Includes the vehicle/referral context when one is stored on the lesson payload.
*/
import { getAdminSession } from '../../../../../lib/admin';
import { db, rows } from '../../../../../lib/db';
import { ensureAiLearningSchema } from '../../../../../lib/ai-learning';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const BATCH = 500;
const MAX = Math.max(1000, Math.min(200000, Number(process.env.AI_LEARNING_EXPORT_MAX) || 50000));

function statusFilter(v: string | null) {
  return ['pending', 'approved', 'rejected', 'applied'].includes(String(v)) ? String(v) : '';
}

export async function GET(req: Request) {
  const admin = await getAdminSession();
  if (!admin) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  const url = new URL(req.url);
  const status = statusFilter(url.searchParams.get('status'));
  const type = String(url.searchParams.get('type') || '').replace(/[^a-z_]/gi, '').slice(0, 40);
  const stamp = new Date().toISOString().slice(0, 10);
  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let sent = 0, offset = 0;
      const w: string[] = ['1=1']; const a: any[] = [];
      if (status) { w.push('l.status=?'); a.push(status); }
      if (type) { w.push('l.event_type=?'); a.push(type); }
      try {
        controller.enqueue(encoder.encode([
          'SKY CARS - AI LEARNING EXPORT',
          `Generated: ${new Date().toISOString().slice(0, 19).replace('T', ' ')} UTC`,
          `Filters: ${status ? `status ${status}` : 'all statuses'}${type ? `, type ${type}` : ''}`,
          'Only admin-approved / applied lessons influence the AI. Pending and rejected lessons never do.',
          '='.repeat(72),
        ].join('\n') + '\n\n'));
        for (;;) {
          await ensureAiLearningSchema();
          const list = await rows<any>(`SELECT l.*, cu.full_name customer_name, c.channel, c.external_user_id,
              v.stock_no, v.brand, v.model, v.model_year, v.category
            FROM ai_learning_events l
            LEFT JOIN customers cu ON cu.id=l.customer_id
            LEFT JOIN conversations c ON c.id=l.conversation_id
            LEFT JOIN vehicles v ON v.id=JSON_EXTRACT(COALESCE(l.payload,'{}'), '$.vehicle_id')
            WHERE ${w.join(' AND ')} ORDER BY l.id ASC LIMIT ${BATCH} OFFSET ${offset}`, a).catch(() => []);
          if (!list.length) break;
          for (const e of list) {
            if (sent >= MAX) break;
            const who = e.customer_name || e.external_user_id || (e.customer_id ? `customer #${e.customer_id}` : 'unknown');
            const vehicle = [e.model_year, e.brand, e.model].filter(Boolean).join(' ');
            controller.enqueue(encoder.encode([
              `Event #${e.id}`,
              `Timestamp: ${String(e.created_at || '').replace('T', ' ').slice(0, 19)}`,
              `Customer: ${who}${e.customer_id ? ` (#${e.customer_id})` : ''}`,
              `Conversation: ${e.conversation_id ? `#${e.conversation_id}` : '-'}${e.channel ? ` via ${e.channel}` : ''}`,
              e.question ? `Question: ${String(e.question).replace(/\r?\n/g, ' ')}` : null,
              e.ai_reply ? `AI answer: ${String(e.ai_reply).replace(/\r?\n/g, ' ')}` : null,
              e.correction ? `Human correction: ${String(e.correction).replace(/\r?\n/g, ' ')}` : null,
              `Reason: ${e.reason || '-'}`,
              `Lesson: ${String(e.lesson || '-').replace(/\r?\n/g, ' ')}`,
              `Type: ${e.event_type} | Status: ${e.status} | Applies to: ${e.applies_to}`,
              `Applied as: ${e.applied_ref || '-'}${e.applied_at ? ` (${String(e.applied_at).slice(0, 19)})` : ''}`,
              `Vehicle / referral context: ${vehicle || '-'}${e.stock_no ? ` | stock ${e.stock_no}` : ''}${e.category ? ` | ${e.category}` : ''}`,
              `Raised by: ${e.created_by || '-'}${e.reviewed_by ? ` | reviewed by ${e.reviewed_by}` : ''}`,
              '',
            ].filter((l) => l !== null).join('\n') + '\n'));
            sent++;
          }
          if (sent >= MAX) {
            controller.enqueue(encoder.encode(`\n*** TRUNCATED AT ${sent} LESSONS (safety limit ${MAX}). Narrow the filters or raise AI_LEARNING_EXPORT_MAX. ***\n`));
            break;
          }
          if (list.length < BATCH) break;
          offset += list.length;
        }
        controller.enqueue(encoder.encode(`\n=== END OF AI LEARNING EXPORT - ${sent} lesson(s) written ===\n`));
      } catch (e: any) {
        controller.enqueue(encoder.encode(`\n*** EXPORT ERROR after ${sent} lesson(s): ${String(e?.message || e)} ***\n`));
      } finally {
        try { await db().execute('INSERT INTO audit_logs(actor,action,entity_type,entity_id,details) VALUES(?,?,?,?,?)', [admin.email, 'export_ai_learning', 'ai_learning', 'all', JSON.stringify({ lessons: sent, status, type })]); } catch { /* ignore */ }
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      'content-type': 'text/plain; charset=utf-8',
      'content-disposition': `attachment; filename="sky-cars-ai-learning-${stamp}.txt"`,
      'cache-control': 'no-store',
      'x-accel-buffering': 'no',
    },
  });
}
