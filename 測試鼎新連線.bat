@echo off
chcp 65001 >nul
cd /d "%~dp0"
set "NODE=node"
where node >nul 2>nul || set "NODE=%ProgramFiles%\nodejs\node.exe"
echo 正在測試鼎新連線，請稍候（最多約 1 分鐘）…
echo.
"%NODE%" tools\dingxin-test.js
if errorlevel 9009 echo 找不到 Node.js，請把這個畫面截圖給 Claude。
echo.
if exist "data\dingxin-test.txt" (
  echo 結果已用記事本打開，請把記事本的內容截圖或整份檔案傳給 Claude。
  start "" notepad "data\dingxin-test.txt"
) else (
  echo 沒有產生結果檔，請把這個黑色視窗截圖給 Claude。
)
echo.
echo 看完再按任意鍵關閉這個視窗。
pause >nul
