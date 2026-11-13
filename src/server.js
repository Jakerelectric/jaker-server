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
const { loadConfig, readEnvFile } = require('./config');
const { execFile } = require('child_process');
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
  const startedAt = new Date(Date.now() + 8 * 3600e3).toISOString().replace('T', ' ').slice(0, 19);
  let version = '';
  try { version = fs.readFileSync(path.join(cfg.dataDir, 'version.txt'), 'utf8').trim(); } catch (e) {}
  app.get('/healthz', (req, res) => res.json({ ok: true, sheets: store.sheets.size, version, started: startedAt,
    line: cfg.lineEnabled ? (cfg.lineSecret ? 'on' : 'on-no-secret') : 'off' }));
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

  // ===== 系統更新（只有管理員）：/pm/admin/update =====
  // 按下更新 → 執行 Windows 排程工作 JakerUpdate（以 SYSTEM 身分跑 update.ps1 -Auto，失敗會自動還原）
  const isWin = process.platform === 'win32';
  const run$ = (cmd, args, timeout) => new Promise(ok => execFile(cmd, args, { timeout: timeout || 30000, windowsHide: true },
    (err, out, errOut) => ok({ err, out: String(out || ''), errOut: String(errOut || '') })));
  const ps = script => run$('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script]);
  if (isWin) {
    const arg = '-NoProfile -ExecutionPolicy Bypass -File "' + path.join(ROOT, 'update.ps1') + '" -Auto';
    ps("$a = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument '" + arg.replace(/'/g, "''") + "' -WorkingDirectory '" + ROOT.replace(/'/g, "''") + "';" +
      "$p = New-ScheduledTaskPrincipal -UserId 'SYSTEM' -LogonType ServiceAccount -RunLevel Highest;" +
      "$s = New-ScheduledTaskSettingsSet -ExecutionTimeLimit (New-TimeSpan -Minutes 30) -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries;" +
      "Register-ScheduledTask -TaskName 'JakerUpdate' -Action $a -Principal $p -Settings $s -Force | Out-Null")
      .then(r => { if (r.err) log('建立更新排程 JakerUpdate 失敗', r.errOut || r.err.message); });
  }
  async function adminOf(req) {
    const t = cookieToken(req);
    if (!t) return null;
    const who = await run('auth', () => pm.call('tokenUser_', t)).catch(() => null);
    if (!who) return null;
    const m = store.sheets.get('成員') || [[]], h = m[0] || [];
    const iN = h.indexOf('姓名'), iE = h.indexOf('公司信箱'), iR = h.indexOf('角色');
    const row = m.slice(1).find(r => (who.email && iE >= 0 && String(r[iE] || '').toLowerCase() === who.email) || (iN >= 0 && r[iN] === who.name));
    return row && row[iR] === '管理員' ? who : null;
  }
  async function requireAdmin(req, res, next) {
    const who = await adminOf(req);
    if (who) { req.who = who; return next(); }
    res.status(403).type('html').send('<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
      '<body style="font-family:system-ui,\'Microsoft JhengHei\',sans-serif;padding:32px;line-height:1.8">只有專案系統的「管理員」可以使用這一頁。' +
      '<p><a href="/pm/">先登入專案儀表板</a>，再回到這一頁。</p></body>');
  }
  function readLog() {
    try {
      const b = fs.readFileSync(path.join(cfg.dataDir, 'logs', 'update.log'));
      const txt = b[0] === 0xff && b[1] === 0xfe ? b.slice(2).toString('utf16le') : b.toString('utf8').replace(/^﻿/, '');
      return txt.split(/\r?\n/).filter(l => l.trim() && !/^\*{5,}|^(Windows PowerShell|開始時間|Start time|Username|RunAs|Machine|Host Application|Process ID|PSVersion|PSEdition|PSCompatible|BuildVersion|CLRVersion|WSManStack|PSRemoting|Serialization|使用者|執行身分|電腦)/.test(l)).slice(-30).join('\n');
    } catch (e) { return ''; }
  }
  let latestCache = { at: 0, v: null };
  async function latest() {
    if (Date.now() - latestCache.at < 60000 && latestCache.v) return latestCache.v;
    const env = readEnvFile(path.join(ROOT, '.env'));
    const token = String(env.GITHUB_TOKEN || '').replace(/[^A-Za-z0-9_]/g, ''), repo = env.GITHUB_REPO || 'Jakerelectric/jaker-server';
    if (!token) return { error: '測試機還沒設定 GitHub 權杖' };
    try {
      const r = await fetch('https://api.github.com/repos/' + repo + '/commits/main', { headers: { Authorization: 'Bearer ' + token, 'User-Agent': 'jaker-server', Accept: 'application/vnd.github+json' } });
      if (!r.ok) return { error: 'GitHub 回應 ' + r.status + '（權杖可能過期）' };
      const c = await r.json();
      const v = { sha: c.sha.slice(0, 7), msg: String(c.commit.message).split('\n')[0], at: c.commit.committer && c.commit.committer.date };
      latestCache = { at: Date.now(), v };
      return v;
    } catch (e) { return { error: '連不到 GitHub' }; }
  }
  app.get('/pm/admin/update/status', requireAdmin, async (req, res) => {
    let current = '';
    try { current = fs.readFileSync(path.join(cfg.dataDir, 'version.txt'), 'utf8').trim(); } catch (e) {}
    let running = false;
    if (isWin) { const r = await ps("(Get-ScheduledTask -TaskName 'JakerUpdate' -ErrorAction SilentlyContinue).State"); running = /Running/i.test(r.out); }
    res.set('Cache-Control', 'no-store').json({ ok: true, current, latest: await latest(), running, log: readLog(), canRun: isWin });
  });
  app.post('/pm/admin/update/run', requireAdmin, async (req, res) => {
    if (!isWin) return res.json({ ok: false, error: '只有 Windows 主機能執行' });
    const r = await ps("Start-ScheduledTask -TaskName 'JakerUpdate'");
    if (r.err) { log('啟動更新失敗', r.errOut || r.err.message); return res.json({ ok: false, error: '啟動更新失敗：' + (r.errOut || r.err.message).slice(0, 200) }); }
    log('管理員 ' + req.who.name + ' 從網頁啟動系統更新');
    res.json({ ok: true });
  });
  app.get('/pm/admin/update', requireAdmin, (req, res) => {
    res.set('Cache-Control', 'no-store').sendFile(path.join(ROOT, 'public', 'update.html'));
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
