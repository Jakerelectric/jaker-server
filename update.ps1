# 從 GitHub 下載最新版程式並更新（資料、.env、上傳的檔案都不會動）
# 更新失敗會自動還原成更新前的版本
$ErrorActionPreference = 'Stop'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $Root
$EnvFile = Join-Path $Root '.env'

function Get-EnvValue($key) {
  $line = Get-Content $EnvFile -Encoding UTF8 | Where-Object { $_ -match "^\s*$key\s*=" } | Select-Object -First 1
  if ($line) { return ($line -split '=', 2)[1].Trim() } else { return '' }
}
function Set-EnvValue($key, $value) {
  $lines = @(Get-Content $EnvFile -Encoding UTF8 | Where-Object { $_ -notmatch "^\s*$key\s*=" })
  $lines += "$key=$value"
  [IO.File]::WriteAllLines($EnvFile, $lines, (New-Object Text.UTF8Encoding $false))
}
function Done($msg, $color) { Write-Host $msg -ForegroundColor $color; Read-Host '按 Enter 結束'; exit 0 }

$Repo = Get-EnvValue 'GITHUB_REPO'; if (-not $Repo) { $Repo = 'Jakerelectric/jaker-server' }
# 權杖只會有英文、數字、底線；貼上時夾帶的控制字元（例如按 Ctrl+V 產生的 ^V）、空白一律去掉
function Clean-Token($t) { return ([string]$t -replace '[^A-Za-z0-9_]', '') }
function Valid-Token($t) { return $t -match '^(github_pat_|ghp_)[A-Za-z0-9_]{20,}$' }
$Token = Clean-Token (Get-EnvValue 'GITHUB_TOKEN')
if (-not (Valid-Token $Token)) {
  if ($Token) { Write-Host '.env 裡的 GitHub 權杖格式不對，請重新輸入。' -ForegroundColor Yellow }
  Write-Host '請輸入 GitHub 的唯讀權杖（只能讀取 jaker-server 這個儲存庫），之後會記在 .env。'
  Write-Host '貼上方式：在視窗裡按「滑鼠右鍵」（不要按 Ctrl+V）。畫面不會顯示，貼上後直接按 Enter。'
  $s = Read-Host 'GitHub 權杖' -AsSecureString
  $Token = Clean-Token ([Runtime.InteropServices.Marshal]::PtrToStringBSTR([Runtime.InteropServices.Marshal]::SecureStringToBSTR($s)))
  if (-not $Token) { Done '已取消' Yellow }
  if (-not (Valid-Token $Token)) { Done ('權杖格式不對（應該是 github_pat_ 開頭，目前讀到 ' + $Token.Length + ' 個字）。請重新複製後再執行一次。') Red }
  Set-EnvValue 'GITHUB_TOKEN' $Token
}
$H = @{ Authorization = "Bearer $Token"; 'User-Agent' = 'jaker-server-update'; Accept = 'application/vnd.github+json' }

# 1. 看 GitHub 上的最新版本
try { $c = Invoke-RestMethod "https://api.github.com/repos/$Repo/commits/main" -Headers $H }
catch {
  $code = 0
  if ($_.Exception.Response) { $code = [int]$_.Exception.Response.StatusCode }
  if ($code -eq 401 -or $code -eq 403 -or $code -eq 404) {
    Set-EnvValue 'GITHUB_TOKEN' ''
    Done ("GitHub 不接受這個權杖（HTTP $code）：可能過期、複製不完整，或沒有選到 jaker-server 儲存庫。已清除，下次執行會重新詢問。") Red
  }
  Done ("連不到 GitHub：" + $_.Exception.Message) Red
}
$New = $c.sha.Substring(0, 7)
$VerFile = Join-Path $Root 'data\version.txt'
$Old = if (Test-Path $VerFile) { (Get-Content $VerFile -Raw).Trim() } else { '' }
Write-Host "目前版本：$(if ($Old) { $Old } else { '（未知）' })　最新版本：$New　$($c.commit.message.Split("`n")[0])"
if ($Old -eq $New) { Done '已經是最新版，不用更新。' Green }

# 2. 下載並解壓縮
$Tmp = Join-Path $env:TEMP ('jaker-update-' + [Guid]::NewGuid().ToString('N').Substring(0, 8))
New-Item -ItemType Directory $Tmp | Out-Null
Write-Host '下載中…'
Invoke-WebRequest "https://api.github.com/repos/$Repo/zipball/main" -Headers $H -OutFile "$Tmp\src.zip" -UseBasicParsing
Expand-Archive "$Tmp\src.zip" "$Tmp\x"
$Src = (Get-ChildItem "$Tmp\x" -Directory | Select-Object -First 1).FullName
if (-not (Test-Path "$Src\src\server.js")) { Done '下載的檔案不完整，沒有更新。' Red }

# 3. 備份目前的程式（保留最近 5 份）
$Stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$Bak = Join-Path $Root "data\versions\$Stamp-$(if ($Old) { $Old } else { 'old' })"
New-Item -ItemType Directory $Bak -Force | Out-Null
$Keep = @('.env', 'data', 'node_modules', '.git')
Get-ChildItem $Root -Force | Where-Object { $Keep -notcontains $_.Name } | Copy-Item -Destination $Bak -Recurse -Force
Get-ChildItem (Join-Path $Root 'data\versions') -Directory | Sort-Object Name -Descending | Select-Object -Skip 5 | Remove-Item -Recurse -Force

function Copy-Code($from) {
  robocopy $from $Root /E /NFL /NDL /NJH /NJS /NP /XD (Join-Path $from 'data') (Join-Path $from 'node_modules') (Join-Path $from '.git') /XF .env | Out-Null
  if ($LASTEXITCODE -ge 8) { throw "複製檔案失敗（robocopy $LASTEXITCODE）" }
}
function Wait-Healthy {
  $port = Get-EnvValue 'PORT'; if (-not $port) { $port = '8080' }
  for ($i = 0; $i -lt 30; $i++) {
    Start-Sleep -Seconds 2
    try { $r = Invoke-RestMethod "http://127.0.0.1:$port/healthz" -TimeoutSec 3; if ($r.ok) { return $true } } catch {}
  }
  return $false
}

# 4. 停止服務 → 換程式 → 需要的話安裝套件 → 啟動
$LockOld = if (Test-Path "$Root\package-lock.json") { (Get-FileHash "$Root\package-lock.json").Hash } else { '' }
Write-Host '停止服務、更新程式…'
Stop-ScheduledTask -TaskName 'JakerServer' -ErrorAction SilentlyContinue
Start-Sleep -Seconds 3
$ok = $false
try {
  Copy-Code $Src
  if ((Get-FileHash "$Root\package-lock.json").Hash -ne $LockOld) {
    Write-Host '安裝新的套件…'
    & npm ci --omit=dev --no-audit --no-fund
    if ($LASTEXITCODE -ne 0) { throw 'npm 安裝失敗' }
  }
  Start-ScheduledTask -TaskName 'JakerServer'
  $ok = Wait-Healthy
} catch { Write-Host $_.Exception.Message -ForegroundColor Red }

if ($ok) {
  New-Item -ItemType Directory (Split-Path $VerFile) -Force | Out-Null
  Set-Content $VerFile $New
  Remove-Item $Tmp -Recurse -Force -ErrorAction SilentlyContinue
  Done "更新完成：$New，服務正常運作。" Green
}

# 5. 失敗：還原
Write-Host '新版啟動失敗，還原成更新前的版本…' -ForegroundColor Yellow
Stop-ScheduledTask -TaskName 'JakerServer' -ErrorAction SilentlyContinue
Start-Sleep -Seconds 3
Copy-Code $Bak
if ((Get-FileHash "$Root\package-lock.json").Hash -ne (Get-FileHash "$Src\package-lock.json").Hash) { & npm ci --omit=dev --no-audit --no-fund | Out-Null }
Start-ScheduledTask -TaskName 'JakerServer'
if (Wait-Healthy) { Done '已還原，服務正常運作。請把 data\logs\server.log 最後幾行傳給 Claude。' Yellow }
Done '還原後服務仍未啟動，請把 data\logs\server.log 最後幾行傳給 Claude。' Red
