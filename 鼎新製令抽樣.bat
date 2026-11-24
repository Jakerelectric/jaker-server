@echo off
chcp 65001 >nul
cd /d "%~dp0"
set "NODE=node"
where node >nul 2>nul || set "NODE=%ProgramFiles%\nodejs\node.exe"
echo 正在抽樣鼎新製令資料（只讀，不會寫入），請稍候…
"%NODE%" tools\dingxin-mo-sample.js %1
if exist "data\dingxin-mo-sample.txt" start "" notepad "data\dingxin-mo-sample.txt"
echo.
echo 看完再按任意鍵關閉這個視窗。
pause >nul
