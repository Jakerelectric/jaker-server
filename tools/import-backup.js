'use strict';
/**
 * 搬家用：把單機版（STORE=file）的備份 JSON 匯入公司主機的 MySQL
 *   用法：node tools/import-backup.js backup-xxxx.json --app erp
 *   備份檔在單機那台的 data/backups/erp；每張工作表整張覆蓋。
 */
const path = require('path');
const fs = require('fs');
const { loadConfig } = require('../src/config');
const { Store } = require('../src/store');
const { loadErpSchema } = require('../src/erp-schema');

(async () => {
  const args = process.argv.slice(2);
  const ai = args.indexOf('--app'); const appName = ai >= 0 ? String(args[ai + 1] || '') : 'erp';
  if (ai >= 0) args.splice(ai, 2);
  const file = args[0];
  if (!file || !fs.existsSync(file) || appName !== 'erp') { console.error('用法：node tools/import-backup.js <備份 .json> --app erp'); process.exit(1); }
  const ROOT = path.resolve(__dirname, '..');
  const cfg = loadConfig(ROOT);
  if (cfg.store === 'file') { console.error('這台的 .env 是 STORE=file（單機版），要匯入 MySQL 請在公司主機上執行。'); process.exit(1); }
  const b = JSON.parse(fs.readFileSync(file, 'utf8'));
  const schema = loadErpSchema(path.join(ROOT, 'apps', 'erp'));
  const store = new Store(cfg.db, { prefix: 'erp_', tableName: schema.tableName, defFor: schema.defFor, backupDir: path.join(cfg.dataDir, 'backups', 'erp') });
  await store.open();
  if (store.sheets.size) console.log('匯入前已備份：' + store.backupTo(path.join(cfg.dataDir, 'backups', 'erp')));
  Object.entries(b.sheets || {}).forEach(([n, d]) => { store.replaceSheet(n, d); console.log('工作表「' + n + '」：' + Math.max(0, d.length - 1) + ' 筆'); });
  Object.entries(b.props || {}).forEach(([k, v]) => store.setProp(k, v));
  Object.entries(b.docs || {}).forEach(([k, v]) => store.setDoc(k, v));
  await store.flush(); await store.close();
  console.log('匯入完成，重新啟動服務後生效。');
})().catch(e => { console.error('匯入失敗：', e.message || e); process.exit(1); });
