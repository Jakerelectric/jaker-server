@echo off
chcp 65001 >nul
cd /d "%~dp0"
set "NODE=node"
where node >nul 2>nul || set "NODE=%ProgramFiles%\nodejs\node.exe"
echo 正在產生舊料號→鼎新品號的對照清單（只讀，不會寫入），請稍候…
"%NODE%" tools\dingxin-rename-list.js
if exist "data\dingxin-rename-report.txt" start "" notepad "data\dingxin-rename-report.txt"
if exist "data\dingxin-rename.txt" start "" notepad "data\dingxin-rename.txt"
echo.
echo 看完再按任意鍵關閉這個視窗。
pause >nul
