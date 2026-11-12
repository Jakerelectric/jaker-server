# 把從 Google Drive 下載的「專案照片」資料夾搬進這台電腦，並把資料庫裡的 Google Drive 連結換成本機連結
$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $Root
Add-Type -AssemblyName System.Windows.Forms
$dlg = New-Object System.Windows.Forms.FolderBrowserDialog
$dlg.Description = '選擇從 Google Drive 下載並解壓縮後的資料夾（裡面要有 drive-manifest.json）'
if ($dlg.ShowDialog() -ne 'OK') { Write-Host '已取消'; Read-Host '按 Enter 結束'; exit 0 }
Write-Host "來源：$($dlg.SelectedPath)"
Stop-ScheduledTask -TaskName 'JakerServer' -ErrorAction SilentlyContinue
Start-Sleep -Seconds 2
& node tools\import-drive.js $dlg.SelectedPath
$code = $LASTEXITCODE
Start-ScheduledTask -TaskName 'JakerServer' -ErrorAction SilentlyContinue
if ($code -ne 0) { Write-Host '搬移失敗，請看上面的訊息。' -ForegroundColor Red } else { Write-Host '完成，服務已重新啟動。' -ForegroundColor Green }
Read-Host '按 Enter 結束'
