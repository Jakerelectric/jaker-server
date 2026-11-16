# 傑克電機內部系統（測試版）

把「專案儀表板」從 Google Apps Script 搬到公司自己的電腦上跑，網頁會快很多。
目前是**測試版**：只在公司內網使用、LINE 通知關閉，現在的 Apps Script 版照常運作，兩邊互不影響。

## 安裝（第一次，約 15 分鐘）

1. **安裝 Node.js**：到 <https://nodejs.org> 下載「LTS」版，一路按「下一步」。
2. **解壓縮**：把這個資料夾放到 `C:\jaker-server`。
3. **建立資料庫帳號**：開 XAMPP 的 phpMyAdmin →「SQL」分頁，貼上 `tools\create-db-user.sql` 的內容。
   先把裡面兩處「請改成16碼以上的隨機密碼」改成**同一組**新密碼，再按執行。
   這個帳號只能使用 `jaker_apps` 資料庫，碰不到文管系統。
4. **執行安裝**：對 `install.bat` 按右鍵 →「以系統管理員身分執行」，照畫面輸入資料庫帳號密碼。
   腳本會：檢查資料庫連線、開放防火牆（只限公司內網）、設定開機自動啟動、啟動服務。
5. **匯入資料**：
   - 打開專案系統的 Google 試算表 →「檔案」→「下載」→「Microsoft Excel (.xlsx)」。
   - 對 `import.bat` 按右鍵 →「以系統管理員身分執行」，選剛才下載的檔案。
6. **打開網頁**：安裝完成畫面會顯示網址，例如 `http://192.168.1.20:8080/pm/`。
   用**行政服務入口的員工編號和密碼**登入。

## 把 Google Drive 上的檔案搬回公司

1. Claude 已在 Apps Script 產生檔案清單 `drive-manifest.json`，放在 Google Drive「傑克電機專案照片」資料夾裡。
2. 在 Google Drive 對「傑克電機專案照片」資料夾按右鍵 →「下載」，會下載一或多個 zip 檔。
3. 把所有 zip 都解壓縮到**同一個**資料夾（例如 `D:\drive-download`）。
4. 對 `import-drive.bat` 按右鍵 →「以系統管理員身分執行」，選剛才的資料夾。
5. 完成後，資料庫裡的 Google Drive 連結都會換成這台電腦的連結；找不到的檔案會列在 `data\logs\drive-migration-missing.txt`。
   可以重複執行，已經搬過的檔案會自動略過。

## 更新程式

對 `update.bat` 按右鍵 →「以系統管理員身分執行」。
- 會從 GitHub（私人儲存庫 `Jakerelectric/jaker-server`）下載最新版，資料、`.env`、上傳的檔案都不會動。
- 更新前自動備份目前的程式到 `data\versions`（保留 5 份）；新版啟動失敗會自動還原。
- 第一次執行要貼上 GitHub 的**唯讀權杖**（只能讀這個儲存庫），之後記在 `.env`。
- **遠端更新**：專案系統的「管理員」登入儀表板後，打開 `https://work.jaker-ai.com/pm/admin/update`，
  可以看到目前／最新版本，按「更新到最新版」就會在主機上執行更新（排程工作 `JakerUpdate`，服務啟動時自動建立），
  過程記錄在 `data\logs\update.log`。

## LINE 串接

對 `set-line.bat` 按右鍵 →「以系統管理員身分執行」：
- 選 1 開啟：貼上 LINE Developers 的 Channel secret 與 Channel access token（畫面不會顯示）。
  開啟後再到 LINE Developers 把 Webhook URL 改成 `https://work.jaker-ai.com/pm/line`。
- 選 2 關閉：要退回 Apps Script 版時用（同時把 Webhook URL 改回原本的網址）。
- 這台電腦只接受 LINE 簽章正確的 Webhook，其他來源一律拒絕。

## 平常操作

| 要做的事 | 怎麼做 |
| --- | --- |
| 重新啟動服務 | 「工作排程器」→ 找到 `JakerServer` → 結束，再執行 |
| 看錯誤紀錄 | `data\logs\server.log` |
| 更新成最新資料 | 重新下載 .xlsx，執行 `import.bat`（會覆蓋測試版資料） |
| 備份 | 每天凌晨 2 點自動存一份到 `data\backups`（保留 30 天），資料本身在 MySQL |
| 上傳的檔案 | `data\drive`（要開檔案得先登入儀表板） |

## 測試期間的限制

- **LINE 不會發通知**，也不接收 LINE 訊息；LINE 仍由現在的 Apps Script 版處理。
- 測試版的資料是匯入當下的複本；在測試版改的資料**不會**回寫到 Google 試算表。
- 只有公司內網連得到；外部連線等 Cloudflare 設定好再開。
- 第一次登入行政服務的人，要先到行政服務入口設定自己的密碼才能登入。

## 進銷存系統（/erp）— Mac 安裝

進銷存系統也可以跑在這套伺服器上（網址 `/erp/`）。資料比較敏感，先只在公司內網用；Google 版照常運作，兩邊互不影響。

1. **下載程式**：打開 Mac 的「終端機」，貼上：
   `git clone https://github.com/Jakerelectric/jaker-server ~/jaker-server && cd ~/jaker-server && bash install-mac.sh`
   - 第一次會安裝 Homebrew（要輸入 Mac 的登入密碼），接著自動裝 Node.js、MySQL、建資料庫、設定自動啟動。
   - 最後會關閉 Mac 的自動睡眠，並顯示同事要用的網址，例如 `http://192.168.1.30:8080/erp/`。
2. **匯入資料**：打開進銷存的 Google 試算表 →「檔案」→「下載」→「Microsoft Excel (.xlsx)」，
   再到 `~/jaker-server` 資料夾雙擊「**匯入進銷存資料.command**」選這個檔案。匯入前會自動備份。
3. **登入**：用行政服務的員工編號和密碼（或原本進銷存的密碼）。權限照進銷存「帳號管理」的設定；
   員工編號不在進銷存帳號裡的人不能登入。
4. **更新程式**：雙擊「**更新程式.command**」。新版沒有正常啟動會自動退回。

| 要做的事 | 怎麼做 |
| --- | --- |
| 看錯誤紀錄 | `~/jaker-server/data/logs/server.log` |
| 重新啟動服務 | 終端機：`launchctl kickstart -k gui/$(id -u)/tw.jaker.server` |
| 備份 | 每天凌晨 2:10 自動存一份到 `data/backups/erp`（保留 30 天），匯入前也會備份 |
| 資料表 | MySQL 資料庫 `jaker_apps`，進銷存的表都以 `erp_` 開頭（例如 `erp_items`、`erp_txns`），欄位名稱來自程式裡的欄位代號 |

注意：
- Mac 要一直開著、登入狀態（服務在登入後自動啟動）。用 Wi-Fi 時 IP 可能會變，建議請 IT 在路由器固定這台 Mac 的 IP。
- MySQL 只接受這台 Mac 自己連線；網頁只開在公司內網，外部連不到。
- 系統寄信、自動翻譯在這個版本不會動作（只留紀錄），要寄信請先用 Google 版。
- `.env` 的 `APPS` 決定這台主機跑哪些系統：Mac 是 `APPS=erp`；公司 Windows 主機維持只有專案系統（沒寫就是 `pm`）。

## 技術說明（給 IT）

- Node.js（Express）＋ MySQL。原本 Apps Script 的程式碼（`apps\pm\Code.gs`、`Dashboard.html`）直接沿用，
  由 `src\runtime.js` 提供 SpreadsheetApp、DriveApp 等相容功能。
- **每張工作表都是一個真正的資料表**：一筆資料一列，每列有自動編號 `_id`；改一筆只更新那一列。
  - 欄位用**英文名稱**，原本的中文表頭寫在欄位註解（phpMyAdmin「結構」頁看得到），對照也存在 `gas_columns`。
  - 欄位有**型別**：日期 `DATE`、時間 `DATETIME`、數字 `INT`／`DOUBLE`、文字 `VARCHAR(n)`，只有說明類長文字用 `TEXT`。
    定義在 `src\schema.js`。
  - 遇到放不下的資料（例如日期欄填了「待定」、名稱超過長度），系統會自動把該欄放寬一級並寫進 `server.log`，
    不會截斷或遺失資料。
  - 常用欄位（編號、專案編號、負責人、狀態、姓名…）有建索引。

  | 工作表 | 資料表 |
  | --- | --- |
  | 專案 | `pm_projects` |
  | 任務 | `pm_tasks` |
  | 每週更新 | `pm_updates` |
  | 照片（含上傳的專案資料） | `pm_files` |
  | 成員 | `pm_members` |
  | 單位 | `pm_units` |
  | 變更紀錄 | `pm_changes` |
  | 意見回饋 | `pm_feedback` |
  | 研究試驗單 | `pm_tests` |

  查詢範例（phpMyAdmin 的 SQL 分頁）：
  `SELECT owner AS 負責人, COUNT(*) AS 未完成任務 FROM pm_tasks WHERE status <> '已完成' GROUP BY owner;`
  `SELECT code, title, end_date FROM pm_tasks WHERE status <> '已完成' AND end_date < CURDATE();`（逾期任務）

  請**只用查詢**，不要直接在資料庫裡改資料：服務執行時資料也放在記憶體裡，直接改資料庫會被系統覆蓋。
  要改資料請用網頁，或先停止服務再改。
- 登入：透過行政服務的 API 確認員工編號與密碼，不經過 Google 帳號。
- 設定檔 `.env`（含資料庫密碼，安裝腳本已限制只有系統管理員可讀）。
- MySQL 的 `max_allowed_packet` 建議設 64M（XAMPP `my.ini` 的 `[mysqld]` 段落）。
