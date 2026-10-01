# Sky Cars V23.1 WhatsApp AI Reply Recovery — TypeScript Fix

This package fixes the V23 deployment-blocking TypeScript Blob/Buffer error in `src/lib/media-ai.ts`.

Deploy with:

```powershell
powershell -ExecutionPolicy Bypass -File .\DEPLOY_NOW.ps1
```

The deployment script must pass TypeScript and `next build --webpack` before it can commit or push.

# Sky Cars V20 PRO — Owner Control Center + Public Marketplace

Start with `OWNER_GUIDE_SIMPLE.md`, then `SKY_CARS_FULL_REPORT.pdf` (in the ZIP root).


Production domain: `https://skyshcars.com`

The website uses MySQL as the source of truth for inventory and operational data. This package extends the existing admin into a unified control center without replacing the working public website design.

## Admin
Open `/admin/login` and sign in with both `ADMIN_EMAIL` and `ADMIN_PASSWORD` from Hostinger Environment Variables.

The control center includes inventory, media, import review, customers, leads, quotes, shipments, documents, countries, ports, routes, rates, conversations/AI takeover, admin users, audit logs, settings and a Developer & Operations Center.

See `docs/ADMIN_CONTROL_CENTER.md` for the admin feature map and security model.

## Developer Center
`/admin/dev` includes a VS Code-style read-only project explorer plus safe production diagnostics. It does **not** expose an arbitrary browser shell or secret files.

## Database setup
Do not re-import a working production database blindly. For a brand-new database only, the schema files are under `database/`.

## Environment variables
See `.env.example`. Keep all real secret values in Hostinger, never GitHub.

## Build
The Hostinger-compatible build command remains:

```bash
npm run build
```

which maps to:

```bash
next build --webpack
```

Do not remove `--webpack` unless Hostinger's runtime compatibility is re-tested.

## Deploy
From the extracted package on the user's Windows machine:

```powershell
powershell -ExecutionPolicy Bypass -File .\DEPLOY_NOW.ps1
```

The deployment script installs dependencies and builds before it commits/pushes.

## Post-deploy checks
- `/api/health`
- `/admin/login`
- `/admin`
- `/admin/dev`
- `/api/vehicles`
- `/admin/whatsapp`

No feature should be considered production-verified until the Hostinger deployment and runtime checks pass.

## V24 WhatsApp Full Fix
V24 restores inbound WhatsApp delivery when WHATSAPP_APP_SECRET has not yet been configured by using a clearly reported compatibility mode, while automatically using strict signature verification once the secret is present. It also adds `/admin/whatsapp-health`, global 3-second inbox polling, a sticky human reply composer, and an **AI Reply Now** recovery button for unanswered messages.
