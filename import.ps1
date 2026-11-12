# 匯入 Google 試算表下載的 .xlsx（會覆蓋同名工作表），匯入後自動重新啟動服務
$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $Root
Add-Type -AssemblyName System.Windows.Forms
$dlg = New-Object System.Windows.Forms.OpenFileDialog
$dlg.Title = '選擇從 Google 試算表下載的 .xlsx 檔'
$dlg.Filter = 'Excel 活頁簿 (*.xlsx)|*.xlsx'
if ($dlg.ShowDialog() -ne 'OK') { Write-Host '已取消'; exit 0 }
Write-Host "匯入：$($dlg.FileName)"
$ans = Read-Host '匯入會覆蓋測試系統裡同名的工作表資料，確定嗎？(y/N)'
if ($ans -notmatch '^[Yy]') { Write-Host '已取消'; Read-Host '按 Enter 結束'; exit 0 }
Stop-ScheduledTask -TaskName 'JakerServer' -ErrorAction SilentlyContinue
Start-Sleep -Seconds 2
& node tools\import-xlsx.js $dlg.FileName
$code = $LASTEXITCODE
Start-ScheduledTask -TaskName 'JakerServer' -ErrorAction SilentlyContinue
if ($code -ne 0) { Write-Host '匯入失敗，請看上面的訊息。' -ForegroundColor Red } else { Write-Host '完成，服務已重新啟動。' -ForegroundColor Green }
Read-Host '按 Enter 結束'
