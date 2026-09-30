SKY CARS V8 - ADMIN + LIVE WHATSAPP TAKEOVER

Adds:
- Fix for /admin/login redirect loop.
- Protected admin dashboard.
- Real conversation inbox backed by Hostinger MySQL conversations/messages tables.
- AI / Human / Paused persistent modes.
- Take Over and Return to AI controls.
- Human WhatsApp replies sent through official Meta WhatsApp Cloud API.
- 5-second inbox refresh so incoming real messages appear in admin.
- Admin navigation and business dashboard.

Required Hostinger environment variables:
ADMIN_PASSWORD
DB_HOST
DB_PORT
DB_NAME
DB_USER
DB_PASSWORD
DEEPSEEK_API_KEY (for AI replies)
WHATSAPP_VERIFY_TOKEN
WHATSAPP_ACCESS_TOKEN
WHATSAPP_PHONE_NUMBER_ID

Important: The inbox shows REAL messages only after Meta WhatsApp webhook is configured to:
https://skyshcars.com/api/whatsapp/webhook
and verified with the same WHATSAPP_VERIFY_TOKEN.

Never commit the secret values to GitHub.
