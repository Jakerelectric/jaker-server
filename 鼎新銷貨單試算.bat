@echo off
chcp 65001 >nul
cd /d "%~dp0"
set "NODE=node"
where node >nul 2>nul || set "NODE=%ProgramFiles%\nodejs\node.exe"
echo 正在比對鼎新與系統的銷貨單（只讀，不會寫入），請稍候…
"%NODE%" tools\dingxin-sales-dryrun.js %1
if exist "data\dingxin-sales-dryrun.txt" start "" notepad "data\dingxin-sales-dryrun.txt"
echo.
echo 看完再按任意鍵關閉這個視窗。
pause >nul
