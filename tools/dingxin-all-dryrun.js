'use strict';
/**
 * 鼎新其他資料 → 系統「試算」（只讀，不寫入任何一邊）
 *   一次比對：訂單（COPTC/COPTD）、採購單（PURTC/PURTD，待進料）、品號（INVMB）、客戶（COPMA）、庫存（INVMC，只對照不覆蓋）
 *   用法：node tools/dingxin-all-dryrun.js [訂單／採購起始日 YYYYMMDD，預設 180 天前]
 *   結果：data\dingxin-all-dryrun.txt
 *
 * 欄位對照（2026-11-23 抽樣確認；INVMB／INVMC／COPMA／PURMA 依鼎新標準欄位，報告裡會附第一筆原始資料供核對）
 *   COPTC：TC001/TC002 單別號、TC003 訂單日、TC004 客戶代號、TC053 客戶全名、TC006 業務員、TC008 幣別、TC012 客戶單號、TC027 確認碼、TC041 稅率
 *   COPTD：TD003 序號、TD004 品號、TD005 品名、TD006 規格、TD008 訂單量、TD009 已交量、TD010 單位、TD011 單價、TD013 預交日、TD016 結案碼
 *   PURTC：TC001/TC002、TC003 採購日、TC004 廠商代號、TC005 幣別、TC014 確認碼
 *   PURTD：TD004 品號、TD005 品名、TD006 規格、TD007 庫別、TD008 採購量、TD009 單位、TD012 預交日、TD015 已交量、TD016 結案碼、TD018 確認碼
 *   INVMB：MB001 品號、MB002 品名、MB003 規格、MB004 庫存單位
 *   INVMC：MC001 品號、MC002 庫別、MC007 庫存數量
 *   COPMA：MA001 客戶代號、MA002 簡稱、MA003 全名　PURMA：MA001 廠商代號、MA002 簡稱
 */
const path = require('path');
const fs = require('fs');
const ROOT = path.resolve(__dirname, '..');
const DATA = path.join(ROOT, 'data');
const FILE = path.join(DATA, 'dingxin-all-dryrun.txt');
const out = [];
const log = (...a) => { const s = a.join(' '); console.log(s); out.push(s); };
const finish = code => { try { fs.mkdirSync(DATA, { recursive: true }); fs.writeFileSync(FILE, out.join('\r\n'), 'utf8'); console.log('\n結果已存到：' + FILE); } catch (e) { console.log('寫檔失敗：' + e.message); } process.exitCode = code; };
let sql; try { sql = require('mssql'); } catch (e) { log('這台主機還沒有安裝 mssql 套件，請先更新。'); finish(1); return; }
const { loadConfig, readEnvFile } = require('../src/config');
const { Store } = require('../src/store');
const { loadErpSchema } = require('../src/erp-schema');

const t = v => (v == null ? '' : String(v).trim());
const n = v => Math.round((Number(v) || 0) * 10000) / 10000;
const ymd = v => { v = t(v); return /^\d{8}$/.test(v) ? `${v.slice(0, 4)}-${v.slice(4, 6)}-${v.slice(6)}` : v; };
const cur = v => (t(v).toUpperCase() === 'NTD' ? 'TWD' : t(v).toUpperCase());
const toObjs = d => { if (!d || !d.length) return []; const [h, ...r] = d; return r.map(x => Object.fromEntries(h.map((k, i) => [k, x[i]]))); };
const U = s => t(s).toUpperCase();
const MAX = 60;  // 每個清單最多列幾筆，其餘只算數量
const list = (title, arr, fmt) => { log(`\n--- ${title}（${arr.length}）---`); arr.slice(0, MAX).forEach(x => log(fmt(x))); if (arr.length > MAX) log(`…其餘 ${arr.length - MAX} 筆略`); };
const raw = r => r ? Object.entries(r).filter(([, v]) => t(v) !== '').map(([k, v]) => `${k}=${t(v)}`).join(' | ').slice(0, 900) : '（無資料）';

(async () => {
  const env = Object.assign(readEnvFile(path.join(ROOT, '.env')), process.env);
  const since = process.argv[2] || (() => { const d = new Date(Date.now() - 180 * 864e5); return d.toISOString().slice(0, 10).replace(/-/g, ''); })();
  const today = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  log('== 鼎新其他資料試算（只讀，不寫入）' + new Date().toLocaleString('zh-TW') + '　訂單／採購日 ≥ ' + ymd(since));

  const pool = await new sql.ConnectionPool({ server: env.DINGXIN_HOST || '192.168.0.51', port: Number(env.DINGXIN_PORT) || 1433, user: env.DINGXIN_USER, password: env.DINGXIN_PASSWORD,
    database: env.DINGXIN_DB || 'JAKER', connectionTimeout: 15000, requestTimeout: 120000, options: { encrypt: false, trustServerCertificate: true, readOnlyIntent: true } }).connect();
  const q = async (label, text) => { try { return (await pool.request().input('d', sql.VarChar, since).query(text)).recordset; } catch (e) { log(`（讀取 ${label} 失敗：${e.message}）`); return null; } };

  // 系統資料
  const cfg = loadConfig(ROOT); const schema = loadErpSchema(path.join(ROOT, 'apps', 'erp'));
  const store = new Store(cfg.db, { prefix: 'erp_', tableName: schema.tableName, defFor: schema.defFor });
  await store.open();
  const sheet = k => toObjs(store.sheets.get(k));
  const sItems = sheet('品號'), sStock = sheet('庫存'), sOrders = sheet('訂單'), sOL = sheet('訂單單身'), sCust = sheet('客戶');
  await store.close();
  const itemSet = new Map(); sItems.forEach(i => { itemSet.set(U(i.code), i); String(i.alias || '').split(/[,，;；、\s]+/).filter(Boolean).forEach(a => itemSet.has(U(a)) || itemSet.set(U(a), i)); });

  // ===== 1. 品號 =====
  log('\n######## 1. 品號（INVMB）########');
  const MB = await q('INVMB', `SELECT MB001,MB002,MB003,MB004 FROM INVMB WITH (NOLOCK)`);
  if (MB) {
    log('第一筆原始資料：' + raw((await q('INVMB', `SELECT TOP 1 * FROM INVMB WITH (NOLOCK)`) || [])[0]));
    const add = [], diff = []; let same = 0;
    MB.forEach(m => { const code = t(m.MB001); if (!code) return; const s = itemSet.get(U(code));
      if (!s) { add.push(m); return; }
      const why = []; if (t(m.MB002) && t(s.name) !== t(m.MB002)) why.push(`品名 系統「${t(s.name)}」／鼎新「${t(m.MB002)}」`);
      if (t(m.MB004) && t(s.unit) && U(s.unit) !== U(m.MB004)) why.push(`單位 ${t(s.unit)}／${t(m.MB004)}`);
      if (why.length) diff.push({ code, why }); else same++; });
    const dxSet = new Set(MB.map(m => U(m.MB001)));
    const onlySys = sItems.filter(i => !dxSet.has(U(i.code)) && !String(i.alias || '').split(/[,，;；、\s]+/).some(a => dxSet.has(U(a))));
    log(`鼎新 ${MB.length} 個品號／系統 ${sItems.length} 個`);
    log(`會新增：${add.length}　已一致：${same}　名稱或單位不同（不覆蓋，只列出）：${diff.length}　只有系統有：${onlySys.length}`);
    list('品號 會新增（前 60）', add, m => `${t(m.MB001)}　${t(m.MB002)}　${t(m.MB003)}　${t(m.MB004)}`);
    list('品號 名稱或單位不同', diff, x => `${x.code}：${x.why.join('；')}`);
    list('品號 只有系統有', onlySys, i => `${i.code}　${i.name}`);
  }

  // ===== 2. 客戶 =====
  log('\n######## 2. 客戶（COPMA）########');
  const MA = await q('COPMA', `SELECT MA001,MA002,MA003 FROM COPMA WITH (NOLOCK)`);
  if (MA) {
    const sc = new Map(sCust.map(c => [U(c.code), c]));
    const add = MA.filter(m => t(m.MA001) && !sc.has(U(m.MA001)));
    const diff = MA.filter(m => sc.has(U(m.MA001)) && t(m.MA003) && t(sc.get(U(m.MA001)).full) && t(sc.get(U(m.MA001)).full) !== t(m.MA003));
    log(`鼎新 ${MA.length} 個客戶／系統 ${sCust.length} 個　會新增：${add.length}　全名不同：${diff.length}`);
    list('客戶 會新增', add, m => `${t(m.MA001)}　${t(m.MA002)}　${t(m.MA003)}`);
    list('客戶 全名不同', diff, m => `${t(m.MA001)}：系統「${t(sc.get(U(m.MA001)).full)}」／鼎新「${t(m.MA003)}」`);
  }

  // ===== 3. 訂單 =====
  log('\n######## 3. 訂單（COPTC／COPTD）########');
  const TC = await q('COPTC', `SELECT TC001,TC002,TC003,TC004,TC006,TC008,TC012,TC027,TC041,TC053 FROM COPTC WITH (NOLOCK) WHERE TC003 >= @d`);
  const TD = await q('COPTD', `SELECT d.TD001,d.TD002,d.TD003,d.TD004,d.TD005,d.TD008,d.TD009,d.TD010,d.TD011,d.TD013,d.TD016 FROM COPTD d WITH (NOLOCK)
     JOIN COPTC c WITH (NOLOCK) ON c.TC001=d.TD001 AND c.TC002=d.TD002 WHERE c.TC003 >= @d`);
  if (TC && TD) {
    const dx = {}; TC.forEach(c => { const no = `${t(c.TC001)}-${t(c.TC002)}`; dx[no] = { no, date: ymd(c.TC003), cust: t(c.TC004), customer: t(c.TC053), currency: cur(c.TC008), custPO: t(c.TC012), confirm: t(c.TC027), lines: [] }; });
    TD.forEach(d => { const o = dx[`${t(d.TD001)}-${t(d.TD002)}`]; if (o) o.lines.push({ itemCode: t(d.TD004), qty: n(d.TD008), done: n(d.TD009), price: n(d.TD011), due: ymd(d.TD013), closed: t(d.TD016) }); });
    const sys = {}; sOrders.forEach(o => { const k = t(o.erpNo) || t(o.no); sys[k] = { ...o, lines: [] }; if (t(o.erpNo) && t(o.no) !== t(o.erpNo)) sys[t(o.no)] = sys[k]; });
    sOL.forEach(l => { const o = Object.values(sys).find(x => t(x.no) === t(l.orderNo)); if (o && !o.lines.includes(l)) o.lines.push(l); });
    const add = [], diff = [], voids = []; let same = 0;
    Object.values(dx).forEach(d => { const s = sys[d.no];
      if (!s) { (d.confirm === 'V' ? voids : add).push(d); return; }
      const why = []; if (t(s.custCode) && U(s.custCode) !== U(d.cust)) why.push(`客戶 ${s.custCode}→${d.cust}`);
      const sum = (arr, f) => arr.reduce((m, l) => { const k = U(l.itemCode); m[k] = n((m[k] || 0) + Number(f(l) || 0)); return m; }, {});
      const qs = sum(s.lines, l => l.qty), qd = sum(d.lines, l => l.qty);
      [...new Set([...Object.keys(qs), ...Object.keys(qd)])].forEach(k => { if (n(qs[k]) !== n(qd[k])) why.push(`${k} 數量 系統 ${n(qs[k])}／鼎新 ${n(qd[k])}`); });
      if (why.length) diff.push({ d, why }); else same++; });
    const open = Object.values(dx).filter(d => d.confirm === 'Y' && d.lines.some(l => l.closed === 'N' && l.qty > l.done));
    const noItem = [...new Set(TD.map(d => t(d.TD004)).filter(c => c && !itemSet.has(U(c))))];
    log(`鼎新 ${TC.length} 張訂單（未結案 ${open.length}）／系統 ${sOrders.length} 張`);
    log(`會新增：${add.length}　已一致：${same}　有差異（不覆蓋）：${diff.length}　鼎新作廢不新增：${voids.length}　品號系統沒有：${noItem.length}`);
    list('訂單 會新增', add.sort((a, b) => a.no.localeCompare(b.no)), d => `${d.no}　${d.date}　${d.customer}　${d.lines.length} 項${d.custPO ? '　客戶單號 ' + d.custPO : ''}${d.confirm !== 'Y' ? '　（鼎新未確認）' : ''}`);
    list('訂單 有差異', diff, x => `${x.d.no}　${x.d.customer}：${x.why.join('；')}`);
    list('訂單用到、但系統沒有的品號', noItem, c => c);
  }

  // ===== 4. 採購單 / 待進料 =====
  log('\n######## 4. 採購單（PURTC／PURTD）→ 待進料 ########');
  const PC = await q('PURTC', `SELECT c.TC001,c.TC002,c.TC003,c.TC004,c.TC005,c.TC014,v.MA002 AS VNAME FROM PURTC c WITH (NOLOCK) LEFT JOIN PURMA v WITH (NOLOCK) ON v.MA001=c.TC004 WHERE c.TC003 >= @d`)
    || await q('PURTC', `SELECT TC001,TC002,TC003,TC004,TC005,TC014 FROM PURTC WITH (NOLOCK) WHERE TC003 >= @d`);
  const PD = await q('PURTD', `SELECT d.TD001,d.TD002,d.TD003,d.TD004,d.TD005,d.TD006,d.TD007,d.TD008,d.TD009,d.TD012,d.TD015,d.TD016,d.TD018 FROM PURTD d WITH (NOLOCK)
     JOIN PURTC c WITH (NOLOCK) ON c.TC001=d.TD001 AND c.TC002=d.TD002 WHERE c.TC003 >= @d`);
  if (PC && PD) {
    const hd = {}; PC.forEach(c => hd[`${t(c.TC001)}-${t(c.TC002)}`] = c);
    const pend = PD.filter(d => t(d.TD016) === 'N' && t(d.TD018) === 'Y' && n(d.TD008) > n(d.TD015))
      .map(d => { const h = hd[`${t(d.TD001)}-${t(d.TD002)}`] || {}; return { no: `${t(d.TD001)}-${t(d.TD002)}`, seq: t(d.TD003), item: t(d.TD004), name: t(d.TD005), wh: t(d.TD007),
        left: n(n(d.TD008) - n(d.TD015)), unit: t(d.TD009), due: ymd(d.TD012), vendor: t(h.VNAME) || t(h.TC004) }; })
      .sort((a, b) => a.due.localeCompare(b.due));
    const td = ymd(today); const in14 = ymd(new Date(Date.now() + 14 * 864e5).toISOString().slice(0, 10).replace(/-/g, ''));
    const late = pend.filter(p => p.due && p.due < td), soon = pend.filter(p => p.due >= td && p.due <= in14);
    const noItem = [...new Set(pend.map(p => p.item).filter(c => c && !itemSet.has(U(c))))];
    log(`鼎新 ${PC.length} 張採購單、明細 ${PD.length} 筆；還沒進完的料 ${pend.length} 筆（已過預交日 ${late.length}、14 天內要到 ${soon.length}）；品號系統沒有：${noItem.length}`);
    log('（系統目前還沒有採購單，正式匯入時會新增「採購單」與「待進料」頁，不影響庫存）');
    list('已過預交日、還沒進', late, p => `${p.due}　${p.vendor}　${p.no}-${p.seq}　${p.item} ${p.name}　剩 ${p.left} ${p.unit}　入 ${p.wh}`);
    list('14 天內要進料', soon, p => `${p.due}　${p.vendor}　${p.no}-${p.seq}　${p.item} ${p.name}　剩 ${p.left} ${p.unit}　入 ${p.wh}`);
    list('待進料用到、但系統沒有的品號', noItem, c => c);
  }

  // ===== 5. 庫存對照（只對照，不覆蓋）=====
  log('\n######## 5. 庫存對照（INVMC，只對照、不會覆蓋系統庫存）########');
  const MC = await q('INVMC', `SELECT MC001,MC002,MC007 FROM INVMC WITH (NOLOCK) WHERE MC007 <> 0`);
  if (MC) {
    log('第一筆原始資料：' + raw((await q('INVMC', `SELECT TOP 1 * FROM INVMC WITH (NOLOCK) WHERE MC007 <> 0`) || [])[0]));
    const dq = {}; MC.forEach(m => { const k = U(m.MC001); dq[k] = n((dq[k] || 0) + n(m.MC007)); });
    const sq = {}; sStock.forEach(s => { const it = itemSet.get(U(s.itemId)); const k = U(it ? it.code : s.itemId); sq[k] = n((sq[k] || 0) + n(s.qty)); });
    // 鼎新的品號可能是系統的舊料號：換成系統品號再比
    const dq2 = {}; Object.entries(dq).forEach(([k, v]) => { const it = itemSet.get(k); const kk = U(it ? it.code : k); dq2[kk] = n((dq2[kk] || 0) + v); });
    const keys = [...new Set([...Object.keys(dq2), ...Object.keys(sq)])];
    const diffs = keys.filter(k => n(dq2[k]) !== n(sq[k])).map(k => ({ k, s: n(sq[k]), d: n(dq2[k]) })).sort((a, b) => Math.abs(b.d - b.s) - Math.abs(a.d - a.s));
    log(`比對 ${keys.length} 個品號：一樣 ${keys.length - diffs.length}、不一樣 ${diffs.length}（差最多的排前面）`);
    list('庫存不一樣', diffs, x => `${x.k}　系統 ${x.s}／鼎新 ${x.d}　差 ${n(x.d - x.s)}`);
  }

  await pool.close();
  log('\n== 以上都只是試算，兩邊資料都沒有改動。');
  finish(0);
})().catch(e => { log('發生錯誤：' + (e.message || e)); finish(1); });
