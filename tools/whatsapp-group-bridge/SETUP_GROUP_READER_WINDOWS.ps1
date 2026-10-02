$ErrorActionPreference='Stop'
Set-Location $PSScriptRoot
Write-Host 'Sky Cars Group Reader setup'
if(-not (Get-Command node -ErrorAction SilentlyContinue)){ throw 'Node.js is required. Install Node.js 20+ first.' }
if(-not (Test-Path '.env')){
  Copy-Item '.env.example' '.env'
  Write-Host 'Created .env. EDIT IT before running: SKY_CARS_URL and WHATSAPP_SERVICE_SECRET are required.' -ForegroundColor Yellow
}
npm install
Write-Host 'Setup complete. Next: edit .env, then run RUN_GROUP_READER.ps1 and scan the WhatsApp QR once.' -ForegroundColor Green
