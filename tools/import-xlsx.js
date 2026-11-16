'use strict';
/**
 * 把 Google 試算表下載的 .xlsx 匯入資料庫
 *   用法：node tools\import-xlsx.js 檔案.xlsx            （專案系統）
 *         node tools\import-xlsx.js 檔案.xlsx --app erp  （進銷存系統）
 *   每張工作表整張覆蓋；沒有出現在檔案裡的工作表不動。
 *   進銷存：只匯入系統用到的工作表；數字用原始數值（不會被千分位、小數位數影響），日期一律寫成 yyyy-MM-dd。
 */
const path = require('path');
const fs = require('fs');
const XLSX = require('xlsx');
const { loadConfig } = require('../src/config');
const { Store } = require('../src/store');
const { rewriteDriveLinks } = require('./drive-links');
const { loadErpSchema } = require('../src/erp-schema');

const pad = n => (n < 10 ? '0' : '') + n;
function erpCell(c) {
  if (!c || c.v == null) return '';
  if (c.t === 'n') {
    if (c.z && XLSX.SSF.is_date(c.z)) {
      const d = XLSX.SSF.parse_date_code(c.v); if (!d) return String(c.v);
      const day = d.y + '-' + pad(d.m) + '-' + pad(d.d);
      return d.H || d.M ? day + ' ' + pad(d.H) + ':' + pad(d.M) : day;
    }
    return String(c.v);
  }
  if (c.t === 'b') return c.v ? 'TRUE' : 'FALSE';
  if (c.t === 'd') { const d = new Date(c.v); return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  return String(c.v);
}
function erpRows(ws) {
  if (!ws['!ref']) return [];
  const r = XLSX.utils.decode_range(ws['!ref']), out = [];
  for (let i = r.s.r; i <= r.e.r; i++) {
    const row = [];
    for (let j = 0; j <= r.e.c; j++) row.push(erpCell(ws[XLSX.utils.encode_cell({ r: i, c: j })]));
    out.push(row);
  }
  return out;
}

(async () => {
  const args = process.argv.slice(2);
  const ai = args.indexOf('--app'); const appName = ai >= 0 ? String(args[ai + 1] || '') : 'pm';
  if (ai >= 0) args.splice(ai, 2);
  const file = args[0];
  const ROOT = path.resolve(__dirname, '..');
  if (!file || !fs.existsSync(file)) {
    console.error('用法：node tools\\import-xlsx.js <從 Google 試算表下載的 .xlsx 檔>');
    process.exit(1);
  }
  const cfg = loadConfig(ROOT);
  const wb = XLSX.readFile(file, { cellDates: false, cellNF: true, cellText: true });
  let store, only = null;
  if (appName === 'erp') {
    const schema = loadErpSchema(path.join(ROOT, 'apps', 'erp'));
    store = new Store(cfg.db, { prefix: 'erp_', tableName: schema.tableName, defFor: schema.defFor, backupDir: path.join(cfg.dataDir, 'backups', 'erp') });
    only = new Set(schema.sheetNames);
  } else store = new Store(cfg.db, { backupDir: path.join(cfg.dataDir, 'backups') });
  await store.open();
  if (store.sheets.size) { const f = store.backupTo(path.join(cfg.dataDir, 'backups', appName === 'erp' ? 'erp' : '')); console.log('匯入前已備份：' + f); }
  const before = new Set(store.sheets.keys());
  for (const name of wb.SheetNames) {
    if (only && !only.has(name)) { console.log('略過工作表「' + name + '」（系統沒有用到）'); continue; }
    const ws = wb.Sheets[name];
    // 專案系統：用「畫面上顯示的文字」匯入（跟 Apps Script 的 getDisplayValues 一樣）
    // 進銷存：跟 Apps Script 的 getValues 一樣用原始值（數字不帶千分位，日期寫成 yyyy-MM-dd）
    const rows = appName === 'erp' ? erpRows(ws) : XLSX.utils.sheet_to_json(ws, { header: 1, raw: false, defval: '', blankrows: true })
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
