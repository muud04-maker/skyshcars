# Sky Cars V30.1 Full Fix

This package is the consolidated follow-up to the V29 marketplace build. It preserves the existing Sky Cars production architecture and fixes the issues reported from the live screenshots.

## Main fixes

- Model-matched representative photo fallback for inventory that has no exact approved stock media; exact vehicle media always wins.
- Merged tools/manifests from the uploaded 248-vehicle / 5-photo master package.
- Google/Facebook/GitHub passwordless customer login and signup, with MySQL customer synchronization.
- Quote form with live vehicle selection, Africa country/port selection, automatic gateway and method behavior, required name/WhatsApp, optional email.
- Robust Admin vehicle status updates with safe status-schema migration and useful errors.
- Full Admin shipment CRUD + tracking-event creation.
- Rebuilt Automation Center controls and layout.
- Admin/Lab no longer show the public marketplace chrome.
- `/lab` owner-only fallback while Hostinger maps `lab.skyshcars.com` and its SSL certificate.

## Photo policy

Exact approved stock-unit photos have priority. When they do not exist, Sky Cars may show clearly labelled **Representative photo** imagery for browsing. The customer should receive/confirm current stock-unit photos before purchase.

## Social login

Configure `AUTH_SECRET` plus any enabled provider credentials in `.env` / Hostinger environment variables. Supported providers are Google, Facebook and GitHub. OAuth callbacks must use the production domain according to each provider's setup.

## Shipping reference

The bundled China→Africa route table is for estimation and destination selection. It is not a guaranteed live freight quote.

## Lab

Read `HOSTINGER_LAB_SETUP.txt`. `ERR_CONNECTION_CLOSED` on the subdomain is a Hostinger/DNS/SSL routing problem that happens before the Next.js application can answer. The package therefore keeps `https://skyshcars.com/lab` as an owner-only fallback when `LAB_PATH_FALLBACK=true`.

## Deployment

Run:

```powershell
powershell -ExecutionPolicy Bypass -File .\DEPLOY_NOW.ps1
```

The deployment script is expected to run install, TypeScript checking and `next build --webpack` before any commit/push. Do not deploy if those checks fail.
