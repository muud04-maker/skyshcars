/*
  Streaming TXT export of the ALL-customer history (admin only).

  One single file, walked in batches of 500 events with keyset pagination, so a large history is
  streamed to the browser instead of being held in memory. If the safety cap is reached the file ends
  with an explicit TRUNCATED marker - it never stops silently.
*/
import { getAdminSession } from '../../../../../lib/admin';
import { db } from '../../../../../lib/db';
import { EXPORT_BATCH, EXPORT_MAX, historyBlock, historyCount, historyHeader, historyPage, type HistoryFilters } from '../../../../../lib/all-history';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function filtersFrom(url: URL): HistoryFilters {
  return {
    from: url.searchParams.get('from') || '', to: url.searchParams.get('to') || '',
    channel: url.searchParams.get('channel') || '', role: url.searchParams.get('role') || '',
    kind: url.searchParams.get('kind') || '', q: url.searchParams.get('q') || '',
    stock: url.searchParams.get('stock') || '', category: url.searchParams.get('category') || '',
    customerId: Number(url.searchParams.get('customer')) || 0,
    facebookOnly: url.searchParams.get('facebook') === '1',
  };
}

export async function GET(req: Request) {
  const admin = await getAdminSession();
  if (!admin) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  const url = new URL(req.url);
  const filters = filtersFrom(url);
  const counted = await historyCount(filters).catch(() => ({ count: 0, error: 'count failed' as string | null }));
  const total = counted.count;
  const first = await historyPage(filters, { limit: 1, order: 'asc', cursor: null }).catch((e) => ({ rows: [], nextCursor: null, exhausted: true, error: String(e?.message || e), sources: [] as string[] }));
  const stamp = new Date().toISOString().slice(0, 10);
  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let sent = 0, cursor: any = null;
      try {
        controller.enqueue(encoder.encode(historyHeader(filters, total, first.sources)));
        if (first.error) {
          controller.enqueue(encoder.encode(`*** THE DATABASE QUERY FAILED: ${first.error} ***\nThe export cannot read the history until this is fixed. Open /admin/all-history and run the "Data check".\n`));
          return;
        }
        if (!total) {
          controller.enqueue(encoder.encode('No events matched these filters.\n'));
        }
        for (;;) {
          const page = await historyPage(filters, { limit: EXPORT_BATCH, order: 'asc', cursor });
          if (page.error) {
            controller.enqueue(encoder.encode(`\n*** EXPORT ERROR after ${sent} event(s): ${page.error} ***\n`));
            break;
          }
          for (const row of page.rows) {
            if (sent >= EXPORT_MAX) break;
            controller.enqueue(encoder.encode(historyBlock(row)));
            sent++;
          }
          if (sent >= EXPORT_MAX) {
            controller.enqueue(encoder.encode(`\n*** TRUNCATED AT ${sent} EVENTS (safety limit ${EXPORT_MAX}). Narrow the filters or raise ALL_HISTORY_EXPORT_MAX to export the rest. ***\n`));
            break;
          }
          if (page.exhausted || !page.nextCursor) break;
          cursor = page.nextCursor;
        }
        controller.enqueue(encoder.encode(`\n=== END OF HISTORY EXPORT - ${sent} event(s) written${total > sent ? ` of ${total} matching` : ''} ===\n`));
      } catch (e: any) {
        controller.enqueue(encoder.encode(`\n*** EXPORT ERROR after ${sent} event(s): ${String(e?.message || e)} ***\n`));
      } finally {
        try {
          await db().execute('INSERT INTO audit_logs(actor,action,entity_type,entity_id,details) VALUES(?,?,?,?,?)',
            [admin.email, 'export_all_history', 'history', 'all', JSON.stringify({ events: sent, total, filters })]);
        } catch { /* logging must never break the download */ }
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      'content-type': 'text/plain; charset=utf-8',
      'content-disposition': `attachment; filename="sky-cars-all-history-${stamp}.txt"`,
      'cache-control': 'no-store',
      'x-accel-buffering': 'no',
    },
  });
}
