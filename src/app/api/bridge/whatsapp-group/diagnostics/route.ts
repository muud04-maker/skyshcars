import { bridgeAuthorized } from '../../../../../lib/group-reader';
import { facebookStatus } from '../../../../../lib/facebook';
import { checkWhatsAppNumber, whatsappConfigSummary } from '../../../../../lib/meta';
import { checkDeepSeek } from '../../../../../lib/readiness';

export const dynamic = 'force-dynamic';

/**
 * Secret-protected live integration check for the separately hosted Group Reader.
 * Returns status and permission names only; never returns tokens or credential values.
 */
export async function GET(req: Request) {
  if (!bridgeAuthorized(req)) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  const [facebook, whatsapp, deepseek] = await Promise.all([
    facebookStatus(),
    checkWhatsAppNumber(),
    checkDeepSeek(),
  ]);
  return Response.json({
    checkedAt: new Date().toISOString(),
    facebook: {
      configured: facebook.configured,
      connected: facebook.connected,
      pageIdMatchesConfiguredPage: !!facebook.connected && facebook.id === String(process.env.META_PAGE_ID || '').trim(),
      pageId: facebook.id || null,
      pageName: facebook.name || null,
      tokenSource: facebook.tokenSource,
      tokenType: facebook.tokenType || null,
      neverExpires: facebook.neverExpires ?? null,
      daysLeft: facebook.daysLeft ?? null,
      scopes: facebook.scopes || null,
      missingScopes: facebook.missingScopes || null,
      error: facebook.error || null,
      warnings: facebook.warnings,
      messengerConnectedByThisCheck: false,
    },
    whatsappCloud: {
      ...whatsappConfigSummary(),
      live: whatsapp,
    },
    deepseek,
    groupReaderConfigured: !!String(process.env.WHATSAPP_SERVICE_SECRET || '').trim(),
  });
}
