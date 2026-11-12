'use strict';
/** 檢查資料庫連線與設定（安裝腳本會呼叫）：node tools\check-db.js */
const path = require('path');
const mysql = require('mysql2/promise');
const { loadConfig } = require('../src/config');

(async () => {
  const cfg = loadConfig(path.resolve(__dirname, '..'));
  let conn;
  try {
    conn = await mysql.createConnection({
      host: cfg.db.DB_HOST, port: Number(cfg.db.DB_PORT), user: cfg.db.DB_USER, password: cfg.db.DB_PASSWORD,
      database: cfg.db.DB_NAME, charset: 'utf8mb4'
    });
  } catch (e) {
    console.error('連不上資料庫：' + e.message);
    if (e.code === 'ER_ACCESS_DENIED_ERROR') console.error('→ 帳號或密碼不對，或帳號沒有允許從 ' + cfg.db.DB_HOST + ' 登入。請參考 tools\\create-db-user.sql。');
    if (e.code === 'ER_BAD_DB_ERROR') console.error('→ 資料庫 ' + cfg.db.DB_NAME + ' 還沒建立。請參考 tools\\create-db-user.sql。');
    if (e.code === 'ECONNREFUSED') console.error('→ MySQL 沒有在執行，或位址／連接埠不對（XAMPP 控制台要把 MySQL 開起來）。');
    process.exit(1);
  }
  const [[v]] = await conn.query('SELECT VERSION() AS v, @@max_allowed_packet AS p');
  console.log('資料庫連線成功：' + v.v);
  const mb = Math.round(Number(v.p) / 1048576);
  if (mb < 16) {
    console.warn('注意：max_allowed_packet 只有 ' + mb + 'MB，資料多了可能存不進去。');
    console.warn('→ 請在 XAMPP 的 my.ini（[mysqld] 段落）加上 max_allowed_packet=64M，然後重新啟動 MySQL。');
  }
  await conn.end();
})();
