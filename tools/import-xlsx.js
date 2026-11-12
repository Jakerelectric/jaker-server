'use strict';
/**
 * 把 Google 試算表下載的 .xlsx 匯入資料庫
 *   用法：node tools\import-xlsx.js 檔案.xlsx
 *   每張工作表整張覆蓋；沒有出現在檔案裡的工作表不動。
 */
const path = require('path');
const fs = require('fs');
const XLSX = require('xlsx');
const { loadConfig } = require('../src/config');
const { Store } = require('../src/store');
const { rewriteDriveLinks } = require('./drive-links');

(async () => {
  const file = process.argv[2];
  if (!file || !fs.existsSync(file)) {
    console.error('用法：node tools\\import-xlsx.js <從 Google 試算表下載的 .xlsx 檔>');
    process.exit(1);
  }
  const cfg = loadConfig(path.resolve(__dirname, '..'));
  const wb = XLSX.readFile(file, { cellDates: false, cellNF: true, cellText: true });
  const store = new Store(cfg.db, { backupDir: path.join(cfg.dataDir, 'backups') });
  await store.open();
  const before = new Set(store.sheets.keys());
  for (const name of wb.SheetNames) {
    const ws = wb.Sheets[name];
    // 用「畫面上顯示的文字」匯入（跟 Apps Script 的 getDisplayValues 一樣）
    const rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: false, defval: '', blankrows: true })
      .map(r => r.map(v => (v == null ? '' : String(v))));
    while (rows.length && !rows[rows.length - 1].some(v => v !== '')) rows.pop();
    const width = rows.reduce((m, r) => { let w = r.length; while (w && r[w - 1] === '') w--; return Math.max(m, w); }, 0);
    const data = rows.map(r => { const o = r.slice(0, width); while (o.length < width) o.push(''); return o; });
    store.replaceSheet(name, data);
    console.log((before.has(name) ? '覆蓋' : '新增') + '工作表「' + name + '」：' + Math.max(0, data.length - 1) + ' 筆資料');
  }
  // 已經搬到這台電腦的檔案：連結自動換成本機連結
  if (store.docs.get('drive-migration')) {
    const { changed, left } = rewriteDriveLinks(store);
    console.log('檔案連結改成本機：' + changed + ' 處' + (left.length ? '；還有 ' + left.length + ' 個 Google 連結沒有對應的檔案（匯入後新增的檔案），請再執行一次 import-drive.bat' : ''));
  }
  await store.flush();
  await store.close();
  console.log('匯入完成。重新啟動服務後生效（安裝腳本建立的排程：在「工作排程器」重新執行 JakerServer，或重新開機）。');
})().catch(e => { console.error('匯入失敗：', e.message || e); process.exit(1); });
