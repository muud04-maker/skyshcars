import { getAdminSession } from '../../../../../lib/admin';
import { extractSupplierVehicles } from '../../../../../lib/vehicle-extraction';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  if (!(await getAdminSession())) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  const body = await request.json().catch(() => ({}));
  const text = String(body?.text || '').trim();
  if (!text) return Response.json({ error: 'Paste a supplier vehicle description first.' }, { status: 400 });
  if (text.length > 20000) return Response.json({ error: 'Description is too long (maximum 20,000 characters).' }, { status: 400 });
  try {
    return Response.json(await extractSupplierVehicles(text), { headers: { 'Cache-Control': 'no-store' } });
  } catch (error: any) {
    return Response.json({
      error: 'Vehicle extraction failed. Your pasted text has been preserved.',
      detail: String(error?.message || error).slice(0, 300),
    }, { status: 502 });
  }
}
