/*
  One neutral message for anything that cannot run because setup is incomplete.
  Variable names are shown ONLY on the admin Readiness page (/admin/launch); customers never see setup text.
*/
export const NEEDS_SETUP_MSG = 'This section needs setup. Open Sell Now → Readiness to see what is missing.';
export function needsSetupJson() { return Response.json({ error: NEEDS_SETUP_MSG, needsSetup: true }, { status: 503 }); }
