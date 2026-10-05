# Sky Cars

Sky Cars sells cars and motorcycles for export. This repo is the Next.js site, hosted on Hostinger with a MySQL database. It includes:

- the public website and customer accounts (email/password and Google sign-in);
- the admin Control Center (`/admin`);
- WhatsApp AI sales replies (Meta Cloud API webhook, `src/app/api/whatsapp/webhook`, `src/lib/ai.ts`);
- a Facebook publisher (`src/lib/facebook.ts`, `src/lib/social.ts`);
- the WhatsApp Group Reader: a separate Node bridge in `tools/whatsapp-group-bridge` that reads authorized supplier groups and posts them to `/api/bridge/whatsapp-group`.

Checks: `npx tsc --noEmit` and `npm run build` must pass after every change.

## Rules

- Never commit real secrets. Use only the existing environment variable names and aliases.
- Missing settings must never crash a page or request. Only the admin Readiness page names what is missing.
- Never push and never touch `main`. Make local commits on the current branch only.
- Never claim something works if it needs a live account, a real WhatsApp message, a Meta token or the Group Reader server to verify. Mark it "needs manual test".
