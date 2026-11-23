'use strict';
/**
 * 產生「料號對照（舊→新）」清單：系統舊料號少了開頭類別碼、鼎新有唯一一個「前面多一碼」的同名品號 → 換成鼎新品號
 *   只讀鼎新與系統，不寫入。輸出：
 *     data\dingxin-rename.txt        直接貼進「資料匯入 → 料號對照（舊→新）」（Tab 分隔，第一列是標題）
 *     data\dingxin-rename-report.txt 對照明細、對到多個（要人工判斷）、對不到的
 */
const path = require('path');
const fs = require('fs');
const ROOT = path.resolve(__dirname, '..');
const DATA = path.join(ROOT, 'data');
const out = [];
const log = (...a) => { const s = a.join(' '); console.log(s); out.push(s); };
let sql; try { sql = require('mssql'); } catch (e) { console.log('這台主機還沒有安裝 mssql 套件，請先更新。'); process.exitCode = 1; return; }
const { loadConfig, readEnvFile } = require('../src/config');
const { Store } = require('../src/store');
const { loadErpSchema } = require('../src/erp-schema');
const t = v => (v == null ? '' : String(v).trim());
const U = s => t(s).toUpperCase();
const sheetObjs = (store, schema, key) => { const d = store.sheets.get(schema.TAB[key]); if (!d || !d.length) return [];
  const lab = {}; (schema.F[key] || []).forEach(f => { lab[String(f[1]).trim()] = f[0]; });
  const [h, ...r] = d; const ks = h.map(x => lab[String(x == null ? '' : x).trim()] || String(x)); return r.map(x => Object.fromEntries(ks.map((k, i) => [k, x[i]]))); };

(async () => {
  const env = Object.assign(readEnvFile(path.join(ROOT, '.env')), process.env);
  const pool = await new sql.ConnectionPool({ server: env.DINGXIN_HOST || '192.168.0.51', port: Number(env.DINGXIN_PORT) || 1433, user: env.DINGXIN_USER, password: env.DINGXIN_PASSWORD,
    database: env.DINGXIN_DB || 'JAKER', connectionTimeout: 15000, requestTimeout: 120000, options: { encrypt: false, trustServerCertificate: true, readOnlyIntent: true } }).connect();
  const MB = (await pool.request().query(`SELECT MB001,MB002,MB003 FROM INVMB WITH (NOLOCK)`)).recordset;
  await pool.close();
  const cfg = loadConfig(ROOT); const schema = loadErpSchema(path.join(ROOT, 'apps', 'erp'));
  const store = new Store(cfg.db, { prefix: 'erp_', tableName: schema.tableName, defFor: schema.defFor });
  await store.open(); const items = sheetObjs(store, schema, 'items'); const stock = sheetObjs(store, schema, 'stock'); await store.close();

  const dx = new Map(MB.map(m => [U(m.MB001), m]));
  const sysCodes = new Set(); items.forEach(i => { sysCodes.add(U(i.code)); String(i.alias || '').split(/[,，;；、\s]+/).filter(Boolean).forEach(a => sysCodes.add(U(a))); });
  const byTail = {}; MB.forEach(m => { const mm = t(m.MB001).match(/^\d(.+)$/); if (mm) (byTail[U(mm[1])] = byTail[U(mm[1])] || []).push(m); });
  const qty = {}; stock.forEach(s => { qty[U(s.itemId)] = (qty[U(s.itemId)] || 0) + (Number(s.qty) || 0); });
  const onlySys = items.filter(i => !dx.has(U(i.code)) && !String(i.alias || '').split(/[,，;；、\s]+/).some(a => dx.has(U(a))));
  const pairs = [], multi = [], none = [];
  onlySys.forEach(i => { const hit = byTail[U(i.code)] || [];
    if (hit.length === 1) pairs.push({ i, m: hit[0], merge: sysCodes.has(U(hit[0].MB001)) });
    else if (hit.length > 1) multi.push({ i, hit }); else none.push(i); });

  fs.mkdirSync(DATA, { recursive: true });
  fs.writeFileSync(path.join(DATA, 'dingxin-rename.txt'), ['舊料號\t新料號\t系統品名\t鼎新品名'].concat(pairs.map(p => `${p.i.code}\t${t(p.m.MB001)}\t${t(p.i.name)}\t${t(p.m.MB002)}`)).join('\r\n'), 'utf8');
  log('== 料號對照清單（只讀，不寫入）' + new Date().toLocaleString('zh-TW'));
  log(`系統有、鼎新沒有的品號：${onlySys.length} 個`);
  log(`可以換成鼎新品號：${pairs.length} 個（其中 ${pairs.filter(p => p.merge).length} 個鼎新品號系統已經有，會「合併」，其餘「改號」）`);
  log(`鼎新對到多個、要人工判斷：${multi.length} 個`);
  log(`鼎新找不到對應：${none.length} 個（保留不動）`);
  log('\n--- 會換號（舊 → 新）---');
  pairs.forEach(p => log(`${p.merge ? '[合併]' : '[改號]'} ${p.i.code}　${t(p.i.name)}　→　${t(p.m.MB001)}　${t(p.m.MB002)}${qty[U(p.i.code)] ? '　庫存 ' + qty[U(p.i.code)] : ''}`));
  log('\n--- 對到多個（不會處理，請告訴我要用哪一個）---');
  multi.forEach(x => log(`${x.i.code}　${t(x.i.name)}　→　${x.hit.map(m => t(m.MB001) + ' ' + t(m.MB002)).join('、')}`));
  log('\n--- 找不到對應（保留不動）---');
  none.forEach(i => log(`${i.code}　${t(i.name)}`));
  fs.writeFileSync(path.join(DATA, 'dingxin-rename-report.txt'), out.join('\r\n'), 'utf8');
  console.log('\n結果：' + path.join(DATA, 'dingxin-rename-report.txt'));
})().catch(e => { console.log('發生錯誤：' + (e.message || e)); process.exitCode = 1; });
