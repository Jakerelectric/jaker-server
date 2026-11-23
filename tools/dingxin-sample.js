'use strict';
/**
 * 鼎新資料抽樣（唯讀）：每張表抓最近修改的幾筆，列出「欄位=值」（只列有值的欄位），用來對照欄位意義
 *   用法：node tools/dingxin-sample.js   （或對「鼎新資料抽樣.bat」按右鍵 → 以系統管理員身分執行）
 *   結果寫到 data\dingxin-sample.txt（裡面沒有密碼）
 */
const path = require('path');
const fs = require('fs');
const ROOT = path.resolve(__dirname, '..');
const DATA = path.join(ROOT, 'data');
const out = [];
const log = (...a) => { const s = a.join(' '); console.log(s); out.push(s); };
const finish = code => { try { fs.mkdirSync(DATA, { recursive: true }); fs.writeFileSync(path.join(DATA, 'dingxin-sample.txt'), out.join('\r\n'), 'utf8'); console.log('\n結果已存到：' + path.join(DATA, 'dingxin-sample.txt')); } catch (e) { console.log('寫檔失敗：' + e.message); } process.exitCode = code; };
let sql; try { sql = require('mssql'); } catch (e) { log('這台主機還沒有安裝 mssql 套件，請先更新。'); finish(1); return; }
const { readEnvFile } = require('../src/config');
const env = Object.assign(readEnvFile(path.join(ROOT, '.env')), process.env);
// 表、抽幾筆、排序
const T = [['COPTG', 3], ['COPTH', 4], ['PURTC', 3], ['PURTD', 4], ['COPTC', 2], ['COPTD', 3], ['CMSMC', 16]];
(async () => {
  const cfg = { server: env.DINGXIN_HOST || '192.168.0.51', port: Number(env.DINGXIN_PORT) || 1433, user: env.DINGXIN_USER, password: env.DINGXIN_PASSWORD,
    database: env.DINGXIN_DB || 'JAKER', connectionTimeout: 15000, requestTimeout: 30000, options: { encrypt: false, trustServerCertificate: true, readOnlyIntent: true } };
  if (!cfg.user || !cfg.password) { log('請先在 .env 加上 DINGXIN_USER、DINGXIN_PASSWORD。'); return finish(1); }
  const pool = await new sql.ConnectionPool(cfg).connect();
  log('== 鼎新資料抽樣 ' + new Date().toLocaleString('zh-TW') + '　資料庫 ' + cfg.database);
  for (const [t, n] of T) {
    try {
      const order = t === 'CMSMC' ? 'MC001' : 'MODI_DATE DESC, CREATE_DATE DESC';
      const rows = (await pool.request().query(`SELECT TOP ${n} * FROM ${t} WITH (NOLOCK) ORDER BY ${order}`)).recordset;
      log(`\n##### ${t}（${rows.length} 筆）`);
      rows.forEach((r, i) => {
        const kv = Object.entries(r).filter(([k, v]) => v !== null && String(v).trim() !== '' && !['COMPANY','USR_GROUP','FLAG','CREATE_AP','CREATE_PRID','MODI_AP','MODI_PRID'].includes(k))
          .map(([k, v]) => `${k}=${v instanceof Date ? v.toISOString().slice(0, 10) : String(v).trim()}`);
        log(`--- ${i + 1}: ` + kv.join(' | '));
      });
    } catch (e) { log(`\n##### ${t} 讀取失敗：${e.message}`); }
  }
  await pool.close(); finish(0);
})().catch(e => { log('發生錯誤：' + (e.message || e)); finish(1); });
