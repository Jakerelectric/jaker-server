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

  // 每天凌晨 2:10 備份一份 JSON 到 data/backups/erp（保留 30 份；資料本身在 MySQL）
  cron.schedule('10 2 * * *', () => serial(() => { const f = store.backupTo(backupDir); log('進銷存 已備份 ' + f); }).catch(e => log('進銷存 備份失敗', e)),
    { timezone: 'Asia/Taipei' });

  return { store, rt, run };
}

module.exports = { setupErp };
