$ErrorActionPreference='Stop'
$runner=Join-Path $PSScriptRoot 'RUN_GROUP_READER.ps1'
$task='SkyCarsGroupReader'
$action=New-ScheduledTaskAction -Execute 'powershell.exe' -Argument "-NoProfile -ExecutionPolicy Bypass -File `"$runner`""
$trigger=New-ScheduledTaskTrigger -AtLogOn
$principal=New-ScheduledTaskPrincipal -UserId $env:USERNAME -LogonType Interactive -RunLevel Highest
Register-ScheduledTask -TaskName $task -Action $action -Trigger $trigger -Principal $principal -Force | Out-Null
Write-Host "Installed startup task: $task" -ForegroundColor Green
Write-Host 'The first QR login should be completed manually before relying on startup.'
