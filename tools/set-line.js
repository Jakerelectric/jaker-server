'use strict';
/**
 * 開／關 LINE 串接
 *   node tools\set-line.js on    （從環境變數 JK_LINE_TOKEN、JK_LINE_SECRET 讀取，避免出現在指令列）
 *   node tools\set-line.js off
 */
const path = require('path');
const fs = require('fs');
const { loadConfig } = require('../src/config');
const { Store } = require('../src/store');

const ROOT = path.resolve(__dirname, '..');
const ENV = path.join(ROOT, '.env');

/** 逐行改 .env：有這個設定就改那一行，沒有就加在最後（一律用 Windows 換行） */
function setEnv(pairs) {
  const s = fs.existsSync(ENV) ? fs.readFileSync(ENV, 'utf8').replace(/^\uFEFF/, '') : '';
  const lines = s.split(/\r\n|\n|\r/);
  while (lines.length && lines[lines.length - 1].trim() === '') lines.pop();
  for (const [k, v] of Object.entries(pairs)) {
    const i = lines.findIndex(l => new RegExp('^\\s*' + k + '\\s*=').test(l));
    if (i >= 0) lines[i] = k + '=' + v; else lines.push(k + '=' + v);
  }
  fs.writeFileSync(ENV, lines.join('\r\n') + '\r\n');
}

(async () => {
  const mode = process.argv[2];
  if (mode === 'off') {
    setEnv({ LINE_ENABLED: '0' });
    console.log('已關閉 LINE 串接（這台電腦不再收發 LINE 訊息）。');
    return;
  }
  if (mode !== 'on') { console.error('用法：node tools\\set-line.js on|off'); process.exit(1); }
  const token = String(process.env.JK_LINE_TOKEN || '').trim();
  const secret = String(process.env.JK_LINE_SECRET || '').trim();
  const base = String(process.env.JK_PUBLIC_BASE || 'https://work.jaker-ai.com').trim().replace(/\/+$/, '');
  if (!token || !/^[0-9a-f]{32}$/i.test(secret)) {
    console.error('Channel access token 或 Channel secret 格式不對（secret 應該是 32 個英數字）。');
    process.exit(1);
  }
  // 確認 token 是對的：向 LINE 查詢這個官方帳號的名稱
  const r = await fetch('https://api.line.me/v2/bot/info', { headers: { Authorization: 'Bearer ' + token } });
  if (!r.ok) { console.error('LINE 不接受這個 Channel access token（HTTP ' + r.status + '），請重新複製。'); process.exit(1); }
  const info = await r.json();
  console.log('LINE 官方帳號：' + (info.displayName || '') + '（' + (info.basicId || '') + '）');

  const cfg = loadConfig(ROOT);
  const store = new Store(cfg.db);
  await store.open();
  store.setProp('LINE_TOKEN', token);
  await store.flush();
  await store.close();
  setEnv({ LINE_ENABLED: '1', LINE_CHANNEL_SECRET: secret, PUBLIC_BASE: base });
  console.log('已開啟 LINE 串接。Webhook 網址請設成：' + base + '/pm/line');
})().catch(e => { console.error('設定失敗：', e.message || e); process.exit(1); });
