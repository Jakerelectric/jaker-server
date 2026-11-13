'use strict';
/** 讀取設定：安裝目錄下的 .env（KEY=VALUE 一行一個），環境變數優先 */
const fs = require('fs');
const path = require('path');

function readEnvFile(file) {
  const out = {};
  if (!fs.existsSync(file)) return out;
  fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '').split(/\r\n|\n|\r/).forEach(line => {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (!m) return;
    let v = m[2];
    if (/^".*"$/.test(v) || /^'.*'$/.test(v)) v = v.slice(1, -1);
    out[m[1]] = v;
  });
  return out;
}

function loadConfig(root) {
  const env = Object.assign(readEnvFile(path.join(root, '.env')), process.env);
  const need = ['DB_USER', 'DB_PASSWORD', 'DB_NAME'];
  const miss = need.filter(k => !env[k]);
  if (miss.length) throw new Error('.env 缺少設定：' + miss.join('、') + '（請重新執行安裝腳本，或參考 .env.example）');
  return {
    port: Number(env.PORT || 8080),
    host: env.HOST || '0.0.0.0',
    publicBase: env.PUBLIC_BASE || '',
    dataDir: path.resolve(root, env.DATA_DIR || 'data'),
    driveDir: env.DRIVE_DIR ? path.resolve(root, env.DRIVE_DIR) : '',   // 上傳檔案存放位置（預設 data\drive）
    lineEnabled: env.LINE_ENABLED === '1',
    lineSecret: env.LINE_CHANNEL_SECRET || '',   // 用來確認 Webhook 真的是 LINE 送來的
    curl: env.CURL || 'curl',
    adminApi: env.ADMIN_API || 'https://script.google.com/a/macros/jaker.com.tw/s/AKfycbzV_WQ7PIykmOIIF0Q-xrp_bxKaKiE195c_YB7qgvwvDINYWpKERU70uW__CpmgBbJV/exec',
    db: { DB_HOST: env.DB_HOST || '127.0.0.1', DB_PORT: env.DB_PORT || '3306', DB_USER: env.DB_USER, DB_PASSWORD: env.DB_PASSWORD, DB_NAME: env.DB_NAME }
  };
}

module.exports = { loadConfig, readEnvFile };
