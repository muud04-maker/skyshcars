import { handlers } from '../../../../auth';
import { customerAccountsEnabled } from '../../../../lib/auth-providers';
// When customer accounts are switched off the auth endpoints simply do not exist (no configuration errors leak out).
const off = () => new Response('Not found', { status: 404 });
export const GET = (req: any) => customerAccountsEnabled() ? handlers.GET(req) : off();
export const POST = (req: any) => customerAccountsEnabled() ? handlers.POST(req) : off();
