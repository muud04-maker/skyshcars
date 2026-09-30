SKY CARS V5 - FAST DEPLOY

This package upgrades the live V4 project with:
- Hostinger MySQL-backed vehicles
- quote persistence
- contact/lead persistence
- shipment tracking + tracking events
- password-protected admin dashboard
- customers, quotes, shipments, vehicles and conversation views
- WhatsApp Cloud API webhook + DeepSeek grounded inventory replies
- Facebook Messenger webhook + DeepSeek grounded inventory replies
- AI/human conversation mode stored in MySQL
- approved vehicle-media support
- refreshed responsive storefront and licensed Unsplash showroom hero
- Next.js 16.3.7 Webpack build for Hostinger compatibility

FAST DEPLOY:
1. Extract this ZIP.
2. Right-click DEPLOY_NOW.ps1 -> Run with PowerShell, OR from PowerShell run:
   powershell -ExecutionPolicy Bypass -File .\DEPLOY_NOW.ps1
3. Hostinger auto-deploys after Git push.

HOSTINGER ENVIRONMENT VARIABLES ALREADY EXPECTED:
DB_HOST, DB_PORT, DB_NAME, DB_USER, DB_PASSWORD

ADD BEFORE USING ADMIN:
ADMIN_PASSWORD = choose a strong private password

ADD WHEN CONNECTING AI / META CHANNELS:
DEEPSEEK_API_KEY
META_VERIFY_TOKEN
META_APP_SECRET
META_PAGE_ACCESS_TOKEN
WHATSAPP_VERIFY_TOKEN
WHATSAPP_ACCESS_TOKEN
WHATSAPP_PHONE_NUMBER_ID
NEXT_PUBLIC_WHATSAPP_NUMBER

Never put real secrets into GitHub or .env.example.

POST-DEPLOY TESTS:
/api/health -> database should say connected
/vehicles -> should read MySQL inventory
/admin/login -> use ADMIN_PASSWORD
Submit /quote -> should appear in /admin/quotes
/tracking -> reads shipments/tracking_events from MySQL

IMPORTANT: Inventory photos are never fabricated. The hero uses a licensed Unsplash showroom photo. Vehicle-specific images appear only when approved vehicle_media records exist, preventing a wrong photo from being shown for a real stock item.
