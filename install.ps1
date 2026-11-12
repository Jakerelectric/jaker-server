# 傑克電機內部系統 — Windows 安裝腳本（測試機用）
# 用法：在資料夾裡對 install.bat 按右鍵 →「以系統管理員身分執行」
$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $Root
function Say($t) { Write-Host ''; Write-Host "== $t" -ForegroundColor Cyan }
function Fail($t) { Write-Host ''; Write-Host "!! $t" -ForegroundColor Red; Read-Host '按 Enter 結束'; exit 1 }

# 0. 必須用系統管理員身分
$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $isAdmin) { Fail '請對 install.bat 按右鍵，選「以系統管理員身分執行」。' }

# 1. Node.js
Say '1/6 檢查 Node.js'
$node = Get-Command node -ErrorAction SilentlyContinue
if (-not $node) { Fail '找不到 Node.js。請先到 https://nodejs.org 下載「LTS」版安裝（一路按下一步），裝好後重新執行本腳本。' }
$ver = (& node -v)
Write-Host "Node.js $ver ($($node.Source))"
if ([int]($ver.TrimStart('v').Split('.')[0]) -lt 20) { Fail 'Node.js 版本太舊，請安裝 20 版以上的 LTS。' }
if (-not (Get-Command curl.exe -ErrorAction SilentlyContinue)) { Fail '找不到 curl.exe（Windows 10 1803 以後內建）。' }

# 2. 程式套件
Say '2/6 檢查程式套件'
if (-not (Test-Path (Join-Path $Root 'node_modules\express'))) {
  Write-Host '下載套件中…'
  & npm install --omit=dev --no-audit --no-fund
  if ($LASTEXITCODE -ne 0) { Fail '套件安裝失敗，請確認這台電腦可以連上網路。' }
}
Write-Host '套件 OK'

# 3. 資料庫設定（.env）
Say '3/6 資料庫設定'
$envFile = Join-Path $Root '.env'
$writeEnv = $true
if (Test-Path $envFile) {
  $ans = Read-Host '已經有設定檔 .env，要沿用嗎？(Y/n)'
  if ($ans -eq '' -or $ans -match '^[Yy]') { $writeEnv = $false }
}
if ($writeEnv) {
  Write-Host '請先在 phpMyAdmin 執行 tools\create-db-user.sql 建立資料庫與帳號（直接按 Enter 用括號裡的預設值）。'
  $dbHost = Read-Host 'MySQL 位址 (127.0.0.1)'; if (-not $dbHost) { $dbHost = '127.0.0.1' }
  $dbPort = Read-Host 'MySQL 連接埠 (3306)'; if (-not $dbPort) { $dbPort = '3306' }
  $dbName = Read-Host '資料庫名稱 (jaker_apps)'; if (-not $dbName) { $dbName = 'jaker_apps' }
  $dbUser = Read-Host '帳號 (jaker_apps)'; if (-not $dbUser) { $dbUser = 'jaker_apps' }
  $sec = Read-Host '密碼（輸入時不會顯示）' -AsSecureString
  $dbPass = [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($sec))
  $port = Read-Host '網頁使用的連接埠 (8080)'; if (-not $port) { $port = '8080' }
  $lines = @(
    '# 傑克電機內部系統設定（含資料庫密碼，請勿外流）',
    "PORT=$port", "DB_HOST=$dbHost", "DB_PORT=$dbPort", "DB_NAME=$dbName", "DB_USER=$dbUser", "DB_PASSWORD=$dbPass",
    '# 測試期間 LINE 通知關閉（0）；正式上線改成 1',
    'LINE_ENABLED=0'
  )
  [IO.File]::WriteAllLines($envFile, $lines, (New-Object Text.UTF8Encoding($false)))
  # 只有系統管理員和系統帳號能讀這個檔案
  & icacls $envFile /inheritance:r /grant:r '*S-1-5-32-544:F' '*S-1-5-18:F' | Out-Null
}
& node tools\check-db.js
if ($LASTEXITCODE -ne 0) { Fail '資料庫連線失敗，請依上面的說明修正後重新執行（可以選擇不沿用 .env 重新輸入）。' }

# 4. 防火牆：讓公司內網其他電腦可以連
Say '4/6 防火牆'
$port = (Get-Content $envFile | Where-Object { $_ -match '^PORT=' }) -replace '^PORT=', ''
if (-not $port) { $port = '8080' }
Get-NetFirewallRule -DisplayName 'JakerServer' -ErrorAction SilentlyContinue | Remove-NetFirewallRule
New-NetFirewallRule -DisplayName 'JakerServer' -Direction Inbound -Protocol TCP -LocalPort $port -Action Allow -Profile Domain,Private | Out-Null
Write-Host "已開放內網連線 TCP $port（只限網域／私人網路）"

# 5. 開機自動啟動（工作排程器，系統帳號執行，當掉 1 分鐘後自動重啟）
Say '5/6 設定開機自動啟動'
$task = 'JakerServer'
Get-ScheduledTask -TaskName $task -ErrorAction SilentlyContinue | Unregister-ScheduledTask -Confirm:$false
$action = New-ScheduledTaskAction -Execute $node.Source -Argument 'src\server.js' -WorkingDirectory $Root
$trigger = New-ScheduledTaskTrigger -AtStartup
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable `
  -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) -ExecutionTimeLimit ([TimeSpan]::Zero)
$principal = New-ScheduledTaskPrincipal -UserId 'SYSTEM' -LogonType ServiceAccount -RunLevel Highest
Register-ScheduledTask -TaskName $task -Action $action -Trigger $trigger -Settings $settings -Principal $principal | Out-Null
Start-ScheduledTask -TaskName $task
Write-Host '已建立排程「JakerServer」並啟動'

# 6. 確認
Say '6/6 確認服務'
$ok = $false
for ($i = 0; $i -lt 15; $i++) {
  Start-Sleep -Seconds 1
  try { $r = Invoke-WebRequest -UseBasicParsing "http://127.0.0.1:$port/healthz" -TimeoutSec 3; if ($r.StatusCode -eq 200) { $ok = $true; break } } catch {}
}
if (-not $ok) { Fail "服務沒有啟動成功，請查看 $Root\data\logs\server.log 的最後幾行。" }
$ips = (Get-NetIPAddress -AddressFamily IPv4 | Where-Object { $_.IPAddress -notmatch '^(127\.|169\.254\.)' }).IPAddress
Write-Host ''
Write-Host '安裝完成！' -ForegroundColor Green
Write-Host "這台電腦：http://localhost:$port/pm/"
foreach ($ip in $ips) { Write-Host "公司內其他電腦：http://${ip}:$port/pm/" }
Write-Host ''
Write-Host '下一步：把 Google 試算表下載成 .xlsx，執行 import.bat 匯入資料。'
Read-Host '按 Enter 結束'
