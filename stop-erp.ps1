# 停止這台電腦上的進銷存服務（匯入資料、更新程式前會用到）
param([switch]$Quiet)
$procs = Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Where-Object { $_.CommandLine -match 'src\\server\.js' }
foreach ($p in $procs) { Stop-Process -Id $p.ProcessId -Force -ErrorAction SilentlyContinue }
if (-not $Quiet) { if ($procs) { Write-Host '已停止服務' } else { Write-Host '服務沒有在執行' } }
Start-Sleep -Milliseconds 500
