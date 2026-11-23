@echo off
chcp 65001 >nul
cd /d "%~dp0"
set "NODE=node"
where node >nul 2>nul || set "NODE=%ProgramFiles%\nodejs\node.exe"
echo 正在讀取鼎新資料樣本（只讀），請稍候…
"%NODE%" tools\dingxin-sample.js
if exist "data\dingxin-sample.txt" start "" notepad "data\dingxin-sample.txt"
echo.
echo 看完再按任意鍵關閉這個視窗。
pause >nul
