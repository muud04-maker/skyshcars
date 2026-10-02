import {adminDenied} from '../../../../lib/admin-guard';
import {launchReadiness} from '../../../../lib/readiness';
export const dynamic='force-dynamic';
export async function GET(){const d=await adminDenied();if(d)return d;return Response.json(await launchReadiness())}
