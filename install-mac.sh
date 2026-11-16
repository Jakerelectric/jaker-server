#!/bin/bash
# 傑克電機內部系統：Mac 安裝（進銷存系統，只在公司內網使用）
#   在「終端機」執行：bash install-mac.sh
#   會做的事：安裝 Homebrew、Node.js、MySQL → 建立資料庫與專用帳號 → 安裝套件 → 設定開機（登入）自動啟動
#   可以重複執行：已經裝好的會略過，.env 與資料不會被覆蓋。
set -e
cd "$(dirname "$0")"
ROOT="$(pwd)"
LABEL="tw.jaker.server"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
say() { printf '\n\033[1;34m▶ %s\033[0m\n' "$1"; }
ok() { printf '\033[0;32m  ✓ %s\033[0m\n' "$1"; }

say "1/6 檢查 Homebrew"
if ! command -v brew >/dev/null 2>&1; then
  [ -x /opt/homebrew/bin/brew ] || /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
  eval "$(/opt/homebrew/bin/brew shellenv)"
  grep -q 'brew shellenv' "$HOME/.zprofile" 2>/dev/null || echo 'eval "$(/opt/homebrew/bin/brew shellenv)"' >> "$HOME/.zprofile"
fi
ok "Homebrew $(brew --version | head -1 | awk '{print $2}')"

say "2/6 安裝 Node.js 與 MySQL"
if ! command -v node >/dev/null 2>&1; then brew install node@22; brew link --overwrite --force node@22 >/dev/null 2>&1 || true; fi
brew list mysql@8.4 >/dev/null 2>&1 || brew install mysql@8.4
brew link --overwrite --force mysql@8.4 >/dev/null 2>&1 || true
MYSQL_BIN="$(brew --prefix mysql@8.4)/bin"
export PATH="$MYSQL_BIN:$PATH"
brew services start mysql@8.4 >/dev/null
for i in $(seq 1 30); do mysqladmin -uroot ping >/dev/null 2>&1 && break; sleep 1; done
ok "Node.js $(node -v)、MySQL $(mysql --version | awk '{print $3}')（只接受這台電腦自己連線）"

say "3/6 建立資料庫 jaker_apps 與專用帳號"
if [ -f .env ] && grep -q '^DB_PASSWORD=.\+' .env; then
  ok "已有 .env，沿用原本的資料庫帳號"
else
  PW="$(LC_ALL=C tr -dc 'A-Za-z0-9' </dev/urandom | head -c 24)"
  mysql -uroot <<SQL
CREATE DATABASE IF NOT EXISTS jaker_apps CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER IF NOT EXISTS 'jaker_apps'@'localhost' IDENTIFIED BY '$PW';
CREATE USER IF NOT EXISTS 'jaker_apps'@'127.0.0.1' IDENTIFIED BY '$PW';
ALTER USER 'jaker_apps'@'localhost' IDENTIFIED BY '$PW';
ALTER USER 'jaker_apps'@'127.0.0.1' IDENTIFIED BY '$PW';
GRANT ALL PRIVILEGES ON jaker_apps.* TO 'jaker_apps'@'localhost';
GRANT ALL PRIVILEGES ON jaker_apps.* TO 'jaker_apps'@'127.0.0.1';
FLUSH PRIVILEGES;
SQL
  cat > .env <<ENV
# 傑克電機內部系統設定（含資料庫密碼，不要分享）
APPS=erp
PORT=8080
HOST=0.0.0.0
DB_HOST=127.0.0.1
DB_PORT=3306
DB_NAME=jaker_apps
DB_USER=jaker_apps
DB_PASSWORD=$PW
LINE_ENABLED=0
ENV
  chmod 600 .env
  ok "已建立資料庫帳號，密碼存在 .env（只有你的帳號能讀）"
fi
# 大筆資料（Packing List 範本等）需要
mysql -uroot -e "SET PERSIST max_allowed_packet=67108864;" >/dev/null 2>&1 || true

say "4/6 安裝程式套件"
npm ci --omit=dev --no-audit --no-fund
node tools/check-db.js >/dev/null && ok "資料庫連線正常"

say "5/6 設定自動啟動（登入這台 Mac 後自動執行，當掉會自動重開）"
mkdir -p "$HOME/Library/LaunchAgents" "$ROOT/data/logs"
NODE_BIN="$(command -v node)"
cat > "$PLIST" <<PL
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key><array><string>$NODE_BIN</string><string>$ROOT/src/server.js</string></array>
  <key>WorkingDirectory</key><string>$ROOT</string>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>ThrottleInterval</key><integer>10</integer>
  <key>EnvironmentVariables</key><dict><key>PATH</key><string>$(dirname "$NODE_BIN"):/usr/bin:/bin:/usr/sbin:/sbin</string></dict>
  <key>StandardOutPath</key><string>$ROOT/data/logs/launchd.out.log</string>
  <key>StandardErrorPath</key><string>$ROOT/data/logs/launchd.err.log</string>
</dict></plist>
PL
launchctl bootout "gui/$(id -u)/$LABEL" >/dev/null 2>&1 || true
launchctl bootstrap "gui/$(id -u)" "$PLIST"
launchctl kickstart -k "gui/$(id -u)/$LABEL"
PORT="$(grep '^PORT=' .env | cut -d= -f2)"; PORT="${PORT:-8080}"
for i in $(seq 1 20); do curl -fs "http://127.0.0.1:$PORT/healthz" >/dev/null 2>&1 && break; sleep 1; done
curl -fs "http://127.0.0.1:$PORT/healthz" >/dev/null && ok "服務已啟動" || { echo "  ✗ 服務沒有啟動，請看 data/logs/server.log"; exit 1; }

say "6/6 不要讓 Mac 睡著（要輸入這台 Mac 的登入密碼）"
sudo pmset -a sleep 0 disksleep 0 autorestart 1 && ok "已關閉自動睡眠；停電復電後會自動開機"

IP="$(ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null || echo '這台Mac的IP')"
printf '\n\033[1;32m完成！\033[0m\n'
echo "  這台 Mac：  http://127.0.0.1:$PORT/erp/"
echo "  公司同事：  http://$IP:$PORT/erp/"
echo "  第一次有同事連線時，Mac 可能跳出「允許 node 接受連入連線」→ 按「允許」。"
echo "  下一步：從 Google 試算表下載 .xlsx，雙擊「匯入進銷存資料.command」匯入。"
