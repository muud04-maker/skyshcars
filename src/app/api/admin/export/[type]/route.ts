import { getAdminSession } from '../../../../../lib/admin';
import { db } from '../../../../../lib/db';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Backup/export of business data as CSV (opens in Excel). Owner/admin only. Never includes passwords, tokens or supplier fields.
const SQL: Record<string, string> = {
  vehicles: `SELECT stock_no,category,brand,model,trim_name,model_year,mileage_km,fuel_type,transmission,color,price_usd,status,location,published_at,updated_at FROM vehicles ORDER BY id`,
  customers: `SELECT id,full_name,phone,email,country,created_at FROM customers ORDER BY id`,
  leads: `SELECT id,source,name,phone,email,message,status,created_at FROM leads ORDER BY id`,
  quotes: `SELECT reference,customer_id,vehicle_id,shipping_method,customer_message,status,created_at FROM quote_requests ORDER BY id`,
};
const cell = (v: any) => {
  let s = v instanceof Date ? v.toISOString() : v == null ? '' : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s; // neutralise spreadsheet formula injection
  return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
};

export async function GET(_: Request, { params }: { params: Promise<{ type: string }> }) {
  const admin = await getAdminSession();
  if (!admin || !['owner', 'admin'].includes(admin.role)) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  const { type } = await params;
  const sql = SQL[type];
  if (!sql) return Response.json({ error: 'Unknown export' }, { status: 404 });
  const [rows]: any = await db().execute(sql);
  const cols = rows.length ? Object.keys(rows[0]) : [];
  const csv = '\ufeff' + [cols.join(','), ...rows.map((r: any) => cols.map(c => cell(r[c])).join(','))].join('\r\n');
  try { await db().execute('INSERT INTO audit_logs(actor,action,entity_type,entity_id,details) VALUES(?,?,?,?,?)', [admin.email, 'export_csv', 'export', type, JSON.stringify({ rows: rows.length })]); } catch {}
  return new Response(csv, { headers: { 'content-type': 'text/csv; charset=utf-8', 'content-disposition': `attachment; filename="sky-cars-${type}-${new Date().toISOString().slice(0, 10)}.csv"`, 'cache-control': 'no-store' } });
}
