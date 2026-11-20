'use strict';
/**
 * 搬家用：把單機版（STORE=file）的進銷存資料匯出成一個備份 JSON，連同上傳的附件放到指定資料夾
 *   用法：node tools/export-backup.js <輸出資料夾>
 *   產生 <輸出資料夾>/erp-backup.json 與 <輸出資料夾>/erp-drive/（結帳、收款附件）
 *   公司主機用「啟用進銷存.bat」選 erp-backup.json 匯入。
 */
const path = require('path');
const fs = require('fs');
const { FileStore } = require('../src/file-store');
(async () => {
  const out = process.argv[2];
  if (!out) { console.error('用法：node tools/export-backup.js <輸出資料夾>'); process.exit(1); }
  const ROOT = path.resolve(__dirname, '..');
  const { loadConfig } = require('../src/config');
  const cfg = loadConfig(ROOT);
  const dbDir = path.join(cfg.dataDir, 'erp-db');
  if (!fs.existsSync(path.join(dbDir, 'sheets'))) { console.error('這台沒有單機版進銷存資料（' + dbDir + '）'); process.exit(1); }
  const s = new FileStore(dbDir, { log: () => {} });
  await s.open();
  fs.mkdirSync(out, { recursive: true });
  const file = path.join(out, 'erp-backup.json');
  fs.writeFileSync(file, JSON.stringify({ at: new Date().toISOString(), sheets: Object.fromEntries(s.sheets), props: Object.fromEntries(s.props), docs: Object.fromEntries(s.docs) }));
  let n = 0;
  const drive = path.join(cfg.dataDir, 'erp-drive');
  if (fs.existsSync(drive)) { fs.cpSync(drive, path.join(out, 'erp-drive'), { recursive: true }); n = fs.readdirSync(drive).length; }
  [...s.sheets].forEach(([k, d]) => console.log('工作表「' + k + '」：' + Math.max(0, d.length - 1) + ' 筆'));
  console.log('匯出完成：' + file + (n ? '（附件 ' + n + ' 個項目）' : ''));
})().catch(e => { console.error('匯出失敗：', e.message || e); process.exit(1); });
