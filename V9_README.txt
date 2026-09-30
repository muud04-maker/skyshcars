SKY CARS V9 COMPLETE
=====================
This package consolidates the requested work instead of another tiny patch.

PUBLIC WEBSITE
- Sales-first positioning: Sky Cars sells cars and motorcycles; export is support after purchase.
- Removes public "198 imported inventory" and "AI + Human" internal wording.
- Removes unfinished Account link from public navigation.
- Light-blue visual system with different subtle page backgrounds.
- Real inventory photos only; missing stock photos use a neutral Sky Cars placeholder.

ADMIN
- Admin dashboard no longer crashes when DB configuration is missing; it shows a setup warning.
- Vehicle management: add, edit, status control, hide, price/spec fields, matching image URL.
- Customers, quotes, tracking and system sections preserved.
- WhatsApp/Facebook conversation desk preserved.
- AI / Human / Paused mode persists in MySQL.
- Human WhatsApp reply uses Meta Cloud API once Meta credentials are configured.
- Settings page shows whether required environment variables are configured WITHOUT displaying secrets.

DATABASE
Required Hostinger environment variable KEYS:
ADMIN_PASSWORD
DB_HOST
DB_PORT
DB_NAME
DB_USER
DB_PASSWORD

Optional integrations:
DEEPSEEK_API_KEY
WHATSAPP_VERIFY_TOKEN
WHATSAPP_ACCESS_TOKEN
WHATSAPP_PHONE_NUMBER_ID
NEXT_PUBLIC_WHATSAPP_NUMBER

Use /api/health after deployment. It reports missing variable NAMES, never their secret values.

IMPORTANT ABOUT VS CODE IN HOSTINGER
The current Hostinger managed Web App is production hosting, not a persistent VS Code Server machine.
No Next.js ZIP can turn that managed Web App into browser VS Code.
For VS Code itself inside Hostinger you need a Hostinger VPS/code-server environment. The current public site can remain on Web App hosting; a VPS can be added later for browser development/long-running services if desired.
Do not migrate the working production site just to obtain an editor.

DEPLOY
Extract this ZIP, open PowerShell in the v4 folder, run:
powershell -ExecutionPolicy Bypass -File .\DEPLOY_NOW.ps1
The script WILL NOT push if npm install or npm run build fails.
