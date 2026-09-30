# Sky Cars V10

One system. The **database is the only inventory**. The website and the WhatsApp AI both read it.

```
You (admin)  →  skyshcars.com/admin/vehicles  →  MySQL database
                                                   ↑          ↑
                        Website (/cars, /vehicles) ┘          └ WhatsApp AI (Cloud API + DeepSeek)
```

Add a car in the admin → it appears on the website → the AI can answer about it.
Mark it Sold → it disappears from the website → the AI says it's sold.

## What changed from V9
- Removed the WhatsApp group reader (`services/whatsapp`, whatsapp-web.js). No Chrome, no QR sessions.
- `/cars` and `/motorcycles` now read the database (they used to read the old inventory.json file).
- The site no longer silently falls back to the old JSON file when the database has an error,
  so a sold car can never reappear as available.
- WhatsApp AI now: understands "RAV4?" / "SC127" / "toyota 2021"; remembers the conversation;
  looks up shipping ports + confirmed rates by country/port; looks up tracking references;
  includes links to the vehicle page; never quotes unconfirmed shipping prices.
- Webhook security: Meta signature checked with META_APP_SECRET; Meta retries are not processed twice.
- Photos/voice notes are stored in the inbox (AI acknowledges them; staff can follow up).
- New WhatsApp contacts are automatically added to Customers with their WhatsApp name.
- Admin vehicles: one-click status dropdown (Available / Reserved / Sold / Pending / Hidden) and a status filter.

## First-time database setup (Hostinger → Databases → phpMyAdmin)
Only if these tables don't exist yet. Import in this order:
1. `database/Sky_Cars_Hostinger_MySQL_Master_Schema.sql`
2. `database/Sky_Cars_Import_198_Vehicles_Africa_Markets.sql`

Both are safe to re-run (they skip what already exists).

## Environment variables
See `.env.example` for the key names. Set values in Hostinger, never in GitHub.

## Deploy
```
powershell -ExecutionPolicy Bypass -File .\DEPLOY_NOW.ps1
```
It will not push if the build fails.

## After deploy, check
- `/api/health` → `"database":"connected"`
- `/cars` → shows the number of cars in the database
- `/admin/login` → log in, change a car to Sold, confirm it disappears from `/cars`

## WhatsApp Cloud API webhook (in Meta developer dashboard)
- Callback URL: `https://skyshcars.com/api/whatsapp/webhook`
- Verify token: the same value as `WHATSAPP_VERIFY_TOKEN`
- Subscribe to: `messages`
