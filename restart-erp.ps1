# 重新啟動這台電腦上的進銷存服務（更新程式後用）
$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $Root
& (Join-Path $Root 'stop-erp.ps1') -Quiet
$vbs = Join-Path ([Environment]::GetFolderPath('Startup')) '傑克電機進銷存.vbs'
if (-not (Test-Path $vbs)) { Write-Host '找不到自動啟動設定，請先執行「單機安裝.bat」。' -ForegroundColor Red; Read-Host '按 Enter 結束'; exit 1 }
Start-Process wscript.exe -ArgumentList ('"' + $vbs + '"')
$port = ((Get-Content .env | Where-Object { $_ -match '^PORT=' }) -replace 'PORT=','').Trim(); if (-not $port) { $port = '8080' }
for ($i = 0; $i -lt 30; $i++) { try { Invoke-WebRequest -UseBasicParsing "http://127.0.0.1:$port/healthz" -TimeoutSec 2 | Out-Null; Write-Host '已重新啟動，瀏覽器按 F5 重新整理即可。' -ForegroundColor Green; Start-Sleep 2; exit 0 } catch { Start-Sleep 1 } }
Write-Host '服務沒有啟動，請看 data\logs\server.log，或把畫面截圖給 Claude。' -ForegroundColor Red
Read-Host '按 Enter 結束'
