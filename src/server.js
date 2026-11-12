'use strict';
/**
 * 傑克電機內部系統伺服器
 *   /pm/            專案儀表板（用行政服務的員工編號＋密碼登入）
 *   /pm/api         儀表板讀寫資料
 *   /pm/login       登入（轉給行政服務確認帳密）
 *   /pm/line        LINE Webhook（正式上線時才開）
 *   /pm/drive/...   上傳的專案資料
 *   /healthz        健康檢查
 */
const express = require('express');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const cron = require('node-cron');
const { loadConfig } = require('./config');
const { Store } = require('./store');
const { createRuntime } = require('./runtime');

const ROOT = path.resolve(__dirname, '..');
const cfg = loadConfig(ROOT);
const logFile = path.join(cfg.dataDir, 'logs', 'server.log');
fs.mkdirSync(path.dirname(logFile), { recursive: true });
function log(...a) {
  const line = new Date(Date.now() + 8 * 3600e3).toISOString().replace('T', ' ').slice(0, 19) + ' ' +
    a.map(x => (typeof x === 'string' ? x : (x && x.stack) || JSON.stringify(x))).join(' ');
  console.log(line);
  try { fs.appendFileSync(logFile, line + '\n'); } catch (e) {}
}

// 一次只處理一個請求（原本的 Apps Script 程式是依序執行的）；資料在記憶體，所以每個請求都很快
let chain = Promise.resolve();
function serial(fn) {
  const p = chain.then(fn, fn);
  chain = p.then(() => {}, () => {});
  return p;
}

async function main() {
  const store = new Store(cfg.db, { backupDir: path.join(cfg.dataDir, 'backups'), log });
  await store.open();
  log('資料庫已連線，工作表 ' + store.sheets.size + ' 張');
  if (!store.props.has('PHOTO_FOLDER_ID')) store.setProp('PHOTO_FOLDER_ID', 'root');
  if (!cfg.lineEnabled && !store.props.has('LINE_TOKEN')) store.setProp('LINE_TOKEN', 'disabled');
  await store.flush();

  const pm = createRuntime(store, {
    appDir: path.join(ROOT, 'apps', 'pm'), dataDir: cfg.dataDir, driveDir: cfg.driveDir, mount: '/pm', publicBase: cfg.publicBase,
    apiPath: '/pm/api', adminApi: cfg.adminApi, lineEnabled: cfg.lineEnabled, curl: cfg.curl, log
  });

  async function run(label, fn) {
    return serial(async () => {
      const t0 = Date.now();
      try {
        const out = fn();
        await store.flush();
        const ms = Date.now() - t0;
        if (ms > 800) log('較慢的請求 ' + label + ' ' + ms + 'ms');
        return out;
      } catch (e) {
        await store.flush().catch(err => log('寫入資料庫失敗', err));
        throw e;
      }
    });
  }

  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 'loopback');
  app.use((req, res, next) => { res.set('X-Content-Type-Options', 'nosniff'); res.set('Referrer-Policy', 'same-origin'); next(); });

  app.get('/', (req, res) => res.redirect('/pm/'));
  app.get('/healthz', (req, res) => res.json({ ok: true, sheets: store.sheets.size }));
  app.get(['/pm', '/pm/'], (req, res) => {
    if (req.path === '/pm') return res.redirect('/pm/');
    res.set('Cache-Control', 'no-store');
    res.sendFile(path.join(ROOT, 'public', 'pm-loader.html'));
  });

  // 儀表板 API（與 Apps Script 版的 doPost 相同格式：{page|api, args, token}）
  app.post('/pm/api', express.text({ type: '*/*', limit: '40mb' }), async (req, res) => {
    try {
      const raw = typeof req.body === 'string' ? req.body : '';
      const out = await run('api', () => pm.call('doPost', { postData: { contents: raw, type: 'text/plain' }, parameter: {} }));
      res.set('Cache-Control', 'no-store').type('application/json').send(out && out.getContent ? out.getContent() : '{}');
    } catch (e) {
      log('API 錯誤', e);
      res.status(500).json({ ok: false, error: '伺服器發生錯誤，請稍後再試。' });
    }
  });

  // 登入：把員工編號＋密碼轉給行政服務確認，拿回登入代碼
  app.post('/pm/login', express.json({ limit: '10kb' }), async (req, res) => {
    const empId = String((req.body && req.body.empId) || '').trim().slice(0, 40);
    const pin = String((req.body && req.body.pin) || '').slice(0, 40);
    if (!empId || !pin) return res.json({ ok: false, error: '請輸入員工編號與密碼。' });
    try {
      const r = await fetch(cfg.adminApi, {
        method: 'POST', redirect: 'follow', headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify({ api: 1, fn: 'login', arg: { empId, pin } })
      });
      const j = await r.json();
      if (!j || !j.ok) return res.json({ ok: false, error: String((j && j.err) || '登入失敗').replace(/^(Error|Exception):\s*/, '') });
      const v = j.v || {};
      if (v.mustChange) return res.json({ ok: false, mustChange: true, error: '第一次登入要先設定自己的密碼：請到行政服務入口（work.jaker.com.tw/admin）登入並設定，再回來這裡登入。' });
      if (!v.token) return res.json({ ok: false, error: '登入失敗，請稍後再試。' });
      res.json({ ok: true, token: v.token, user: v.user ? { name: v.user.name } : null });
    } catch (e) {
      log('登入時連不到行政服務', e);
      res.json({ ok: false, error: '暫時連不到行政服務，請稍後再試。' });
    }
  });

  // LINE Webhook：只接受 LINE 簽章正確的請求（channel secret 設在 .env）
  app.post('/pm/line', express.raw({ type: '*/*', limit: '2mb' }), async (req, res) => {
    if (!cfg.lineEnabled) return res.status(503).send('LINE disabled');
    const raw = Buffer.isBuffer(req.body) ? req.body : Buffer.from('');
    if (!cfg.lineSecret) { log('LINE：.env 沒有設定 LINE_CHANNEL_SECRET，拒絕請求'); return res.status(503).send('not configured'); }
    const sig = String(req.get('x-line-signature') || '');
    const want = crypto.createHmac('sha256', cfg.lineSecret).update(raw).digest('base64');
    if (!sig || sig.length !== want.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(want))) {
      log('LINE：簽章不符，已拒絕（來源 ' + req.ip + '）');
      return res.status(401).send('bad signature');
    }
    res.send('OK');   // 先回覆 LINE（LINE 要求幾秒內回應），再處理
    run('line', () => { pm.call('doPost', { postData: { contents: raw.toString('utf8'), type: 'application/json' }, parameter: {} }); })
      .catch(e => log('LINE 處理錯誤', e));
  });

  // 上傳的檔案：要登入才看得到（用登入時存的 cookie 確認身分）
  function cookieToken(req) {
    const m = String(req.headers.cookie || '').match(/(?:^|;\s*)jk_t=([^;]+)/);
    return m ? decodeURIComponent(m[1]) : '';
  }
  async function requireLogin(req, res, next) {
    const t = cookieToken(req);
    if (t) {
      try {
        const who = await run('auth', () => pm.call('tokenUser_', t));
        if (who) return next();
      } catch (e) { log('檔案登入檢查失敗', e); }
    }
    res.status(401).type('html').send('<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
      '<body style="font-family:system-ui,\'Microsoft JhengHei\',sans-serif;padding:32px;line-height:1.8">請先登入專案儀表板再開啟檔案。' +
      '<p><a href="/pm/">前往登入</a></p></body>');
  }
  app.use('/pm/drive', requireLogin);
  app.get('/pm/drive/file/:id', (req, res) => {
    const m = pm.drive._item(req.params.id);
    if (!m || m.kind !== 'file' || m.trashed) return res.status(404).send('找不到檔案');
    const name = encodeURIComponent(m.name);
    res.set('Content-Type', m.mime || 'application/octet-stream');
    res.set('Content-Disposition', (req.query.dl ? 'attachment' : 'inline') + "; filename*=UTF-8''" + name);
    res.sendFile(pm.drive._path(m.id));
  });
  app.get('/pm/drive/folder/:id', (req, res) => {
    const m = pm.drive._item(req.params.id);
    if (!m || m.kind !== 'folder') return res.status(404).send('找不到資料夾');
    const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
    const kids = pm.drive._children(m.id).sort((a, b) => (a.kind === b.kind ? a.name.localeCompare(b.name, 'zh-Hant') : a.kind === 'folder' ? -1 : 1));
    const rows = kids.map(k => '<li>' + (k.kind === 'folder' ? '📁 ' : '📄 ') + '<a href="/pm/drive/' + k.kind + '/' + k.id + '">' + esc(k.name) + '</a>' +
      (k.kind === 'file' ? ' <small>' + Math.ceil((k.size || 0) / 1024) + ' KB</small>' : '') + '</li>').join('');
    const up = m.parent ? '<p><a href="/pm/drive/folder/' + m.parent + '">← 上一層</a></p>' : '';
    res.type('html').send('<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>' + esc(m.name) +
      '</title><body style="font-family:system-ui,\'Microsoft JhengHei\',sans-serif;max-width:760px;margin:24px auto;padding:0 16px;line-height:1.8">' +
      up + '<h1 style="font-size:20px">' + esc(m.name) + '</h1><ul style="padding-left:1.2em">' + (rows || '<li>（沒有檔案）</li>') + '</ul></body>');
  });

  // 定時工作（每日提醒、週五提醒、週一報告）：只有 LINE 開啟時才跑
  if (cfg.lineEnabled) {
    const opt = { timezone: 'Asia/Taipei' };
    cron.schedule('30 8 * * *', () => run('dailyOverdue', () => pm.call('dailyOverdue')).catch(e => log('dailyOverdue 失敗', e)), opt);
    cron.schedule('0 14 * * 5', () => run('weeklyReminder', () => pm.call('weeklyReminder')).catch(e => log('weeklyReminder 失敗', e)), opt);
    cron.schedule('40 8 * * 1', () => run('mondaySummary', () => pm.call('mondaySummary')).catch(e => log('mondaySummary 失敗', e)), { timezone: 'Asia/Taipei' });
  }
  // 每天凌晨 2 點備份一份 JSON（另外保留在 MySQL）
  cron.schedule('0 2 * * *', () => serial(() => { const f = store.backupTo(path.join(cfg.dataDir, 'backups')); log('已備份 ' + f); }).catch(e => log('備份失敗', e)), { timezone: 'Asia/Taipei' });

  app.use((err, req, res, next) => { log('未處理的錯誤', err); res.status(500).send('伺服器發生錯誤'); });
  app.listen(cfg.port, cfg.host, () => log('傑克電機內部系統已啟動：http://' + (cfg.host === '0.0.0.0' ? 'localhost' : cfg.host) + ':' + cfg.port + '/pm/' +
    (cfg.lineEnabled ? '' : '（LINE 通知已停用）')));
}

main().catch(e => { log('啟動失敗', e); process.exit(1); });
