#!/bin/bash
# 更新程式（Mac）：從 GitHub 下載最新版 → 安裝套件 → 重新啟動服務。資料、.env 不會動。
cd "$(dirname "$0")"
export PATH="/opt/homebrew/bin:/opt/homebrew/opt/node@22/bin:$PATH"
LABEL="tw.jaker.server"
BEFORE="$(git rev-parse --short HEAD)"
git pull --ff-only || { echo "下載失敗（有改過程式檔案、或連不到 GitHub），請把畫面截圖給 IT。"; read -r -p "按 Enter 關閉視窗"; exit 1; }
npm ci --omit=dev --no-audit --no-fund
git rev-parse --short HEAD > data/version.txt
launchctl kickstart -k "gui/$(id -u)/$LABEL"
sleep 3
PORT="$(grep '^PORT=' .env | cut -d= -f2)"; PORT="${PORT:-8080}"
if curl -fs "http://127.0.0.1:$PORT/healthz" >/dev/null; then echo "已更新：$BEFORE → $(git rev-parse --short HEAD)"; else echo "新版沒有正常啟動，退回 $BEFORE"; git reset --hard "$BEFORE"; npm ci --omit=dev --no-audit --no-fund; launchctl kickstart -k "gui/$(id -u)/$LABEL"; fi
read -r -p "按 Enter 關閉視窗"
