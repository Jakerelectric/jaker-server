# 匯出進銷存資料（單機版 → 公司主機）：停止服務 → 匯出到桌面「進銷存搬家資料-日期」資料夾
#   匯出後這台就不要再登錄資料，之後一律用公司主機的版本，免得兩邊資料不一樣
$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $Root
$env:Path = [Environment]::GetEnvironmentVariable('Path','Machine') + ';' + [Environment]::GetEnvironmentVariable('Path','User')
$Out = Join-Path ([Environment]::GetFolderPath('Desktop')) ('進銷存搬家資料-' + (Get-Date -Format 'yyyyMMdd-HHmm'))
& (Join-Path $Root 'stop-erp.ps1') -Quiet
& node tools\export-backup.js $Out
$code = $LASTEXITCODE
if ($code -ne 0) { Write-Host '匯出失敗，請看上面的訊息。' -ForegroundColor Red; Read-Host '按 Enter 結束'; exit 1 }
Write-Host ''
Write-Host "已匯出到桌面：$Out" -ForegroundColor Green
Write-Host '請把整個資料夾複製到公司主機，在主機上執行「啟用進銷存.bat」。'
Write-Host '這台的進銷存服務已停止；之後請改用公司主機的網址，不要再在這台登錄資料。' -ForegroundColor Yellow
Start-Process explorer.exe $Out
Read-Host '按 Enter 結束'
