# Sky Cars V27 FINAL

V27 combines the current Sky Cars production website, HGM catalogue integration, WhatsApp sales assistant, admin control center and the new automation/private-development layer.

## Main production stack

- Next.js 16.x + TypeScript
- MySQL
- Hostinger Node hosting
- GitHub `main`
- Required build command: `next build --webpack`
- Production domain: `https://skyshcars.com`
- Private development hostname: `https://lab.skyshcars.com`

## V27 Admin areas

Sales: Vehicles, Vehicle Photos, Inventory Review, Private Suppliers, Customers, Leads, Quotes.

Shipping: Shipments, Documents, Countries, Ports, Routes, Rates.

Communications: Inbox / Sales Assistant, AI Agent Health, WhatsApp Diagnostics, Sales Knowledge.

Automation: Automation Center, Group Reader, Campaigns, Social Publishing.

System: Backup / Export, Settings, Admin Users, Audit Logs, Dev Center.

Owner only: Private Development Lab.

## Automation behavior

When a vehicle becomes available, V27 can queue a campaign. The default is approval-first. Admin can enable Facebook and WhatsApp channels and choose whether manual publishing, WhatsApp-group approval or supplier publishing should trigger automation.

WhatsApp proactive vehicle updates are limited to customers explicitly marked as marketing opt-in and active within the last 24 hours. Supplier bulk auto-publishing is disabled by default.

## WhatsApp Group Reader

The group bridge lives in `tools/whatsapp-group-bridge`. It uses a linked WhatsApp session and sends only authorized group posts to the protected website endpoint. Authorized groups are managed in `/admin/group-reader`. Incoming listings remain drafts until review.

## Private Development Lab

The Lab runs under `lab.skyshcars.com`, uses a separate owner-only session cookie and is hidden from public navigation and search indexing. It stores application registry data in `lab_apps`, which the Sky Cars sales AI never queries.

The Lab can register education, grocery-delivery, research or other private applications. A registered app can be opened through a private Lab route and embedded from its deployment URL.

## Deployment

Run:

```powershell
powershell -ExecutionPolicy Bypass -File .\DEPLOY_NOW.ps1
```

The script checks the package, installs dependencies, runs TypeScript, builds with Webpack, commits and pushes only after successful checks.

Read `V27_READ_THIS_FIRST.txt` before deployment.
