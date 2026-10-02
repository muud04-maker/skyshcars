$ErrorActionPreference='Stop'
Set-Location $PSScriptRoot
if(-not (Test-Path '.env')){ throw '.env is missing. Run SETUP_GROUP_READER_WINDOWS.ps1 first.' }
$logDir=Join-Path $PSScriptRoot 'logs'; New-Item -ItemType Directory -Force -Path $logDir | Out-Null
$stamp=Get-Date -Format 'yyyyMMdd-HHmmss'
Write-Host 'Starting Sky Cars Group Reader. Keep this PC/VPS online.'
node .\server.js 2>&1 | Tee-Object -FilePath (Join-Path $logDir "bridge-$stamp.log")
