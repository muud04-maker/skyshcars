/*
  Part 9: admin-only DRY RUN of the AI reply. It never sends WhatsApp/Messenger, never writes an
  outbound message and never touches a production conversation: the conversation id used for the
  dry run is 0, so slot/current-car writes are skipped, and photo sending is disabled (dryRun).
*/
import { NextResponse } from 'next/server';
import { adminDenied } from '../../../../lib/admin-guard';
import { catalogCounts, loadAiCars } from '../../../../lib/ai-catalog';
import { matchVehicles } from '../../../../lib/ai-rules/match';
import { extractSlots } from '../../../../lib/ai-rules/slots';
import { decideReply } from '../../../../lib/ai-rules/reply-policy';
import { customerKey } from '../../../../lib/ai-rules/engine-core';
import { resolveReferral } from '../../../../lib/referrals';
import { welcomeAlreadySent, welcomeConfig } from '../../../../lib/welcome';
import { composeReply } from '../../../../lib/sales-compose';
import { rows } from '../../../../lib/db';

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  const d = await adminDenied(); if (d) return d;
  const b = await req.json().catch(() => ({}));
  const message = String(b.message || '').trim();
  if (!message) return NextResponse.json({ error: 'Type a customer message to test.' }, { status: 400 });
  const channel = b.channel === 'facebook' ? 'facebook' : 'whatsapp';
  const externalId = String(b.external_id || '255700000000');
  const messageType = String(b.message_type || 'text');

  const [cat, cars, wcfg] = await Promise.all([
    catalogCounts().catch(() => ({ mode: 'selected', aiCount: 0, availableCount: 0 })),
    loadAiCars(400).catch(() => []),
    welcomeConfig().catch(() => null),
  ]);
  const hints = await (async () => {
    try {
      const [c, p] = await Promise.all([
        rows<any>('SELECT name FROM countries WHERE active=1'),
        rows<any>('SELECT name FROM ports WHERE active=1'),
      ]);
      return { countries: c.map((x: any) => String(x.name)), ports: p.map((x: any) => String(x.name)) };
    } catch { return { countries: [] as string[], ports: [] as string[] }; }
  })();

  const match = matchVehicles(message, cars as any);
  const slots = extractSlots(message, hints, {});
  const referral = (b.referral_source_id || b.referral_headline)
    ? await resolveReferral(channel, { source_id: b.referral_source_id || null, headline: b.referral_headline || null }).catch(() => null)
    : null;
  const decision = decideReply({
    burst: [{ type: messageType, words: message, referral: !!referral }],
    firstContact: !!b.first_contact,
    lastOutbound: b.last_outbound || null,
    recipient: externalId,
  });
  const key = customerKey(channel, externalId);
  const alreadySent = await welcomeAlreadySent(key).catch(() => true);
  const welcomeDue = !!wcfg?.enabled && !alreadySent;

  const current = referral?.vehicle || (match.kind === 'one' ? match.vehicle : null);
  const composed = await composeReply({
    conversationId: 0, // 0 = dry run: no conversation is read or written
    burst: [{ id: 1, message_type: messageType, body: message, external_message_id: null }],
    words: message, firstContact: !!b.first_contact, welcomeDue, welcomeSent: !welcomeDue,
    referral: !!referral, referralVehicle: referral?.vehicle || null, referralAiEnabled: referral ? referral.aiEnabled : false,
    dryRun: true,
  }).catch((e: any) => ({ text: `[dry run failed: ${e?.message || e}]`, allowedNames: [] as string[] }));

  const photoCount = Number((current as any)?.exact_photo_count || 0);
  const photoAction = !current ? 'no vehicle matched - no photos would be sent'
    : photoCount ? `${photoCount} exact photo(s) available` : 'no exact photos - the AI would say so';

  return NextResponse.json({
    ok: true, dry_run: true, nothing_sent: true,
    catalog: cat,
    intent: decision,
    matched: match.kind === 'one' ? match.vehicle : null,
    candidates: match.kind === 'candidates' ? match.list : [],
    current_car: current || null,
    slots,
    referral: referral ? { matched: !!referral.vehicle, method: referral.method, vehicle_id: referral.vehicle?.id || null } : null,
    welcome: { enabled: !!wcfg?.enabled, already_sent: alreadySent, due: welcomeDue },
    photo_action: photoAction,
    allowed_names: (composed as any).allowedNames || [],
    needs_staff: messageType !== 'text' ? `${messageType} would be flagged for staff if it cannot be read` : null,
    reply: String((composed as any).text || ''),
  });
}
