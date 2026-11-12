# 開／關 LINE 串接（要從 LINE Developers 複製 Channel access token 與 Channel secret）
$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $Root
Write-Host '1 = 開啟 LINE 串接（改由這台電腦收發 LINE 訊息）'
Write-Host '2 = 關閉 LINE 串接（回到 Apps Script 版時用）'
$c = Read-Host '請選擇'
function Plain($s) { [Runtime.InteropServices.Marshal]::PtrToStringBSTR([Runtime.InteropServices.Marshal]::SecureStringToBSTR($s)) }
if ($c -eq '1') {
  Write-Host ''
  Write-Host '到 LINE Developers → 專案系統的 Channel：'
  Write-Host '  「Basic settings」分頁最下方的 Channel secret'
  Write-Host '  「Messaging API」分頁最下方的 Channel access token（long-lived）'
  Write-Host '（貼上時畫面不會顯示，按右鍵即可貼上）'
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
  Start-ScheduledTask -TaskName 'JakerServer'
  Write-Host '服務已重新啟動。' -ForegroundColor Green
} else { Write-Host '沒有變更設定。' -ForegroundColor Red }
Read-Host '按 Enter 結束'
