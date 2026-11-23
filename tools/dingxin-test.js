'use strict';
/**
 * 測試鼎新（SQL Server）連線：只讀，不寫入任何資料
 *   帳密放在 .env：DINGXIN_HOST、DINGXIN_PORT（預設 1433）、DINGXIN_USER、DINGXIN_PASSWORD、DINGXIN_DB（不知道可以先不填）
 *   用法：node tools/dingxin-test.js   （或雙擊「測試鼎新連線.bat」）
 *   結果同時寫到 data\dingxin-test.txt，把這個檔案傳給 Claude 看即可（裡面沒有密碼）
 */
const path = require('path');
const fs = require('fs');
let sql; try { sql = require('mssql'); } catch (e) {
  const msg = '這台主機還沒有安裝連鼎新用的套件（mssql）。請先執行「系統更新」或 update.bat，再重新執行這個檔案。';
  console.log(msg); try { const D = path.join(path.resolve(__dirname, '..'), 'data'); fs.mkdirSync(D, { recursive: true }); fs.writeFileSync(path.join(D, 'dingxin-test.txt'), msg, 'utf8'); } catch (_) {} process.exit(1); }
const ROOT = path.resolve(__dirname, '..');
const { readEnvFile } = require('../src/config');
const DATA = path.join(ROOT, 'data');
const env = Object.assign(readEnvFile(path.join(ROOT, '.env')), process.env);
const out = [];
const log = (...a) => { const s = a.join(' '); console.log(s); out.push(s); };

// 鼎新 Workflow ERP GP 常用的表：用來判斷哪個資料庫是公司別
const TABLES = [
  ['COPTG', '銷貨單頭'], ['COPTH', '銷貨單身'], ['COPTC', '訂單頭'], ['COPTD', '訂單身'],
  ['PURTC', '採購單頭'], ['PURTD', '採購單身'], ['INVMB', '品號基本資料'], ['INVMC', '品號庫別庫存'], ['CMSMC', '庫別'],
];

(async () => {
  const host = env.DINGXIN_HOST || '192.168.0.51', user = env.DINGXIN_USER, password = env.DINGXIN_PASSWORD;
  if (!user || !password) { log('請先在 .env 加上 DINGXIN_USER=帳號 和 DINGXIN_PASSWORD=密碼（IT 給的唯讀帳號）。'); return finish(1); }
  const base = { server: host, port: Number(env.DINGXIN_PORT) || 1433, user, password, connectionTimeout: 15000, requestTimeout: 30000,
    options: { encrypt: false, trustServerCertificate: true, readOnlyIntent: true } };
  log('== 測試鼎新連線 ' + new Date().toLocaleString('zh-TW'));
  log('主機：' + host + ':' + base.port + '　帳號：' + user);
  let pool;
  try { pool = await new sql.ConnectionPool({ ...base, database: env.DINGXIN_DB || 'master' }).connect(); }
  catch (e) { log('連線失敗：' + e.message); log('可能原因：IP 或埠號不對、這台主機連不到鼎新主機（防火牆）、帳密錯誤。'); return finish(1); }
  const v = await pool.request().query('SELECT @@VERSION AS v');
  log('連線成功。SQL Server：' + String(v.recordset[0].v).split('\n')[0]);

  // 這個帳號看得到哪些資料庫
  const dbs = (await pool.request().query("SELECT name FROM sys.databases WHERE HAS_DBACCESS(name) = 1 AND name NOT IN ('master','tempdb','model','msdb') ORDER BY name")).recordset.map(r => r.name);
  log('這個帳號可以讀的資料庫：' + (dbs.join('、') || '（沒有）'));
  await pool.close();

  for (const db of dbs) {
    let p; try { p = await new sql.ConnectionPool({ ...base, database: db }).connect(); } catch (e) { log(`\n[${db}] 連不進去：${e.message}`); continue; }
    const have = (await p.request().query(`SELECT name FROM sys.tables WHERE name IN (${TABLES.map(t => `'${t[0]}'`).join(',')})`)).recordset.map(r => r.name);
    if (!have.length) { await p.close(); continue; }
    log(`\n[${db}] 找到鼎新資料表 ${have.length} 張`);
    for (const [t, label] of TABLES) {
      if (!have.includes(t)) { log(`  ${t} ${label}：沒有`); continue; }
      try {
        const cols = (await p.request().query(`SELECT name FROM sys.columns WHERE object_id = OBJECT_ID('${t}')`)).recordset.map(r => r.name);
        const dateCol = ['MODI_DATE', 'CREATE_DATE'].find(c => cols.includes(c));
        const r = (await p.request().query(`SELECT COUNT(*) AS n${dateCol ? `, MAX(${dateCol}) AS last` : ''} FROM ${t} WITH (NOLOCK)`)).recordset[0];
        log(`  ${t} ${label}：${r.n} 筆${dateCol ? `，最後${dateCol === 'MODI_DATE' ? '修改' : '建立'}日 ${r.last}` : ''}（${cols.length} 個欄位）`);
      } catch (e) { log(`  ${t} ${label}：讀取失敗 ${e.message}`); }
    }
    // 銷貨單頭、採購單頭的欄位清單（之後對欄位用）
    for (const t of ['COPTG', 'PURTC', 'PURTD']) {
      if (!have.includes(t)) continue;
      const cols = (await p.request().query(`SELECT name FROM sys.columns WHERE object_id = OBJECT_ID('${t}') ORDER BY column_id`)).recordset.map(r => r.name);
      log(`  ${t} 欄位：${cols.join(',')}`);
    }
    await p.close();
  }
  finish(0);
})().catch(e => { log('發生錯誤：' + (e.message || e)); finish(1); });

function finish(code) {
  try { const f = path.join(DATA, 'dingxin-test.txt'); fs.mkdirSync(DATA, { recursive: true }); fs.writeFileSync(f, out.join('\r\n'), 'utf8'); console.log('\n結果已存到：' + f); } catch (e) {}
  process.exitCode = code;
}
