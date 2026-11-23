@echo off
chcp 65001 >nul
cd /d "%~dp0"
set "NODE=node"
where node >nul 2>nul || set "NODE=%ProgramFiles%\nodejs\node.exe"
echo 正在比對鼎新與系統的訂單、採購單、品號、客戶、庫存（只讀，不會寫入），請稍候…
"%NODE%" tools\dingxin-all-dryrun.js %1
if exist "data\dingxin-all-dryrun.txt" start "" notepad "data\dingxin-all-dryrun.txt"
echo.
echo 看完再按任意鍵關閉這個視窗。
pause >nul
