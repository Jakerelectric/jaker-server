'use strict';
/**
 * 進銷存系統（/erp）：原本 Apps Script 的 apps/erp/Code.gs、Index.html 直接沿用。
 *   - 資料：同一個 MySQL 資料庫，資料表都以 erp_ 開頭（例如 erp_items、erp_txns），管理用的表是 erp_gas_*
 *   - 登入：員工編號＋密碼先問行政服務；通過後依這套系統「帳號」裡的權限（倉庫、業務、管理員…）登入。
 *     行政服務連不到、或密碼不對時，再用這套系統自己的密碼檢查一次（測試期間兩種密碼都能登入）。
 */
const express = require('express');
const path = require('path');
const fs = require('fs');
const cron = require('node-cron');
const { Store } = require('./store');
const { FileStore } = require('./file-store');
const { createRuntime } = require('./runtime');
const { loadErpSchema } = require('./erp-schema');

async function setupErp(app, { cfg, ROOT, log, serial }) {
  const appDir = path.join(ROOT, 'apps', 'erp');

  // 只給公司內網用：經由 Cloudflare 通道（work.jaker-ai.com）或其他外部轉址進來的請求一律擋掉
  //   .env 設 ERP_PUBLIC=1 才會開放外網（目前決定不開）
  const isPrivate = ip => { ip = String(ip || '').trim().replace(/^::ffff:/, '');
    return ip === '::1' || /^(127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|169\.254\.)/.test(ip) || /^f[cd]/i.test(ip) || /^fe80:/i.test(ip); };
  if (!cfg.erpPublic) {
    app.use('/erp', (req, res, next) => {
      const fwd = String(req.headers['x-forwarded-for'] || '').split(',').map(x => x.trim()).filter(Boolean);
      const outside = req.headers['cf-connecting-ip'] || req.headers['cf-ray'] || !isPrivate(req.socket.remoteAddress) || fwd.some(ip => !isPrivate(ip));
      if (outside) return res.status(403).type('text').send('進銷存系統只開放公司內網連線，請在公司用 http://主機IP:' + cfg.port + '/erp/ 開啟。');
      next();
    });
  }
  const schema = loadErpSchema(appDir);
  const backupDir = path.join(cfg.dataDir, 'backups', 'erp');
  const store = cfg.store === 'file'
    ? new FileStore(path.join(cfg.dataDir, 'erp-db'), { log })
    : new Store(cfg.db, { prefix: 'erp_', tableName: schema.tableName, defFor: schema.defFor, backupDir, log });
  await store.open();
  if (store.pool) { try { if (await fixTxnsShift(store, log, backupDir)) await store.load(); } catch (e) { log('異動紀錄欄位修正失敗（資料沒有變動）', e); } }
  log('進銷存系統：' + (cfg.store === 'file' ? '單機資料（' + path.join(cfg.dataDir, 'erp-db') + '）' : '資料庫已連線') + '，工作表 ' + store.sheets.size + ' 張');

  const rt = createRuntime(store, {
    appDir, dataDir: cfg.dataDir, driveDir: path.join(cfg.dataDir, 'erp-drive'), mount: '/erp', publicBase: cfg.publicBase,
    apiPath: '/erp/api', lineEnabled: false, curl: cfg.curl, log
  });

  async function run(label, fn) {
    return serial(async () => {
      const t0 = Date.now();
      try {
        const out = fn();
        await store.flush();
        const ms = Date.now() - t0;
        if (ms > 800) log('進銷存 較慢的請求 ' + label + ' ' + ms + 'ms');
        return out;
      } catch (e) {
        await store.flush().catch(err => log('進銷存 寫入資料庫失敗', err));
        throw e;
      }
    });
  }

  // 第一次啟動：建立所有工作表與欄位
  if (!store.sheets.size) { await run('setupSheets', () => rt.call('setupSheets')); log('進銷存系統：已建立空白資料表'); }

  // 網頁：Index.html 加上 API 位址（跟 work.jaker.com.tw/erp 的入口頁一樣，用 fetch 呼叫）
  let page = null, pageAt = 0;
  function indexHtml() {
    const f = path.join(appDir, 'Index.html'), st = fs.statSync(f);
    if (!page || st.mtimeMs !== pageAt) {
      page = fs.readFileSync(f, 'utf8').replace('<head>', '<head><script>window.__ERP_API__="/erp/api";window.__ERP_LOCAL__=1<\/script>');
      pageAt = st.mtimeMs;
    }
    return page;
  }
  app.get(['/erp', '/erp/'], (req, res) => {
    if (req.path === '/erp') return res.redirect('/erp/');
    res.set('Cache-Control', 'no-store').type('html').send(indexHtml());
  });

  // 結帳／收款附件（匯款憑證、客戶確認信）：檔案存在 data/erp-drive，用隨機編號開啟
  app.get('/erp/drive/file/:id', (req, res) => {
    const m = rt.drive._item(req.params.id);
    if (!m || m.kind !== 'file' || m.trashed) return res.status(404).send('找不到檔案');
    res.set('Content-Type', m.mime || 'application/octet-stream');
    res.set('Content-Disposition', (req.query.dl ? 'attachment' : 'inline') + "; filename*=UTF-8''" + encodeURIComponent(m.name));
    res.set('Content-Security-Policy', 'sandbox');
    res.sendFile(rt.drive._path(m.id));
  });

  // 行政服務確認員工編號＋密碼
  async function adminLogin(empId, pin) {
    try {
      const r = await fetch(cfg.adminApi, {
        method: 'POST', redirect: 'follow', headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify({ api: 1, fn: 'login', arg: { empId, pin } })
      });
      const j = await r.json();
      if (j && j.ok && j.v && j.v.token) return { ok: true };
      if (j && j.ok && j.v && j.v.mustChange) return { ok: false, mustChange: true };
      return { ok: false };
    } catch (e) {
      log('進銷存登入：連不到行政服務，改用本系統密碼檢查', String(e.message || e));
      return { ok: false, unreachable: true };
    }
  }

  // 整批換號、合併品號這類大量改動，執行前先存一份備份（data/backups/erp/before-*.json）
  const RISKY = new Set(['renameItems', 'mergeItem', 'importStock']);
  const callApi = raw => run('api', () => {
    try { const b = JSON.parse(raw || '{}'); if (b && RISKY.has(b.action)) {
      fs.mkdirSync(backupDir, { recursive: true });
      const f = path.join(backupDir, 'before-' + b.action + '-' + new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 19).replace(/[-:T]/g, '') + '.json');
      fs.writeFileSync(f, JSON.stringify({ at: new Date().toISOString(), sheets: Object.fromEntries(store.sheets), props: Object.fromEntries(store.props || []), docs: Object.fromEntries(store.docs || []) }));
      log('進銷存 ' + b.action + ' 前已備份 ' + f);
    } } catch (e) { log('進銷存 執行前備份失敗', e); }
    const out = rt.call('doPost', { postData: { contents: raw, type: 'text/plain' }, parameter: {} });
    return out && out.getContent ? out.getContent() : '{}';
  });

  app.post('/erp/api', express.text({ type: '*/*', limit: '40mb' }), async (req, res) => {
    const raw = typeof req.body === 'string' ? req.body : '';
    try {
      let body = null;
      try { body = JSON.parse(raw || '{}'); } catch (e) {}
      if (body && body.action === 'login') {
        const p = body.p || {}, id = String(p.id || '').trim().slice(0, 40), pw = String(p.pw || '').slice(0, 80);
        if (id && pw) {
          const a = await adminLogin(id, pw);
          if (a.ok) {
            const out = await run('login', () => {
              try { return { ok: true, data: rt.call('loginByAdmin_', id) }; }
              catch (e) { return { ok: false, error: String(e.message || e) }; }
            });
            return res.set('Cache-Control', 'no-store').json(out);
          }
          if (a.mustChange) return res.json({ ok: false, error: '第一次登入要先設定自己的密碼：請到行政服務入口（work.jaker.com.tw/admin）登入並設定，再回來這裡登入。' });
        }
        // 行政服務沒通過：再用這套系統自己的帳號密碼檢查
      }
      const out = await callApi(raw);
      res.set('Cache-Control', 'no-store').type('application/json').send(out);
    } catch (e) {
      log('進銷存 API 錯誤', e);
      // 寫入資料庫失敗時整批不算數；把原因帶回畫面，方便判斷（不含密碼等設定）
      res.status(500).json({ ok: false, error: '伺服器發生錯誤，這次的修改沒有存進去。原因：' + String((e && e.message) || e).slice(0, 300) });
    }
  });

  // 鼎新工具（只讀）：管理員在網頁上執行試算／抽樣，不用到主機按 bat。結果文字直接回傳
  const DX_TOOLS = { mo: ['dingxin-mo-sample.js', 'dingxin-mo-sample.txt'], all: ['dingxin-all-dryrun.js', 'dingxin-all-dryrun.txt'],
    sales: ['dingxin-sales-dryrun.js', 'dingxin-sales-dryrun.txt'], rename: ['dingxin-rename-list.js', 'dingxin-rename-report.txt'], test: ['dingxin-test.js', 'dingxin-test.txt'] };
  let dxBusy = false;
  app.post('/erp/dingxin/run', express.json({ limit: '10kb' }), async (req, res) => {
    const b = req.body || {}; const tool = DX_TOOLS[b.tool];
    if (!tool) return res.status(400).json({ ok: false, error: '沒有這個工具。' });
    let u = null;
    try { u = await run('dxAuth', () => rt.call('session_', String(b.token || ''))); } catch (e) { u = null; }
    if (!u || u.role !== 'admin') return res.status(403).json({ ok: false, error: '只有管理員可以執行鼎新工具。' });
    if (dxBusy) return res.json({ ok: false, error: '另一個鼎新工具正在執行，請稍後再試。' });
    dxBusy = true;
    const root = path.resolve(__dirname, '..'); const outFile = path.join(root, 'data', tool[1]);
    try { fs.unlinkSync(outFile); } catch (e) {}   // 不要把上一次的結果當成這次的
    const args = [path.join(root, 'tools', tool[0])].concat(b.arg && /^\d{8}$/.test(String(b.arg)) ? [String(b.arg)] : []);
    require('child_process').execFile(process.execPath, args, { cwd: root, timeout: 5 * 60e3, maxBuffer: 20 * 1024 * 1024, windowsHide: true }, (err, stdout) => {
      dxBusy = false;
      let text = ''; try { text = fs.readFileSync(outFile, 'utf8'); } catch (e) { text = String(stdout || ''); }
      log('進銷存 鼎新工具 ' + b.tool + '（' + u.name + '）' + (err ? '失敗：' + err.message : '完成'));
      res.set('Cache-Control', 'no-store').json({ ok: !err || !!text, text, error: err ? String(err.message).slice(0, 300) : '' });
    });
  });

  // 鼎新同步（製令＋採購單）：每天 18:00 自動一次，管理員也可在網頁按「立即同步」；只讀鼎新，系統裡這幾張表整批換成鼎新目前的資料
  const dingxin = require('./dingxin');
  let dxSyncing = null;
  async function syncDx(by) {
    if (dxSyncing) return dxSyncing;
    dxSyncing = (async () => {
      const t0 = Date.now(); const root = path.resolve(__dirname, '..'); const p = { errors: [] };
      try { p.mo = await dingxin.fetchOpenMos(root); } catch (e) { p.errors.push('製令：' + String(e.message || e).slice(0, 200)); }
      try { p.po = await dingxin.fetchOpenPos(root); } catch (e) { p.errors.push('採購單：' + String(e.message || e).slice(0, 200)); }
      try { const extra = [].concat((p.mo ? p.mo.mos.map(m => m.itemCode) : []), (p.po ? p.po.lines.map(l => l.itemCode) : []));
        p.imp = await dingxin.fetchImport(root, extra); } catch (e) { p.errors.push('訂單／銷貨／品號：' + String(e.message || e).slice(0, 200)); }
      if (!p.mo && !p.po) throw new Error(p.errors.join('；'));
      const r = await run('dxSync', () => rt.call('dxSync_', p));
      if (r.imp) log('進銷存 鼎新匯入（' + by + '）：新增品號 ' + r.imp.items + '、訂單 ' + r.imp.orders + '、銷貨單 ' + r.imp.sales);
      log('進銷存 鼎新同步（' + by + '）：製令 ' + (r.mos ?? '失敗') + ' 張、製程 ' + (r.ops ?? '-') + ' 筆、採購單 ' + (r.pos ?? '失敗') + ' 張／未進料 ' + (r.poLines ?? '-') + ' 筆，' + Math.round((Date.now() - t0) / 1000) + ' 秒' + (p.errors.length ? '；' + p.errors.join('；') : ''));
      return Object.assign(r, { errors: p.errors });
    })().finally(() => { dxSyncing = null; });
    return dxSyncing;
  }
  app.post('/erp/dingxin/sync', express.json({ limit: '10kb' }), async (req, res) => {
    const b = req.body || {}; let u = null;
    try { u = await run('dxAuth', () => rt.call('session_', String(b.token || ''))); } catch (e) { u = null; }
    if (!u || u.role !== 'admin') return res.status(403).json({ ok: false, error: '只有管理員可以同步鼎新資料。' });
    try { res.json({ ok: true, data: await syncDx(u.name) }); }
    catch (e) { log('進銷存 鼎新同步失敗', e); res.json({ ok: false, error: String(e.message || e).slice(0, 300) }); }
  });
  if (cfg.store !== 'file') cron.schedule('0 18 * * *', () => syncDx('每日 18:00').catch(e => log('進銷存 鼎新同步失敗', e)), { timezone: 'Asia/Taipei' });

  // 資料庫檢查（管理員，只讀）：比對某張表的欄位對照（gas_columns）與資料表實際欄位、各欄有值的筆數、最新兩筆原始資料
  app.post('/erp/admin/dbinfo', express.json({ limit: '10kb' }), async (req, res) => {
    const b = req.body || {};
    let u = null;
    try { u = await run('dbAuth', () => rt.call('session_', String(b.token || ''))); } catch (e) { u = null; }
    if (!u || u.role !== 'admin') return res.status(403).json({ ok: false, error: '只有管理員可以使用。' });
    if (!store.pool) return res.json({ ok: false, error: '單機版沒有資料庫。' });
    try {
      const sheet = String(b.sheet || '異動紀錄'); const tbl = store.tables.get(sheet);
      if (!tbl) return res.json({ ok: false, error: '找不到工作表 ' + sheet });
      const [gas] = await store.pool.query('SELECT pos, col, header, type FROM gas_columns WHERE tbl = ? ORDER BY pos', [tbl]);
      const [cols] = await store.pool.query('SELECT COLUMN_NAME AS col, COLUMN_TYPE AS type, ORDINAL_POSITION AS pos FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? ORDER BY ORDINAL_POSITION', [tbl]);
      const filled = {};
      for (const c of cols) { if (c.col === '_id') continue; const [[r]] = await store.pool.query('SELECT COUNT(*) AS n FROM ' + '`' + tbl + '` WHERE `' + c.col + '` IS NOT NULL AND `' + c.col + "` <> ''"); filled[c.col] = r.n; }
      const [[cnt]] = await store.pool.query('SELECT COUNT(*) AS n FROM `' + tbl + '`');
      const [last] = await store.pool.query('SELECT * FROM `' + tbl + '` ORDER BY _id DESC LIMIT 2');
      const [first] = await store.pool.query('SELECT * FROM `' + tbl + '` ORDER BY _id LIMIT 1');
      const tables = []; for (const [sh, t] of store.tables) tables.push(sh + '=' + t);
      res.set('Cache-Control', 'no-store').json({ ok: true, tbl, count: cnt.n, memHeader: (store.sheets.get(sheet) || [[]])[0], gas, cols, filled, last, first, tables });
    } catch (e) { res.json({ ok: false, error: String(e.message || e) }); }
  });

  // 每天凌晨 2:10 備份一份 JSON 到 data/backups/erp（保留 30 份；資料本身在 MySQL）
  cron.schedule('10 2 * * *', () => serial(() => { const f = store.backupTo(backupDir); log('進銷存 已備份 ' + f); }).catch(e => log('進銷存 備份失敗', e)),
    { timezone: 'Asia/Taipei' });

  return { store, rt, run };
}

module.exports = { setupErp };

/**
 * 一次性修正（2026-11-24）：e4a1474 把 4 個新欄位插在異動紀錄中間，資料庫把第 28～40 欄依序改了名，
 * 但欄位對照（gas_columns）沒改，造成讀錯欄、寫入失敗。資料本身沒動，只要把欄位名稱改回原樣、移除多出的空欄。
 * 只在偵測到這個特定狀態時執行；改名前會檢查多出的欄位是空的。
 */
async function fixTxnsShift(store, log, backupDir) {
  const tbl = store.tables.get('異動紀錄'); if (!tbl) return false;
  const [cols] = await store.pool.query('SELECT COLUMN_NAME AS col, COLUMN_TYPE AS type, ORDINAL_POSITION AS pos FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? ORDER BY ORDINAL_POSITION', [tbl]);
  const names = cols.map(c => c.col);
  const now = ['pending', 'back_wh', 'recv_by', 'recv_at', 'note', 'cost', 'ts', 'synced', 'by_id', 'edited', 'pack_lines', 'order_no', 'wo_no', 'lot_no'];
  const want = ['note', 'cost', 'ts', 'synced', 'by_id', 'edited', 'pack_lines', 'order_no', 'wo_no', 'lot_no', 'plt_no', 'loc', 'merged'];
  if (names.slice(27, 41).join(',') !== now.join(',') || names.includes('plt_no')) return false;   // 不是這個狀態就不動
  const [gas] = await store.pool.query('SELECT pos, col, header FROM gas_columns WHERE tbl = ? ORDER BY pos', [tbl]);
  if (gas.slice(26, 39).map(g => g.col).join(',') !== want.join(',')) { log('異動紀錄：欄位對照和預期不同，不自動修正'); return false; }
  const [[ex]] = await store.pool.query('SELECT COUNT(*) AS n FROM `' + tbl + '` WHERE `lot_no` IS NOT NULL AND `lot_no` <> \'\'');
  if (ex.n) { log('異動紀錄：多出的欄位有資料（' + ex.n + ' 筆），不自動修正'); return false; }
  const bak = path.join(backupDir, 'before-fixTxnsShift-' + Date.now() + '.json');
  try { fs.mkdirSync(path.dirname(bak), { recursive: true }); const [rows] = await store.pool.query('SELECT * FROM `' + tbl + '`'); fs.writeFileSync(bak, JSON.stringify({ cols, gas, rows })); } catch (e) { log('異動紀錄修正前備份失敗，不修正', e); return false; }
  const ty = {}; cols.forEach(c => { ty[c.col] = c.type; });
  const hdr = {}; gas.forEach(g => { hdr[g.col] = g.header; });
  const parts1 = now.map((c, i) => 'CHANGE `' + c + '` `fix_tmp_' + i + '` ' + ty[c] + ' NULL');
  await store.pool.query('ALTER TABLE `' + tbl + '` ' + parts1.join(', '));
  const parts2 = want.map((c, i) => 'CHANGE `fix_tmp_' + i + '` `' + c + '` ' + ty[now[i]] + ' NULL COMMENT ' + store.pool.escape(hdr[c] || c));
  parts2.push('DROP COLUMN `fix_tmp_13`');
  await store.pool.query('ALTER TABLE `' + tbl + '` ' + parts2.join(', '));
  log('異動紀錄：欄位名稱已改回原樣（備份 ' + bak + '）');
  return true;
}
