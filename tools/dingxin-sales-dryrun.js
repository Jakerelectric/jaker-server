'use strict';
/**
 * 鼎新銷貨單 → 系統「試算」（只讀，不寫入任何一邊）
 *   比對鼎新 COPTG／COPTH 與系統的銷貨單：哪些要新增、哪些一樣、哪些有差異、哪些只有系統有
 *   用法：node tools/dingxin-sales-dryrun.js [起始日 YYYYMMDD，預設 120 天前]
 *   結果：data\dingxin-sales-dryrun.txt
 *
 * 欄位對照（依 2026-11-23 抽樣確認）
 *   COPTG：TG001 單別、TG002 單號、TG003 銷貨日、TG004 客戶代號、TG007 客戶全名、TG006 業務員、TG011 幣別(NTD→TWD)、
 *          TG013 未稅金額、TG025 稅額、TG044 稅率、TG023 確認碼(Y 已確認／N 未確認／V 作廢)、TG014 發票號碼
 *   COPTH：TH003 序號、TH004 品號、TH005 品名、TH006 規格、TH007 庫別、TH008 數量、TH009 單位、TH012 單價、TH013 金額、
 *          TH014／TH015 來源訂單單別／單號
 */
const path = require('path');
const fs = require('fs');
const ROOT = path.resolve(__dirname, '..');
const DATA = path.join(ROOT, 'data');
const out = [];
const log = (...a) => { const s = a.join(' '); console.log(s); out.push(s); };
const finish = code => { try { fs.mkdirSync(DATA, { recursive: true }); fs.writeFileSync(path.join(DATA, 'dingxin-sales-dryrun.txt'), out.join('\r\n'), 'utf8'); console.log('\n結果已存到：' + path.join(DATA, 'dingxin-sales-dryrun.txt')); } catch (e) { console.log('寫檔失敗：' + e.message); } process.exitCode = code; };
let sql; try { sql = require('mssql'); } catch (e) { log('這台主機還沒有安裝 mssql 套件，請先更新。'); finish(1); return; }
const { loadConfig, readEnvFile } = require('../src/config');
const { Store } = require('../src/store');
const { loadErpSchema } = require('../src/erp-schema');

const t = v => (v == null ? '' : String(v).trim());
const n = v => Math.round((Number(v) || 0) * 10000) / 10000;
const ymd = v => { v = t(v); return /^\d{8}$/.test(v) ? `${v.slice(0, 4)}-${v.slice(4, 6)}-${v.slice(6)}` : v; };
const cur = v => (t(v).toUpperCase() === 'NTD' ? 'TWD' : t(v).toUpperCase());
const toObjs = d => { if (!d || !d.length) return []; const [h, ...r] = d; return r.map(x => Object.fromEntries(h.map((k, i) => [k, x[i]]))); };
// 系統資料表的表頭是中文（例如「品號」），換成程式欄位名（code）
const sheetObjs = (store, schema, key) => { const d = store.sheets.get(schema.TAB[key]); if (!d || !d.length) return [];
  const lab = {}; (schema.F[key] || []).forEach(f => { lab[String(f[1]).trim()] = f[0]; });
  const [h, ...r] = d; const ks = h.map(x => lab[String(x == null ? '' : x).trim()] || String(x)); return r.map(x => Object.fromEntries(ks.map((k, i) => [k, x[i]]))); };

(async () => {
  const env = Object.assign(readEnvFile(path.join(ROOT, '.env')), process.env);
  const since = process.argv[2] || (() => { const d = new Date(Date.now() - 120 * 864e5); return d.toISOString().slice(0, 10).replace(/-/g, ''); })();
  log('== 鼎新銷貨單試算（只讀，不寫入）' + new Date().toLocaleString('zh-TW') + '　銷貨日 ≥ ' + ymd(since));

  // 1) 鼎新
  const pool = await new sql.ConnectionPool({ server: env.DINGXIN_HOST || '192.168.0.51', port: Number(env.DINGXIN_PORT) || 1433, user: env.DINGXIN_USER, password: env.DINGXIN_PASSWORD,
    database: env.DINGXIN_DB || 'JAKER', connectionTimeout: 15000, requestTimeout: 60000, options: { encrypt: false, trustServerCertificate: true, readOnlyIntent: true } }).connect();
  const H = (await pool.request().input('d', sql.VarChar, since).query(
    `SELECT TG001,TG002,TG003,TG004,TG006,TG007,TG011,TG013,TG014,TG023,TG025,TG044 FROM COPTG WITH (NOLOCK) WHERE TG003 >= @d`)).recordset;
  const L = (await pool.request().input('d', sql.VarChar, since).query(
    `SELECT h.TH001,h.TH002,h.TH003,h.TH004,h.TH005,h.TH006,h.TH007,h.TH008,h.TH009,h.TH012,h.TH013,h.TH014,h.TH015 FROM COPTH h WITH (NOLOCK)
     JOIN COPTG g WITH (NOLOCK) ON g.TG001 = h.TH001 AND g.TG002 = h.TH002 WHERE g.TG003 >= @d`)).recordset;
  await pool.close();
  const dx = {};
  H.forEach(g => { const no = `${t(g.TG001)}-${t(g.TG002)}`; dx[no] = { no, date: ymd(g.TG003), custCode: t(g.TG004), customer: t(g.TG007), salesId: t(g.TG006), currency: cur(g.TG011),
    amount: n(g.TG013), tax: n(g.TG025), taxRate: n(g.TG044), invoice: t(g.TG014), confirm: t(g.TG023), lines: [] }; });
  L.forEach(h => { const no = `${t(h.TH001)}-${t(h.TH002)}`; const s = dx[no]; if (!s) return;
    s.lines.push({ seq: Number(h.TH003), itemCode: t(h.TH004), name: t(h.TH005), spec: t(h.TH006), wh: t(h.TH007), qty: n(h.TH008), unit: t(h.TH009), price: n(h.TH012), amt: n(h.TH013),
      orderNo: t(h.TH014) && t(h.TH015) ? `${t(h.TH014)}-${t(h.TH015)}` : '' }); });
  const D = Object.values(dx);
  log(`鼎新：${D.length} 張銷貨單（已確認 ${D.filter(x => x.confirm === 'Y').length}、未確認 ${D.filter(x => x.confirm === 'N').length}、作廢 ${D.filter(x => x.confirm === 'V').length}），明細 ${L.length} 筆`);

  // 2) 系統
  const cfg = loadConfig(ROOT); const schema = loadErpSchema(path.join(ROOT, 'apps', 'erp'));
  const store = new Store(cfg.db, { prefix: 'erp_', tableName: schema.tableName, defFor: schema.defFor });
  await store.open();
  const S = sheetObjs(store, schema, 'sales'), SL = sheetObjs(store, schema, 'salesLines');
  await store.close();
  const sys = {}; S.forEach(x => { sys[t(x.no)] = { ...x, lines: [] }; }); SL.forEach(l => { const s = sys[t(l.saleNo)]; if (s) s.lines.push(l); });
  log(`系統：${S.length} 張銷貨單（全部期間）`);

  // 3) 比對
  const add = [], same = [], diff = [], voidInDx = [];
  D.forEach(d => {
    const s = sys[d.no];
    if (!s) { if (d.confirm === 'V') voidInDx.push(d); else add.push(d); return; }
    const why = [];
    if (t(s.custCode) && t(s.custCode) !== d.custCode) why.push(`客戶 ${s.custCode}→${d.custCode}`);
    if (t(s.currency) && cur(s.currency) !== d.currency) why.push(`幣別 ${s.currency}→${d.currency}`);
    if (d.confirm === 'V' && s.status !== '作廢') why.push(`鼎新已作廢（系統：${s.status}）`);
    const key = l => `${t(l.itemCode).toUpperCase()}`;
    const sum = (arr, f) => arr.reduce((m, l) => { m[key(l)] = n((m[key(l)] || 0) + Number(f(l) || 0)); return m; }, {});
    const qs = sum(s.lines, l => l.qty), qd = sum(d.lines, l => l.qty);
    [...new Set([...Object.keys(qs), ...Object.keys(qd)])].forEach(k => { if (n(qs[k]) !== n(qd[k])) why.push(`${k} 數量 系統 ${n(qs[k])}／鼎新 ${n(qd[k])}`); });
    // 單價：同一品號可能有好幾行（例如 Z99 費用），比「價格組合」而不是一個一個比
    const pset = arr => { const m = {}; arr.forEach(l => { if (String(l.free || '')) return; const k = key(l); (m[k] = m[k] || []).push(n(l.price)); }); Object.keys(m).forEach(k => { m[k] = [...new Set(m[k])].sort((a, b) => a - b); }); return m; };
    const pS = pset(s.lines), pD = pset(d.lines);
    Object.keys(pD).forEach(k => { if (pS[k] && pS[k].join('/') !== pD[k].join('/')) why.push(`${k} 單價 系統 ${pS[k].join('/')}／鼎新 ${pD[k].join('/')}`); });
    (why.length ? diff : same).push({ d, s, why });
  });
  const onlySys = S.filter(x => !dx[t(x.no)] && String(x.date || '').replace(/-/g, '').slice(0, 8) >= since);

  log(`\n=== 結果 ===`);
  log(`會新增（系統沒有）：${add.length} 張`);
  log(`已一致（只會補齊空白欄位）：${same.length} 張`);
  log(`有差異（不會自動覆蓋，請確認）：${diff.length} 張`);
  log(`只有系統有（保留不動）：${onlySys.length} 張`);
  if (voidInDx.length) log(`鼎新已作廢、系統沒有（不新增）：${voidInDx.length} 張`);

  log(`\n--- 會新增 ---`);
  add.sort((a, b) => a.no.localeCompare(b.no)).forEach(d => log(`${d.no}　${d.date}　${d.customer}　${d.currency} ${d.amount}　${d.lines.length} 項${d.confirm !== 'Y' ? '　（鼎新未確認）' : ''}${d.invoice ? '　發票 ' + d.invoice : ''}`));
  log(`\n--- 有差異 ---`);
  diff.forEach(x => log(`${x.d.no}　${x.d.customer}：${x.why.join('；')}`));
  log(`\n--- 只有系統有 ---`);
  onlySys.forEach(x => log(`${x.no}　${x.date}　${x.customer}　${x.status}`));
  finish(0);
})().catch(e => { log('發生錯誤：' + (e.message || e)); finish(1); });
