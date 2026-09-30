# Sky Cars Admin Control Center

Protected entry point: `/admin/login`

## Main control areas
- Dashboard KPIs
- Vehicles and publishing status
- Vehicle media review
- Inventory-import / WhatsApp draft review
- Customers
- Leads
- Quotes
- Shipments and public tracking records
- Shipment documents
- Countries
- Ports
- Shipping routes
- Shipping rates
- WhatsApp / Facebook conversations
- AI / human / paused conversation mode
- Admin users
- Audit logs
- Environment configuration status
- Developer & Operations Center

## Developer & Operations Center
`/admin/dev` is designed to look and behave like a lightweight VS Code operations view without creating a web shell.

It provides:
- runtime and database status
- environment variable presence only (never values)
- MySQL record counts
- safe fixed diagnostics (DB ping, inventory summary, conversation summary)
- read-only source explorer for project source and selected configuration/docs

It intentionally blocks:
- arbitrary shell commands
- arbitrary SQL entered from the browser
- `.env*` secret files
- `.git`, `.next` and `node_modules`
- arbitrary filesystem paths

Deployment and source changes remain Git/GitHub -> Hostinger, which is substantially safer than exposing remote code execution through the public application.

## Required Hostinger variables
- DB_HOST
- DB_PORT
- DB_NAME
- DB_USER
- DB_PASSWORD
- ADMIN_EMAIL
- ADMIN_PASSWORD
- DEEPSEEK_API_KEY
- WHATSAPP_SERVICE_SECRET

Meta Cloud API / Messenger variables remain optional unless those channels are enabled.
