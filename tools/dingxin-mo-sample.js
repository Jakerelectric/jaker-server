'use strict';
/**
 * 鼎新製令抽樣（唯讀）：製令單頭 MOCTA、製令用料 MOCTB、製程 SFCTA、工作中心 CMSMD、BOM 單身 BOMMD
 *   用來確認欄位意義、未結案製令有幾張。結果：data\dingxin-mo-sample.txt（沒有密碼）
 */
const path = require('path');
const fs = require('fs');
const ROOT = path.resolve(__dirname, '..');
const DATA = path.join(ROOT, 'data');
const FILE = path.join(DATA, 'dingxin-mo-sample.txt');
const out = [];
const log = (...a) => { const s = a.join(' '); console.log(s); out.push(s); };
const finish = code => { try { fs.mkdirSync(DATA, { recursive: true }); fs.writeFileSync(FILE, out.join('\r\n'), 'utf8'); console.log('\n結果已存到：' + FILE); } catch (e) { console.log('寫檔失敗：' + e.message); } process.exitCode = code; };
let sql; try { sql = require('mssql'); } catch (e) { log('這台主機還沒有安裝 mssql 套件，請先更新。'); finish(1); return; }
const { readEnvFile } = require('../src/config');
const env = Object.assign(readEnvFile(path.join(ROOT, '.env')), process.env);
const SKIP = ['COMPANY', 'USR_GROUP', 'FLAG', 'CREATE_AP', 'CREATE_PRID', 'MODI_AP', 'MODI_PRID', 'CREATE_TIME', 'MODI_TIME'];
const fmt = r => Object.entries(r).filter(([k, v]) => v !== null && String(v).trim() !== '' && !SKIP.includes(k))
  .map(([k, v]) => `${k}=${v instanceof Date ? v.toISOString().slice(0, 10) : String(v).trim()}`).join(' | ');

(async () => {
  const pool = await new sql.ConnectionPool({ server: env.DINGXIN_HOST || '192.168.0.51', port: Number(env.DINGXIN_PORT) || 1433, user: env.DINGXIN_USER, password: env.DINGXIN_PASSWORD,
    database: env.DINGXIN_DB || 'JAKER', connectionTimeout: 15000, requestTimeout: 60000, options: { encrypt: false, trustServerCertificate: true, readOnlyIntent: true } }).connect();
  const q = async (label, text) => { try { return (await pool.request().query(text)).recordset; } catch (e) { log(`（${label} 讀取失敗：${e.message}）`); return null; } };
  log('== 鼎新製令抽樣（只讀）' + new Date().toLocaleString('zh-TW'));

  log('\n##### MOCTA 狀態統計（TA011 狀態碼、TA013 確認碼）');
  (await q('MOCTA', `SELECT TA011, TA013, COUNT(*) AS N, MIN(TA003) AS D1, MAX(TA003) AS D2 FROM MOCTA WITH (NOLOCK) GROUP BY TA011, TA013 ORDER BY TA011, TA013`) || [])
    .forEach(r => log(`TA011=${r.TA011}　TA013=${r.TA013}　${r.N} 張　開單日 ${r.D1}～${r.D2}`));

  log('\n##### MOCTA 最近的未結案製令（5 筆，全部欄位）');
  const ta = await q('MOCTA', `SELECT TOP 5 * FROM MOCTA WITH (NOLOCK) WHERE TA011 NOT IN ('Y','y') AND TA013 = 'Y' ORDER BY TA003 DESC, TA002 DESC`) || [];
  ta.forEach((r, i) => log(`--- ${i + 1}: ` + fmt(r)));

  if (ta[0]) {
    const [a, b] = [String(ta[0].TA001).trim(), String(ta[0].TA002).trim()];
    log(`\n##### MOCTB 製令用料（${a}-${b} 全部明細）`);
    (await q('MOCTB', `SELECT * FROM MOCTB WITH (NOLOCK) WHERE TB001='${a.replace(/'/g, '')}' AND TB002='${b.replace(/'/g, '')}' ORDER BY TB003`) || []).forEach((r, i) => log(`--- ${i + 1}: ` + fmt(r)));
    log(`\n##### SFCTA 製令製程（${a}-${b}）`);
    (await q('SFCTA', `SELECT * FROM SFCTA WITH (NOLOCK) WHERE TA001='${a.replace(/'/g, '')}' AND TA002='${b.replace(/'/g, '')}' ORDER BY TA003`) || []).forEach((r, i) => log(`--- ${i + 1}: ` + fmt(r)));
  }

  log('\n##### SFCTA 製程（最近 5 筆，看有沒有在用）');
  (await q('SFCTA', `SELECT TOP 5 * FROM SFCTA WITH (NOLOCK) ORDER BY CREATE_DATE DESC`) || []).forEach((r, i) => log(`--- ${i + 1}: ` + fmt(r)));
  log('\n##### CMSMD 工作中心（全部）');
  (await q('CMSMD', `SELECT * FROM CMSMD WITH (NOLOCK) ORDER BY MD001`) || []).forEach((r, i) => log(`--- ${i + 1}: ` + fmt(r)));
  log('\n##### BOMMD BOM 單身（最近 5 筆）');
  (await q('BOMMD', `SELECT TOP 5 * FROM BOMMD WITH (NOLOCK) ORDER BY CREATE_DATE DESC`) || []).forEach((r, i) => log(`--- ${i + 1}: ` + fmt(r)));

  await pool.close(); finish(0);
})().catch(e => { log('發生錯誤：' + (e.message || e)); finish(1); });
