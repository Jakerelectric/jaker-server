#!/bin/bash
# 匯入進銷存資料（Mac）：選 Google 試算表下載的 .xlsx → 覆蓋系統裡同名的工作表 → 重新啟動服務
#   匯入前會自動備份目前的資料到 data/backups/erp
cd "$(dirname "$0")"
export PATH="/opt/homebrew/bin:/opt/homebrew/opt/node@22/bin:$PATH"
FILE="$(osascript -e 'POSIX path of (choose file with prompt "選擇從 Google 試算表下載的進銷存 .xlsx 檔" of type {"org.openxmlformats.spreadsheetml.sheet"})' 2>/dev/null)"
[ -z "$FILE" ] && { echo "已取消"; exit 0; }
echo "匯入：$FILE"
read -r -p "匯入會覆蓋系統裡同名工作表的資料（會先自動備份），確定嗎？(y/N) " ANS
[[ "$ANS" =~ ^[Yy]$ ]] || { echo "已取消"; exit 0; }
LABEL="tw.jaker.server"
launchctl bootout "gui/$(id -u)/$LABEL" >/dev/null 2>&1 || true
sleep 1
node tools/import-xlsx.js "$FILE" --app erp; CODE=$?
launchctl bootstrap "gui/$(id -u)" "$HOME/Library/LaunchAgents/$LABEL.plist" >/dev/null 2>&1 || launchctl kickstart -k "gui/$(id -u)/$LABEL"
if [ $CODE -ne 0 ]; then echo "匯入失敗，請看上面的訊息。"; else echo "完成，服務已重新啟動。"; fi
read -r -p "按 Enter 關閉視窗"
