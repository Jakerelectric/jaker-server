# 匯入進銷存資料（單機版）：選 Google 試算表下載的 .xlsx → 覆蓋同名工作表 → 重新啟動服務
#   匯入前會自動備份目前資料到 data\backups\erp
$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $Root
$env:Path = [Environment]::GetEnvironmentVariable('Path','Machine') + ';' + [Environment]::GetEnvironmentVariable('Path','User')
Add-Type -AssemblyName System.Windows.Forms
$dlg = New-Object System.Windows.Forms.OpenFileDialog
$dlg.Title = '選擇從 Google 試算表下載的進銷存 .xlsx 檔'
$dlg.Filter = 'Excel 活頁簿 (*.xlsx)|*.xlsx'
if ($dlg.ShowDialog() -ne 'OK') { Write-Host '已取消'; exit 0 }
Write-Host "匯入：$($dlg.FileName)"
$ans = Read-Host '匯入會覆蓋系統裡同名工作表的資料（會先自動備份），確定嗎？(y/N)'
if ($ans -notmatch '^[Yy]') { Write-Host '已取消'; Read-Host '按 Enter 結束'; exit 0 }
& (Join-Path $Root 'stop-erp.ps1') -Quiet
& node tools\import-xlsx.js $dlg.FileName --app erp
$code = $LASTEXITCODE
$vbs = Join-Path ([Environment]::GetFolderPath('Startup')) '傑克電機進銷存.vbs'
if (Test-Path $vbs) { Start-Process wscript.exe -ArgumentList ('"' + $vbs + '"') }
if ($code -ne 0) { Write-Host '匯入失敗，請看上面的訊息。' -ForegroundColor Red } else { Write-Host '完成，服務已重新啟動。' -ForegroundColor Green }
Read-Host '按 Enter 結束'
