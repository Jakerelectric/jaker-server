# 進銷存系統「這台電腦單機版」安裝：不用 MySQL、不用系統管理員權限
#   雙擊 單機安裝.bat 執行。可以重複執行：已經裝好的會略過，.env 與資料不會被覆蓋。
#   只有這台電腦自己打得開（http://127.0.0.1:8080/erp/）；資料存在 data\erp-db。
$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $Root
function Step($t){ Write-Host "`n▶ $t" -ForegroundColor Cyan }
function Ok($t){ Write-Host "  ✓ $t" -ForegroundColor Green }
function RefreshPath { $env:Path = [Environment]::GetEnvironmentVariable('Path','Machine') + ';' + [Environment]::GetEnvironmentVariable('Path','User') }

Step '1/4 檢查 Node.js'
RefreshPath
if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  Write-Host '  這台電腦還沒有 Node.js，現在安裝（可能會跳出「是否允許變更」，請按「是」）…'
  try { winget install -e --id OpenJS.NodeJS.LTS --accept-package-agreements --accept-source-agreements --silent } catch { Write-Host '  找不到 winget。' }
  RefreshPath
  if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    Write-Host '  自動安裝沒有成功。請到 https://nodejs.org 下載「LTS」版安裝（一路按下一步），再執行一次 單機安裝.bat。' -ForegroundColor Red
    Read-Host '按 Enter 結束'; exit 1
  }
}
Ok ("Node.js " + (node -v))

Step '2/4 安裝程式套件'
& npm ci --omit=dev --no-audit --no-fund
if ($LASTEXITCODE -ne 0) { Write-Host '  套件安裝失敗，請把畫面截圖給 Claude。' -ForegroundColor Red; Read-Host '按 Enter 結束'; exit 1 }
Ok '套件已安裝'

Step '3/4 設定'
if (-not (Test-Path .env)) {
  @"
# 進銷存系統 單機版設定
APPS=erp
STORE=file
PORT=8080
HOST=127.0.0.1
"@ | Set-Content -Encoding UTF8 .env
  Ok '已建立 .env（單機版：資料存在 data\erp-db，只有這台電腦能開）'
} else { Ok '已有 .env，沿用' }
New-Item -ItemType Directory -Force -Path (Join-Path $Root 'data\logs') | Out-Null

Step '4/4 設定開機自動啟動並啟動服務'
$startup = [Environment]::GetFolderPath('Startup')
$vbs = Join-Path $startup '傑克電機進銷存.vbs'
$cmd = 'cmd /c cd /d ""' + $Root + '"" && node src\server.js >> data\logs\console.log 2>&1'
"Set sh = CreateObject(""WScript.Shell"")`r`nsh.Run ""$cmd"", 0, False" | Set-Content -Encoding Unicode $vbs
& (Join-Path $Root 'stop-erp.ps1') -Quiet
Start-Process wscript.exe -ArgumentList ('"' + $vbs + '"')
$port = ((Get-Content .env | Where-Object { $_ -match '^PORT=' }) -replace 'PORT=','').Trim(); if (-not $port) { $port = '8080' }
$up = $false
for ($i = 0; $i -lt 30; $i++) { try { Invoke-WebRequest -UseBasicParsing "http://127.0.0.1:$port/healthz" -TimeoutSec 2 | Out-Null; $up = $true; break } catch { Start-Sleep 1 } }
if (-not $up) { Write-Host '  服務沒有啟動，請看 data\logs\server.log，或把畫面截圖給 Claude。' -ForegroundColor Red; Read-Host '按 Enter 結束'; exit 1 }
Ok '服務已啟動（之後開機登入會自動啟動，不會出現視窗）'
Write-Host "`n完成！瀏覽器打開：http://127.0.0.1:$port/erp/   （建議加到書籤）" -ForegroundColor Green
Write-Host '下一步：從 Google 試算表下載 .xlsx，雙擊「匯入進銷存資料.bat」匯入。'
Start-Process "http://127.0.0.1:$port/erp/"
Read-Host '按 Enter 結束'
