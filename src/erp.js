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
const { createRuntime } = require('./runtime');
const { loadErpSchema } = require('./erp-schema');

async function setupErp(app, { cfg, ROOT, log, serial }) {
  const appDir = path.join(ROOT, 'apps', 'erp');
  const schema = loadErpSchema(appDir);
  const backupDir = path.join(cfg.dataDir, 'backups', 'erp');
  const store = new Store(cfg.db, { prefix: 'erp_', tableName: schema.tableName, defFor: schema.defFor, backupDir, log });
  await store.open();
  log('進銷存系統：資料庫已連線，工作表 ' + store.sheets.size + ' 張');

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

  const callApi = raw => run('api', () => {
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
      res.status(500).json({ ok: false, error: '伺服器發生錯誤，請稍後再試。' });
    }
  });

  // 每天凌晨 2:10 備份一份 JSON 到 data/backups/erp（保留 30 份；資料本身在 MySQL）
  cron.schedule('10 2 * * *', () => serial(() => { const f = store.backupTo(backupDir); log('進銷存 已備份 ' + f); }).catch(e => log('進銷存 備份失敗', e)),
    { timezone: 'Asia/Taipei' });

  return { store, rt, run };
}

module.exports = { setupErp };
