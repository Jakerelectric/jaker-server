@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo 正在測試鼎新連線，請稍候（最多約 1 分鐘）…
echo.
node tools\dingxin-test.js
echo.
if exist "data\dingxin-test.txt" (
  echo 結果已用記事本打開，請把記事本的內容截圖或整份檔案傳給 Claude。
  start "" notepad "data\dingxin-test.txt"
)
echo.
echo 看完再按任意鍵關閉這個視窗。
pause >nul
