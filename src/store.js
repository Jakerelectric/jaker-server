'use strict';
/**
 * 資料儲存：MySQL，每張「工作表」對應一個真正的資料表。
 *   - 一筆資料一列；欄位用英文名稱，中文表頭寫在欄位註解（欄位定義在 schema.js）
 *   - 欄位有型別：日期 DATE／DATETIME、數字 INT／DOUBLE、文字 VARCHAR(n)／TEXT
 *   - 每列有自動編號 _id；改一筆只更新那一列，刪一筆只刪那一列
 *   - 常用的欄位（編號、專案編號、負責人、狀態…）建索引，可以直接用 SQL 查詢、統計
 * 程式執行時資料也放一份在記憶體（很快）；每次請求結束，只把有變動的列寫回 MySQL。
 * 其他：gas_props（設定值）、gas_docs（檔案索引等）、gas_tables（工作表 ↔ 資料表）、gas_columns（表頭 ↔ 欄位）
 */
const mysql = require('mysql2/promise');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const { TABLE_NAMES, defFor, convert, fromDb, widerTypes, indexExpr } = require('./schema');

const q = id => '`' + String(id).replace(/`/g, '``') + '`';
const str = v => (v == null ? '' : String(v));

class Store {
  constructor(cfg, opts) {
    this.cfg = cfg;
    this.opts = opts || {};
    this.log = this.opts.log || (m => console.log(m));
    this.sheets = new Map();    // 工作表名稱 → 二維陣列（第 1 列是表頭）
    this.rowIds = new Map();    // 工作表名稱 → 每列對應的 _id（表頭為 null；新列為 null）
    this.saved = new Map();     // 工作表名稱 → Map(_id → 上次寫入的內容)
    this.meta = new Map();      // 工作表名稱 → [{ col, header, type, index }]（依表頭位置）
    this.tables = new Map();    // 工作表名稱 → 資料表名稱
    this.props = new Map();
    this.docs = new Map();
    this.dirtySheets = new Set();
    this.fullSheets = new Set();     // 整張重寫（匯入、清空）
    this.droppedSheets = new Set();
    this.dirtyProps = new Set();
    this.deletedProps = new Set();
    this.dirtyDocs = new Set();
    this.pool = null;
  }

  async open() {
    this.pool = mysql.createPool({
      host: this.cfg.DB_HOST || '127.0.0.1', port: Number(this.cfg.DB_PORT || 3306),
      user: this.cfg.DB_USER, password: this.cfg.DB_PASSWORD, database: this.cfg.DB_NAME,
      charset: 'utf8mb4', connectionLimit: 4, dateStrings: true, multipleStatements: false
    });
    await this.pool.query(`CREATE TABLE IF NOT EXISTS gas_tables (
      sheet VARCHAR(100) NOT NULL PRIMARY KEY, tbl VARCHAR(64) NOT NULL, sort INT NOT NULL DEFAULT 0
    ) DEFAULT CHARSET=utf8mb4`);
    await this.pool.query(`CREATE TABLE IF NOT EXISTS gas_props (k VARCHAR(100) NOT NULL PRIMARY KEY, v MEDIUMTEXT NOT NULL) DEFAULT CHARSET=utf8mb4`);
    await this.pool.query(`CREATE TABLE IF NOT EXISTS gas_docs (k VARCHAR(100) NOT NULL PRIMARY KEY, v LONGTEXT NOT NULL, updated_at DATETIME NOT NULL) DEFAULT CHARSET=utf8mb4`);
    await this.pool.query(`CREATE TABLE IF NOT EXISTS gas_columns (
      tbl VARCHAR(64) NOT NULL, pos INT NOT NULL, col VARCHAR(64) NOT NULL, header VARCHAR(200) NOT NULL,
      type VARCHAR(40) NOT NULL, idx TINYINT NOT NULL DEFAULT 0, PRIMARY KEY (tbl, pos)
    ) DEFAULT CHARSET=utf8mb4`);
    await this.migrateLegacy();
    await this.migrateColumns();
    await this.load();
  }

  /** 第一版測試是把整張表存成一筆 JSON（gas_sheets）；有的話轉成正式資料表 */
  async migrateLegacy() {
    const [t] = await this.pool.query("SHOW TABLES LIKE 'gas_sheets'");
    if (!t.length) return;
    const [rows] = await this.pool.query('SELECT name, data FROM gas_sheets');
    for (const r of rows) {
      this.replaceSheet(r.name, JSON.parse(r.data));
    }
    if (rows.length) await this.flush();
    await this.pool.query('DROP TABLE gas_sheets');
    if (rows.length) console.log('已把 ' + rows.length + ' 張工作表轉成正式資料表');
  }

  /**
   * 上一版的資料表欄位是中文名稱、全部 TEXT；有的話轉成英文欄位＋正確型別。
   * 先備份成 JSON，再把舊表改名，建新表、搬資料，筆數一致才刪掉舊表。
   */
  async migrateColumns() {
    const [maps] = await this.pool.query(
      'SELECT t.sheet, t.tbl, t.sort FROM gas_tables t WHERE NOT EXISTS (SELECT 1 FROM gas_columns c WHERE c.tbl = t.tbl) ORDER BY t.sort, t.sheet');
    if (!maps.length) return;
    const old = [];
    for (const m of maps) {
      const [cols] = await this.pool.query(
        'SELECT COLUMN_NAME AS c FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? ORDER BY ORDINAL_POSITION', [m.tbl]);
      if (!cols.length) { await this.pool.query('DELETE FROM gas_tables WHERE sheet = ?', [m.sheet]); continue; }
      const names = cols.map(c => c.c).filter(c => c !== '_id');
      const [rows] = await this.pool.query('SELECT * FROM ' + q(m.tbl) + ' ORDER BY _id');
      const data = [names.map(n => (/^_欄\d+$/.test(n) ? '' : n))].concat(rows.map(r => names.map(n => str(r[n]))));
      old.push({ sheet: m.sheet, tbl: m.tbl, data });
    }
    if (!old.length) return;
    if (this.opts.backupDir) {
      fs.mkdirSync(this.opts.backupDir, { recursive: true });
      const f = path.join(this.opts.backupDir, 'before-columns-' + Date.now() + '.json');
      fs.writeFileSync(f, JSON.stringify({ at: new Date().toISOString(), sheets: Object.fromEntries(old.map(o => [o.sheet, o.data])) }));
      this.log('欄位改版前已備份：' + f);
    }
    for (const o of old) {
      await this.pool.query('DROP TABLE IF EXISTS ' + q(o.tbl + '_old'));
      await this.pool.query('RENAME TABLE ' + q(o.tbl) + ' TO ' + q(o.tbl + '_old'));
      await this.pool.query('DELETE FROM gas_tables WHERE sheet = ?', [o.sheet]);
      this.replaceSheet(o.sheet, o.data);
    }
    await this.flush();
    for (const o of old) {
      const [[a]] = await this.pool.query('SELECT COUNT(*) AS n FROM ' + q(o.tbl + '_old'));
      const [[b]] = await this.pool.query('SELECT COUNT(*) AS n FROM ' + q(this.tables.get(o.sheet)));
      if (a.n !== b.n) throw new Error('欄位改版：' + o.sheet + ' 筆數不符（舊 ' + a.n + '、新 ' + b.n + '），舊資料保留在 ' + o.tbl + '_old');
      await this.pool.query('DROP TABLE ' + q(o.tbl + '_old'));
    }
    this.log('已把 ' + old.length + ' 張資料表改成英文欄位名稱與正確型別');
  }

  async load() {
    this.sheets.clear(); this.rowIds.clear(); this.saved.clear(); this.meta.clear(); this.tables.clear();
    const [maps] = await this.pool.query('SELECT sheet, tbl FROM gas_tables ORDER BY sort, sheet');
    for (const m of maps) {
      const [cols] = await this.pool.query('SELECT pos, col, header, type, idx FROM gas_columns WHERE tbl = ? ORDER BY pos', [m.tbl]);
      const meta = cols.map(c => ({ col: c.col, header: c.header, type: c.type, index: !!c.idx }));
      const [rows] = await this.pool.query('SELECT * FROM ' + q(m.tbl) + ' ORDER BY _id');
      const data = [meta.map(c => c.header)], ids = [null], saved = new Map();
      rows.forEach(r => {
        const vals = meta.map(c => fromDb(c.type, r[c.col]));
        data.push(vals); ids.push(r._id); saved.set(r._id, JSON.stringify(vals));
      });
      this.tables.set(m.sheet, m.tbl); this.sheets.set(m.sheet, data); this.rowIds.set(m.sheet, ids);
      this.saved.set(m.sheet, saved); this.meta.set(m.sheet, meta);
    }
    const [p] = await this.pool.query('SELECT k, v FROM gas_props');
    this.props.clear(); p.forEach(r => this.props.set(r.k, r.v));
    const [d] = await this.pool.query('SELECT k, v FROM gas_docs');
    this.docs.clear(); d.forEach(r => this.docs.set(r.k, JSON.parse(r.v)));
  }

  // ----- 給相容環境（runtime.js）呼叫 -----
  idsOf(name) {
    let ids = this.rowIds.get(name);
    if (!ids) { ids = (this.sheets.get(name) || []).map(() => null); this.rowIds.set(name, ids); }
    return ids;
  }
  markSheet(name) { this.dirtySheets.add(name); this.droppedSheets.delete(name); }
  replaceSheet(name, data) {
    this.sheets.set(name, data); this.rowIds.set(name, data.map(() => null));
    this.fullSheets.add(name); this.markSheet(name);
  }
  dropSheet(name) { this.sheets.delete(name); this.rowIds.delete(name); this.droppedSheets.add(name); this.dirtySheets.delete(name); }
  renameSheet(from, to) {
    const d = this.sheets.get(from) || [];
    this.dropSheet(from); this.replaceSheet(to, d);
  }
  setProp(k, v) { this.props.set(k, String(v)); this.dirtyProps.add(k); this.deletedProps.delete(k); }
  deleteProp(k) { this.props.delete(k); this.dirtyProps.delete(k); this.deletedProps.add(k); }
  setDoc(k, v) { this.docs.set(k, v); this.dirtyDocs.add(k); }

  tableNameFor(sheet) {
    if (this.tables.has(sheet)) return this.tables.get(sheet);
    return TABLE_NAMES[sheet] || ('sheet_' + crypto.createHash('md5').update(sheet).digest('hex').slice(0, 10));
  }

  /** 欄位定義：表頭 → 欄位名稱、型別（名稱重複時加 _2、_3…） */
  newColumn(tbl, header, pos, used) {
    const d = defFor(tbl, header) || { col: 'col_' + (pos + 1), type: 'VARCHAR(255)', index: false };
    let col = d.col, n = 2;
    while (used.has(col.toLowerCase())) col = d.col + '_' + (n++);
    used.add(col.toLowerCase());
    return { col, header: String(header == null ? '' : header).trim().slice(0, 200), type: d.type, index: d.index };
  }

  colDef(conn, c) { return q(c.col) + ' ' + c.type + ' NULL COMMENT ' + conn.escape(c.header || c.col); }

  /**
   * 建立資料表、補上新欄位、表頭改名，並在資料放不下時放寬欄位型別（只增不刪）。
   * 回傳 true 表示欄位型別有改，整張表要重寫一次。
   */
  async syncSchema(conn, sheet, data) {
    const tbl = this.tableNameFor(sheet);
    const header = (data && data[0]) || [];
    let meta = this.meta.get(sheet);
    let changed = false, retype = false;
    if (!this.tables.has(sheet) || !meta) {
      const used = new Set(['_id']);
      meta = header.map((h, j) => this.newColumn(tbl, h, j, used));
      const idx = meta.filter(c => c.index).map(c => 'KEY ' + q('ix_' + c.col) + ' (' + indexExpr(c.col, c.type) + ')');
      await conn.query('CREATE TABLE IF NOT EXISTS ' + q(tbl) + ' (_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY' +
        meta.map(c => ', ' + this.colDef(conn, c)).join('') + idx.map(x => ', ' + x).join('') +
        ') ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 ROW_FORMAT=DYNAMIC COMMENT=' + conn.escape(sheet));
      const [[{ n }]] = await conn.query('SELECT COUNT(*) AS n FROM gas_tables');
      await conn.query('REPLACE INTO gas_tables (sheet, tbl, sort) VALUES (?, ?, ?)', [sheet, tbl, n]);
      this.tables.set(sheet, tbl);
      changed = true;
    } else {
      const used = new Set(['_id'].concat(meta.map(c => c.col.toLowerCase())));
      for (let j = 0; j < header.length; j++) {
        const h = String(header[j] == null ? '' : header[j]).trim().slice(0, 200);
        if (j >= meta.length) {
          const c = this.newColumn(tbl, h, j, used);
          await conn.query('ALTER TABLE ' + q(tbl) + ' ADD COLUMN ' + this.colDef(conn, c));
          if (c.index) await conn.query('ALTER TABLE ' + q(tbl) + ' ADD KEY ' + q('ix_' + c.col) + ' (' + indexExpr(c.col, c.type) + ')');
          meta.push(c); changed = true;
        } else if (meta[j].header !== h) {
          // 表頭文字改了：欄位跟著改名（新表頭有英文名稱且沒被用過才改名）
          const c = meta[j], d = defFor(tbl, h);
          const nc = Object.assign({}, c, { header: h });
          if (d && d.col !== c.col && !used.has(d.col.toLowerCase())) { used.delete(c.col.toLowerCase()); nc.col = d.col; used.add(d.col.toLowerCase()); }
          await conn.query('ALTER TABLE ' + q(tbl) + ' CHANGE ' + q(c.col) + ' ' + this.colDef(conn, nc));
          meta[j] = nc; changed = true;
        }
      }
    }
    // 資料放不下目前的型別：放寬到放得下為止
    for (let j = 0; j < meta.length; j++) {
      const c = meta[j];
      const bad = v => convert(c.type, str(v)) == null;
      let first = null;
      for (let i = 1; i < data.length; i++) { if (data[i] && bad(data[i][j])) { first = str(data[i][j]); break; } }
      if (first == null) continue;
      const vals = data.slice(1).map(r => str(r && r[j]));
      const to = widerTypes(c.type).find(t => vals.every(v => convert(t, v) != null)) || 'LONGTEXT';
      const nc = Object.assign({}, c, { type: to });
      if (c.index) await conn.query('ALTER TABLE ' + q(tbl) + ' DROP KEY ' + q('ix_' + c.col)).catch(() => {});
      await conn.query('ALTER TABLE ' + q(tbl) + ' MODIFY ' + this.colDef(conn, nc));
      if (c.index) await conn.query('ALTER TABLE ' + q(tbl) + ' ADD KEY ' + q('ix_' + c.col) + ' (' + indexExpr(c.col, to) + ')');
      this.log('欄位放寬：' + tbl + '.' + c.col + '（' + c.header + '）' + c.type + ' → ' + to + '，例：' + JSON.stringify(first.slice(0, 40)));
      meta[j] = nc; changed = true; retype = true;
    }
    if (changed) {
      await conn.query('DELETE FROM gas_columns WHERE tbl = ?', [tbl]);
      for (let j = 0; j < meta.length; j++) {
        const c = meta[j];
        await conn.query('INSERT INTO gas_columns (tbl, pos, col, header, type, idx) VALUES (?, ?, ?, ?, ?, ?)', [tbl, j, c.col, c.header, c.type, c.index ? 1 : 0]);
      }
    }
    this.meta.set(sheet, meta);
    return retype;
  }

  async flushSheet(conn, sheet) {
    const data = this.sheets.get(sheet) || [[]];
    const ids = this.idsOf(sheet);
    while (ids.length < data.length) ids.push(null);
    const tbl = this.tables.get(sheet);
    const meta = this.meta.get(sheet);
    const width = meta.length;
    let saved = this.saved.get(sheet);
    if (!saved) { saved = new Map(); this.saved.set(sheet, saved); }
    if (this.fullSheets.has(sheet)) {
      await conn.query('DELETE FROM ' + q(tbl));
      saved.clear();
      for (let i = 1; i < ids.length; i++) ids[i] = null;
    }
    const keep = new Set();
    const colList = meta.map(c => q(c.col)).join(', ');
    const setList = meta.map(c => q(c.col) + ' = ?').join(', ');
    for (let i = 1; i < data.length; i++) {
      const row = data[i] || (data[i] = []);
      const vals = [], mem = [];
      for (let j = 0; j < width; j++) {
        const s = str(row[j]);
        const v = convert(meta[j].type, s);
        if (!v) throw new Error(sheet + ' 第 ' + (i + 1) + ' 列「' + meta[j].header + '」的資料放不進欄位型別 ' + meta[j].type);
        vals.push(v.db); mem.push(v.mem);
        if (j < row.length && row[j] !== v.mem) row[j] = v.mem;   // 記憶體也用標準寫法（例如 2026/1/5 → 2026-01-05）
      }
      const json = JSON.stringify(mem);
      const id = ids[i];
      if (id == null) {
        const [r] = await conn.query('INSERT INTO ' + q(tbl) + (width ? ' (' + colList + ') VALUES (' + meta.map(() => '?').join(', ') + ')' : ' () VALUES ()'), vals);
        ids[i] = r.insertId; saved.set(r.insertId, json); keep.add(r.insertId);
      } else {
        keep.add(id);
        if (saved.get(id) !== json) {
          if (width) await conn.query('UPDATE ' + q(tbl) + ' SET ' + setList + ' WHERE _id = ?', vals.concat([id]));
          saved.set(id, json);
        }
      }
    }
    const gone = [...saved.keys()].filter(id => !keep.has(id));
    for (let k = 0; k < gone.length; k += 500) {
      const part = gone.slice(k, k + 500);
      await conn.query('DELETE FROM ' + q(tbl) + ' WHERE _id IN (' + part.map(() => '?').join(', ') + ')', part);
    }
    gone.forEach(id => saved.delete(id));
  }

  /** 把這次請求改到的資料寫回資料庫（同一個交易） */
  async flush() {
    if (!this.dirtySheets.size && !this.droppedSheets.size && !this.dirtyProps.size && !this.deletedProps.size && !this.dirtyDocs.size) return;
    const sheets = [...this.dirtySheets], full = new Set(this.fullSheets), dropped = [...this.droppedSheets];
    const props = [...this.dirtyProps], dels = [...this.deletedProps], docs = [...this.dirtyDocs];
    this.dirtySheets.clear(); this.fullSheets.clear(); this.droppedSheets.clear();
    this.dirtyProps.clear(); this.deletedProps.clear(); this.dirtyDocs.clear();
    const conn = await this.pool.getConnection();
    const renames = [];
    try {
      // 嚴格模式：資料放不下時報錯，而不是默默截斷
      await conn.query("SET SESSION sql_mode = 'STRICT_ALL_TABLES,NO_ENGINE_SUBSTITUTION'");
      // 建表、加欄位會自動確認交易（MySQL 的規定），所以先做
      for (const n of sheets) {
        if (await this.syncSchema(conn, n, this.sheets.get(n) || [[]])) { const sv = this.saved.get(n); if (sv) for (const k of sv.keys()) sv.set(k, null); }
      }
      await conn.beginTransaction();
      for (const n of sheets) { if (full.has(n)) this.fullSheets.add(n); await this.flushSheet(conn, n); this.fullSheets.delete(n); }
      for (const n of dropped) {
        const tbl = this.tables.get(n);
        if (tbl) {
          // 刪掉的工作表：資料表改名保留（del_資料表_日期），不直接刪除
          const stamp = new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 10).replace(/-/g, '');
          await conn.query('DELETE FROM gas_tables WHERE sheet = ?', [n]);
          await conn.query('DELETE FROM gas_columns WHERE tbl = ?', [tbl]);
          this.tables.delete(n); this.saved.delete(n); this.meta.delete(n);
          renames.push([tbl, ('del_' + tbl + '_' + stamp + '_' + Date.now() % 100000).slice(0, 64)]);
        }
      }
      for (const k of props) await conn.query('REPLACE INTO gas_props (k, v) VALUES (?, ?)', [k, this.props.get(k)]);
      for (const k of dels) await conn.query('DELETE FROM gas_props WHERE k = ?', [k]);
      for (const k of docs) await conn.query('REPLACE INTO gas_docs (k, v, updated_at) VALUES (?, ?, NOW())', [k, JSON.stringify(this.docs.get(k))]);
      await conn.commit();
      for (const [a, b] of renames) await conn.query('RENAME TABLE ' + q(a) + ' TO ' + q(b)).catch(e => this.log('資料表改名失敗 ' + a + '：' + e.message));
    } catch (e) {
      await conn.rollback().catch(() => {});
      // 寫入失敗：從資料庫重新讀一次，確保記憶體和資料庫一致（這次的修改不算數）
      await this.load().catch(() => {});
      throw e;
    } finally { conn.release(); }
  }

  /** 每日備份：整份資料存成 JSON 檔（保留 30 份） */
  backupTo(dir) {
    fs.mkdirSync(dir, { recursive: true });
    const stamp = new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 10);
    const file = path.join(dir, 'backup-' + stamp + '.json');
    fs.writeFileSync(file, JSON.stringify({
      at: new Date().toISOString(),
      sheets: Object.fromEntries(this.sheets), props: Object.fromEntries(this.props), docs: Object.fromEntries(this.docs)
    }));
    const old = fs.readdirSync(dir).filter(f => /^backup-.*\.json$/.test(f)).sort();
    old.slice(0, Math.max(0, old.length - 30)).forEach(f => fs.unlinkSync(path.join(dir, f)));
    return file;
  }

  async close() { if (this.pool) await this.pool.end(); }
}

module.exports = { Store, TABLE_NAMES };
