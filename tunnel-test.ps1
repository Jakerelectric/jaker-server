# 臨時外部網址測試（Cloudflare Quick Tunnel，不需要帳號、不用改 DNS）
# 視窗開著的時候外面才連得到；關掉視窗就停止。每次網址都不一樣。
$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
$exe = Join-Path $Root 'tools\cloudflared.exe'
if (-not (Test-Path $exe)) {
  Write-Host '下載 cloudflared（Cloudflare 官方程式，約 60MB）…'
  [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
  Invoke-WebRequest -UseBasicParsing 'https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe' -OutFile $exe
}
$port = '8080'
$envFile = Join-Path $Root '.env'
if (Test-Path $envFile) { $p = (Get-Content $envFile | Where-Object { $_ -match '^PORT=' }) -replace '^PORT=', ''; if ($p) { $port = $p } }
Write-Host ''
Write-Host '啟動中…等一下會出現一行 https://xxxx.trycloudflare.com 的網址，' -ForegroundColor Cyan
Write-Host '在網址後面加上 /pm/ 就能從外面（手機 4G、家裡）打開。關掉這個視窗就停止。' -ForegroundColor Cyan
Write-Host ''
& $exe tunnel --no-autoupdate --url "http://localhost:$port"
