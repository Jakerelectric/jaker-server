# 公司主機：開啟進銷存系統（跟專案系統同一個服務、同一個 MySQL）
#   1. .env 加上 APPS=pm,erp     2. 匯入筆電匯出的 erp-backup.json（可略過，略過就是空白系統）
#   3. 複製附件（erp-drive）       4. 防火牆允許同網段連線         5. 重新啟動 JakerServer
#   用法：對「啟用進銷存.bat」按右鍵 →「以系統管理員身分執行」
$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $Root
$env:Path = [Environment]::GetEnvironmentVariable('Path','Machine') + ';' + [Environment]::GetEnvironmentVariable('Path','User')
function Say($t) { Write-Host ''; Write-Host "== $t" -ForegroundColor Cyan }
function Fail($t) { Write-Host ''; Write-Host "!! $t" -ForegroundColor Red; Read-Host '按 Enter 結束'; exit 1 }
$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $isAdmin) { Fail '請對「啟用進銷存.bat」按右鍵，選「以系統管理員身分執行」。' }
$EnvFile = Join-Path $Root '.env'
if (-not (Test-Path $EnvFile)) { Fail '找不到 .env，這台好像還沒安裝專案系統（請先執行 install.bat）。' }
if (-not (Test-Path (Join-Path $Root 'apps\erp\Code.gs'))) { Fail '程式還是舊版，請先執行 update.bat（或網頁上的「系統更新」）再來。' }
$lines = @(Get-Content $EnvFile -Encoding UTF8)
function Get-EnvValue($key) { $l = $lines | Where-Object { $_ -match "^\s*$key\s*=" } | Select-Object -First 1; if ($l) { ($l -split '=', 2)[1].Trim() } else { '' } }
if ((Get-EnvValue 'STORE') -eq 'file') { Fail '這台的 .env 是 STORE=file（單機版），不是公司主機。' }
$port = Get-EnvValue 'PORT'; if (-not $port) { $port = '8080' }

Say '1/5 設定 .env（APPS=pm,erp）'
$apps = @((Get-EnvValue 'APPS') -split '[,\s]+' | Where-Object { $_ })
if (-not $apps.Count) { $apps = @('pm') }
if ($apps -notcontains 'erp') { $apps += 'erp' }
$new = @($lines | Where-Object { $_ -notmatch '^\s*APPS\s*=' }) + ('APPS=' + ($apps -join ','))
[IO.File]::WriteAllLines($EnvFile, $new, (New-Object Text.UTF8Encoding $false))
Write-Host ('APPS=' + ($apps -join ','))

Say '2/5 停止服務'
Stop-ScheduledTask -TaskName 'JakerServer' -ErrorAction SilentlyContinue
Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Where-Object { $_.CommandLine -like '*src\server.js*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
Start-Sleep -Seconds 3

Say '3/5 匯入資料'
Add-Type -AssemblyName System.Windows.Forms
$dlg = New-Object System.Windows.Forms.OpenFileDialog
$dlg.Title = '選擇筆電匯出的 erp-backup.json（按取消＝不匯入）'
$dlg.Filter = '進銷存備份 (*.json)|*.json'
if ($dlg.ShowDialog() -eq 'OK') {
  $ans = Read-Host "匯入「$($dlg.FileName)」會覆蓋主機上進銷存的資料（會先自動備份），確定嗎？(y/N)"
  if ($ans -match '^[Yy]') {
    & node tools\import-backup.js $dlg.FileName --app erp
    if ($LASTEXITCODE -ne 0) { Start-ScheduledTask -TaskName 'JakerServer'; Fail '匯入失敗，請把上面的訊息截圖給 Claude。（服務已重新啟動，專案系統不受影響）' }
    $drive = Join-Path (Split-Path $dlg.FileName) 'erp-drive'
    if (Test-Path $drive) {
      robocopy $drive (Join-Path $Root 'data\erp-drive') /E /NFL /NDL /NJH /NJS /NP | Out-Null
      if ($LASTEXITCODE -ge 8) { Write-Host '附件複製失敗，請手動把 erp-drive 資料夾複製到 data\erp-drive' -ForegroundColor Yellow } else { Write-Host '附件已複製到 data\erp-drive' }
    }
  } else { Write-Host '沒有匯入' }
} else { Write-Host '沒有匯入（之後可以再執行一次這個檔案匯入）' }

Say '4/5 防火牆：允許公司內網（同網段）連線'
Get-NetFirewallRule -DisplayName 'JakerServer-LAN' -ErrorAction SilentlyContinue | Remove-NetFirewallRule
New-NetFirewallRule -DisplayName 'JakerServer-LAN' -Direction Inbound -Protocol TCP -LocalPort $port -Action Allow -Profile Any -RemoteAddress LocalSubnet | Out-Null
Write-Host "已開放 TCP $port（只限同網段）"

Say '5/5 啟動服務'
Start-ScheduledTask -TaskName 'JakerServer'
$ok = $false
for ($i = 0; $i -lt 30; $i++) {
  Start-Sleep -Seconds 2
  try { $r = Invoke-RestMethod "http://127.0.0.1:$port/healthz" -TimeoutSec 3; if ($r.ok -and ($r.apps -contains 'erp')) { $ok = $true; break } } catch {}
}
if (-not $ok) { Fail '服務沒有啟動，請把 data\logs\server.log 最後幾行傳給 Claude。' }
$ips = @(Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue | Where-Object { $_.IPAddress -notmatch '^(127\.|169\.254\.)' -and $_.PrefixOrigin -ne 'WellKnown' } | Select-Object -ExpandProperty IPAddress)
Write-Host ''
Write-Host '完成！進銷存系統已開啟（只限公司內網）。' -ForegroundColor Green
Write-Host '同仁在公司電腦的瀏覽器輸入：'
foreach ($ip in $ips) { Write-Host "   http://${ip}:$port/erp/" -ForegroundColor Yellow }
Write-Host '用行政服務的員工編號＋密碼登入；第一次登入的同仁要先由管理員在「帳號」裡開權限。'
Read-Host '按 Enter 結束'
