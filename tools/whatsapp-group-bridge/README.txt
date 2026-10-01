SKY CARS WHATSAPP GROUP BRIDGE

Why this exists:
Meta WhatsApp Cloud API handles direct business/customer messages but does not deliver ordinary WhatsApp group chat messages to the website webhook. This bridge uses an authenticated WhatsApp Web session to read the supplier group and securely send listing drafts to skyshcars.com.

First run:
1. Copy .env.example to .env.
2. Set WHATSAPP_SERVICE_SECRET to the exact same secret configured in Hostinger.
3. Set TARGET_GROUP_NAME to the exact supplier group name.
4. In PowerShell inside this folder run:
   powershell -ExecutionPolicy Bypass -File .\RUN_GROUP_BRIDGE.ps1
5. Scan the QR once.
6. New group posts appear in /admin/imports for approval.

Important:
This bridge must run on an always-on Windows/Linux computer or VPS. It is separate from the Hostinger Next.js app because WhatsApp Web requires a persistent browser session. It does not bypass WhatsApp security and only reads the account/group you authenticate.
