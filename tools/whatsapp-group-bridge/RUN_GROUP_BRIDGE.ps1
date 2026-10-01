$ErrorActionPreference='Stop'
Write-Host 'Sky Cars WhatsApp Group Bridge'
if (!(Test-Path '.env')) { Copy-Item '.env.example' '.env'; Write-Host 'Created .env. Open it, set WHATSAPP_SERVICE_SECRET and TARGET_GROUP_NAME, then run this command again.'; exit 1 }
npm install
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
npm start
