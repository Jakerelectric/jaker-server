# 開／關 LINE 串接（要從 LINE Developers 複製 Channel access token 與 Channel secret）
$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $Root
Write-Host '1 = 開啟 LINE 串接（改由這台電腦收發 LINE 訊息）'
Write-Host '2 = 關閉 LINE 串接（回到 Apps Script 版時用）'
$c = Read-Host '請選擇'
# 去掉貼上時夾帶的控制字元與空白（例如按 Ctrl+V 產生的 ^V）
function Plain($s) { ([Runtime.InteropServices.Marshal]::PtrToStringBSTR([Runtime.InteropServices.Marshal]::SecureStringToBSTR($s))) -replace '[\x00-\x20\x7F]', '' }
if ($c -eq '1') {
  Write-Host ''
  Write-Host '到 LINE Developers → 專案系統的 Channel：'
  Write-Host '  「Basic settings」分頁最下方的 Channel secret'
  Write-Host '  「Messaging API」分頁最下方的 Channel access token（long-lived）'
  Write-Host '（貼上方式：在視窗裡按滑鼠右鍵，不要按 Ctrl+V；畫面不會顯示，貼上後直接按 Enter）'
  $env:JK_LINE_SECRET = Plain (Read-Host 'Channel secret' -AsSecureString)
  $env:JK_LINE_TOKEN = Plain (Read-Host 'Channel access token' -AsSecureString)
  $b = Read-Host '對外網址（直接按 Enter = https://work.jaker-ai.com）'
  if ($b) { $env:JK_PUBLIC_BASE = $b }
  & node tools\set-line.js on
} elseif ($c -eq '2') {
  & node tools\set-line.js off
} else { Write-Host '已取消'; Read-Host '按 Enter 結束'; exit 0 }
$code = $LASTEXITCODE
Remove-Item Env:JK_LINE_SECRET, Env:JK_LINE_TOKEN -ErrorAction SilentlyContinue
if ($code -eq 0) {
  Stop-ScheduledTask -TaskName 'JakerServer' -ErrorAction SilentlyContinue
  Start-Sleep -Seconds 2
  # 確認舊的程式真的停了，再啟動
  Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Where-Object { $_.CommandLine -like '*src\server.js*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
  Start-Sleep -Seconds 2
  Start-ScheduledTask -TaskName 'JakerServer'
  $port = ((Get-Content .env -Encoding UTF8 | Where-Object { $_ -match '^\s*PORT\s*=' } | Select-Object -First 1) -split '=', 2)[1]
  if (-not $port) { $port = '8080' }
  $want = if ($c -eq '1') { 'on' } else { 'off' }
  $h = $null
  for ($i = 0; $i -lt 20; $i++) { Start-Sleep -Seconds 2; try { $h = Invoke-RestMethod "http://127.0.0.1:$($port.Trim())/healthz" -TimeoutSec 3; break } catch {} }
  if (-not $h) { Write-Host '服務沒有啟動，請把 data\logs\server.log 最後幾行傳給 Claude。' -ForegroundColor Red }
  elseif ($h.line -eq $want) { Write-Host ("服務已重新啟動，LINE 串接：" + $(if ($want -eq 'on') { '開啟' } else { '關閉' })) -ForegroundColor Green }
  else { Write-Host ("服務已重新啟動，但 LINE 狀態是 " + $h.line + "（應該是 $want），請截圖給 Claude。") -ForegroundColor Red }
} else { Write-Host '沒有變更設定。' -ForegroundColor Red }
Read-Host '按 Enter 結束'
