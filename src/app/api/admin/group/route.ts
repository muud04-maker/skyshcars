import { adminDenied } from '../../../../lib/admin-guard';
import { needsSetupJson } from '../../../../lib/setup';
import { listMembers, listMessages } from '../../../../lib/group-log';
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const d = await adminDenied(); if (d) return d;
  const u = new URL(req.url), p = (k: string) => u.searchParams.get(k) || '';
  try {
    if (p('view') === 'members') return Response.json(await listMembers({ q: p('q'), page: Number(p('page')) }));
    return Response.json(await listMessages({ q: p('q'), group: p('group'), memberId: Number(p('member')) || undefined, questions: p('questions') === '1', page: Number(p('page')) }));
  } catch { return needsSetupJson(); }
}
