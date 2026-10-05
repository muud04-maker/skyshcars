import { adminDenied } from '../../../../lib/admin-guard';
import { needsSetupJson } from '../../../../lib/setup';
import { saveWelcomeConfig, welcomeConfig } from '../../../../lib/welcome';
import { saveStaffPauseMinutes, staffPauseMinutes } from '../../../../lib/staff';
export const dynamic = 'force-dynamic';

export async function GET() {
  const d = await adminDenied(); if (d) return d;
  const w = await welcomeConfig();
  return Response.json({ welcome: { enabled: w.enabled, group_link: w.groupLink, group_name: w.groupName, site: w.site }, staff_pause_minutes: await staffPauseMinutes() });
}

export async function POST(req: Request) {
  const d = await adminDenied(); if (d) return d;
  const b = await req.json().catch(() => ({}));
  try {
    const welcome = b.welcome ? await saveWelcomeConfig({ enabled: !!b.welcome.enabled, group_link: b.welcome.group_link, group_name: b.welcome.group_name }) : undefined;
    const minutes = b.staff_pause_minutes != null ? await saveStaffPauseMinutes(Number(b.staff_pause_minutes)) : undefined;
    return Response.json({ ok: true, welcome, staff_pause_minutes: minutes });
  } catch (e: any) {
    if (/group link/i.test(String(e?.message))) return Response.json({ error: e.message }, { status: 400 });
    return needsSetupJson();
  }
}
