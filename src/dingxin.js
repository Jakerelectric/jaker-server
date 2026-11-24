'use strict';
/**
 * 鼎新（SQL Server）只讀連線：抓未結案製令（MOCTA）與製令製程（SFCTA）
 *   帳密只放在主機 .env：DINGXIN_USER、DINGXIN_PASSWORD（可選 DINGXIN_HOST / DINGXIN_PORT / DINGXIN_DB）
 *   一律 WITH (NOLOCK)、readOnlyIntent，不會寫入鼎新
 */
const path = require('path');
const { readEnvFile } = require('./config');

const t = v => (v == null ? '' : String(v).trim());
const n = v => Math.round((Number(v) || 0) * 10000) / 10000;
const ymd = v => { v = t(v); return /^\d{8}$/.test(v) ? `${v.slice(0, 4)}-${v.slice(4, 6)}-${v.slice(6)}` : ''; };
const MO_STATUS = { 1: '未生產', 2: '已發料', 3: '生產中' };

async function withPool(root, fn) {
  let sql; try { sql = require('mssql'); } catch (e) { throw new Error('主機還沒有安裝 mssql 套件，請先更新。'); }
  const env = Object.assign(readEnvFile(path.join(root, '.env')), process.env);
  if (!env.DINGXIN_USER || !env.DINGXIN_PASSWORD) throw new Error('主機 .env 還沒有設定 DINGXIN_USER、DINGXIN_PASSWORD。');
  const pool = await new sql.ConnectionPool({ server: env.DINGXIN_HOST || '192.168.0.51', port: Number(env.DINGXIN_PORT) || 1433,
    user: env.DINGXIN_USER, password: env.DINGXIN_PASSWORD, database: env.DINGXIN_DB || 'JAKER',
    connectionTimeout: 15000, requestTimeout: 120000, options: { encrypt: false, trustServerCertificate: true, readOnlyIntent: true } }).connect();
  try { return await fn(pool); } finally { await pool.close().catch(() => {}); }
}

/** 未結案（狀態 1 未生產、2 已發料、3 生產中）且已確認的製令，連同製程 */
async function fetchOpenMos(root) {
  return withPool(root, async pool => {
    const W = `m.TA011 IN ('1','2','3') AND m.TA013 = 'Y'`;
    const heads = (await pool.request().query(`SELECT m.TA001,m.TA002,m.TA003,m.TA006,m.TA007,m.TA009,m.TA010,m.TA011,m.TA015,m.TA017,m.TA020,m.TA021,
        m.TA026,m.TA027,m.TA028,m.TA029,m.TA034,m.TA035 FROM MOCTA m WITH (NOLOCK) WHERE ${W}`)).recordset;
    const ops = (await pool.request().query(`SELECT s.TA001,s.TA002,s.TA003,s.TA004,s.TA005,s.TA006,s.TA007,s.TA008,s.TA009,s.TA024
        FROM SFCTA s WITH (NOLOCK) JOIN MOCTA m WITH (NOLOCK) ON m.TA001 = s.TA001 AND m.TA002 = s.TA002 WHERE ${W}`)).recordset;
    const mos = heads.map(h => ({
      no: `${t(h.TA001)}-${t(h.TA002)}`, date: ymd(h.TA003), itemCode: t(h.TA006), name: t(h.TA034), spec: t(h.TA035), unit: t(h.TA007),
      qty: n(h.TA015), made: n(h.TA017), startDate: ymd(h.TA009), dueDate: ymd(h.TA010), status: MO_STATUS[t(h.TA011)] || t(h.TA011),
      whIn: t(h.TA020), line: t(h.TA021), orderNo: t(h.TA027) ? `${t(h.TA026)}-${t(h.TA027)}${t(h.TA028) ? '-' + t(h.TA028) : ''}` : '', note: t(h.TA029)
    })).sort((a, b) => a.no.localeCompare(b.no));
    const opRows = ops.map(o => ({
      moNo: `${t(o.TA001)}-${t(o.TA002)}`, seq: t(o.TA003), opCode: t(o.TA004), kind: t(o.TA005) === '2' ? '委外' : '廠內',
      wc: t(o.TA006), wcName: t(o.TA007), desc: t(o.TA024), startDate: ymd(o.TA008), dueDate: ymd(o.TA009)
    })).sort((a, b) => a.moNo.localeCompare(b.moNo) || a.seq.localeCompare(b.seq));
    return { mos, ops: opRows };
  });
}

/** 還沒進完的採購明細（已確認、未結案、採購量 > 已交量），連同單頭與廠商簡稱 */
async function fetchOpenPos(root) {
  return withPool(root, async pool => {
    const rows = (await pool.request().query(`SELECT d.TD001,d.TD002,d.TD003,d.TD004,d.TD005,d.TD006,d.TD007,d.TD008,d.TD009,d.TD012,d.TD013,d.TD015,d.TD021,
        c.TC003,c.TC004,c.TC005,v.MA002 AS VNAME
      FROM PURTD d WITH (NOLOCK) JOIN PURTC c WITH (NOLOCK) ON c.TC001 = d.TD001 AND c.TC002 = d.TD002
      LEFT JOIN PURMA v WITH (NOLOCK) ON v.MA001 = c.TC004
      WHERE d.TD016 = 'N' AND d.TD018 = 'Y' AND d.TD008 > d.TD015`)).recordset;
    const heads = {}; const lines = rows.map(r => {
      const no = `${t(r.TD001)}-${t(r.TD002)}`; const vendor = t(r.VNAME) || t(r.TC004);
      if (!heads[no]) heads[no] = { no, date: ymd(r.TC003), vendorCode: t(r.TC004), vendor, currency: t(r.TC005).toUpperCase() === 'NTD' ? 'TWD' : t(r.TC005) };
      return { poNo: no, seq: t(r.TD003), itemCode: t(r.TD004), name: t(r.TD005), spec: t(r.TD006), unit: t(r.TD009), wh: t(r.TD007),
        qty: n(r.TD008), recvQty: n(r.TD015), leftQty: n(n(r.TD008) - n(r.TD015)), dueDate: ymd(r.TD012), vendor,
        woNo: t(r.TD013) && t(r.TD021) ? `${t(r.TD013)}-${t(r.TD021)}` : '' };
    }).sort((a, b) => a.dueDate.localeCompare(b.dueDate) || a.poNo.localeCompare(b.poNo) || a.seq.localeCompare(b.seq));
    return { pos: Object.values(heads).sort((a, b) => a.no.localeCompare(b.no)), lines };
  });
}

const cur = v => (t(v).toUpperCase() === 'NTD' ? 'TWD' : t(v).toUpperCase());
const since = days => { const d = new Date(Date.now() - days * 864e5); return d.toISOString().slice(0, 10).replace(/-/g, ''); };
/**
 * 正式匯入用：訂單（近 180 天）、銷貨單（近 120 天，只取已確認）、以及「用得到」的品號
 *   用得到 = 這些訂單／銷貨單／未結案製令／未進料採購的品號，加上鼎新有庫存的品號（費用品 Z9x 除外）
 */
async function fetchImport(root, extraCodes) {
  return withPool(root, async pool => {
    const rq = () => pool.request();
    const oS = since(180), sS = since(120);
    const TC = (await rq().input('d', oS).query(`SELECT TC001,TC002,TC003,TC004,TC008,TC012,TC027,TC041,TC053 FROM COPTC WITH (NOLOCK) WHERE TC003 >= @d AND TC027 <> 'V'`)).recordset;
    const TD = (await rq().input('d', oS).query(`SELECT d.TD001,d.TD002,d.TD003,d.TD004,d.TD005,d.TD006,d.TD008,d.TD009,d.TD010,d.TD011,d.TD013,d.TD016
      FROM COPTD d WITH (NOLOCK) JOIN COPTC c WITH (NOLOCK) ON c.TC001 = d.TD001 AND c.TC002 = d.TD002 WHERE c.TC003 >= @d AND c.TC027 <> 'V'`)).recordset;
    const TG = (await rq().input('d', sS).query(`SELECT TG001,TG002,TG003,TG004,TG007,TG011,TG044 FROM COPTG WITH (NOLOCK) WHERE TG003 >= @d AND TG023 = 'Y'`)).recordset;
    const TH = (await rq().input('d', sS).query(`SELECT h.TH001,h.TH002,h.TH003,h.TH004,h.TH005,h.TH006,h.TH008,h.TH009,h.TH012,h.TH014,h.TH015
      FROM COPTH h WITH (NOLOCK) JOIN COPTG g WITH (NOLOCK) ON g.TG001 = h.TH001 AND g.TG002 = h.TH002 WHERE g.TG003 >= @d AND g.TG023 = 'Y'`)).recordset;
    const MC = (await rq().query(`SELECT DISTINCT MC001 FROM INVMC WITH (NOLOCK) WHERE MC007 <> 0`)).recordset;
    const orders = {}; TC.forEach(c => { const no = `${t(c.TC001)}-${t(c.TC002)}`;
      orders[no] = { no, date: ymd(c.TC003), custCode: t(c.TC004), customer: t(c.TC053), custPO: t(c.TC012), currency: cur(c.TC008), taxRate: n(c.TC041), confirmed: t(c.TC027) === 'Y', lines: [] }; });
    TD.forEach(d => { const o = orders[`${t(d.TD001)}-${t(d.TD002)}`]; if (!o) return;
      o.lines.push({ seq: Number(t(d.TD003)) || o.lines.length + 1, itemCode: t(d.TD004), name: t(d.TD005), spec: t(d.TD006), qty: n(d.TD008), done: n(d.TD009),
        unit: t(d.TD010), price: n(d.TD011), dueDate: ymd(d.TD013), closed: t(d.TD016) !== 'N' }); });
    const sales = {}; TG.forEach(g => { const no = `${t(g.TG001)}-${t(g.TG002)}`;
      sales[no] = { no, date: ymd(g.TG003), custCode: t(g.TG004), customer: t(g.TG007), currency: cur(g.TG011), taxRate: n(g.TG044), lines: [] }; });
    TH.forEach(h => { const x = sales[`${t(h.TH001)}-${t(h.TH002)}`]; if (!x) return;
      x.lines.push({ seq: Number(t(h.TH003)) || x.lines.length + 1, itemCode: t(h.TH004), name: t(h.TH005), spec: t(h.TH006), qty: n(h.TH008), unit: t(h.TH009),
        price: n(h.TH012), orderNo: t(h.TH014) && t(h.TH015) ? `${t(h.TH014)}-${t(h.TH015)}` : '' }); });
    const want = new Set((extraCodes || []).map(t));
    Object.values(orders).forEach(o => o.lines.forEach(l => want.add(l.itemCode)));
    Object.values(sales).forEach(x => x.lines.forEach(l => want.add(l.itemCode)));
    MC.forEach(r => want.add(t(r.MC001)));
    const items = []; const all = (await rq().query(`SELECT MB001,MB002,MB003,MB004,MB017 FROM INVMB WITH (NOLOCK)`)).recordset;
    all.forEach(m => { const c = t(m.MB001); if (c && want.has(c) && !/^Z9\d/i.test(c)) items.push({ code: c, name: t(m.MB002), spec: t(m.MB003), unit: t(m.MB004), erpWh: t(m.MB017) }); });
    return { orders: Object.values(orders), sales: Object.values(sales), items };
  });
}

module.exports = { fetchOpenMos, fetchOpenPos, fetchImport };
