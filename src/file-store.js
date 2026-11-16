'use strict';
/**
 * 單機版資料儲存：不用安裝 MySQL，資料存成這台電腦上的 JSON 檔（data/<名稱>-db）。
 *   - 跟 Store（MySQL 版）一樣的用法，程式其他地方不用改
 *   - 每張工作表一個檔案；每次請求結束只寫有變動的工作表，先寫暫存檔再換名，寫到一半當機也不會壞
 *   - 之後要搬到公司主機：用 tools/import-backup.js 把這裡的資料匯入 MySQL
 * .env 設 STORE=file 時使用。
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const fileOf = name => crypto.createHash('md5').update(String(name)).digest('hex').slice(0, 16) + '.json';

class FileStore {
  constructor(dir, opts) {
    this.dir = dir;
    this.opts = opts || {};
    this.log = this.opts.log || (m => console.log(m));
    this.sheets = new Map();
    this.rowIds = new Map();
    this.props = new Map();
    this.docs = new Map();
    this.dirtySheets = new Set();
    this.droppedSheets = new Set();
    this.dirtyMeta = false;
  }

  async open() {
    fs.mkdirSync(path.join(this.dir, 'sheets'), { recursive: true });
    for (const f of fs.readdirSync(path.join(this.dir, 'sheets'))) {
      if (!/^[0-9a-f]{16}\.json$/.test(f)) continue;
      const o = JSON.parse(fs.readFileSync(path.join(this.dir, 'sheets', f), 'utf8'));
      this.sheets.set(o.name, o.data);
    }
    const meta = path.join(this.dir, 'meta.json');
    if (fs.existsSync(meta)) {
      const m = JSON.parse(fs.readFileSync(meta, 'utf8'));
      Object.entries(m.props || {}).forEach(([k, v]) => this.props.set(k, v));
      Object.entries(m.docs || {}).forEach(([k, v]) => this.docs.set(k, v));
    }
  }

  // ----- 跟 Store 相同的介面（runtime.js 會呼叫） -----
  idsOf(name) {
    let ids = this.rowIds.get(name);
    if (!ids) { ids = (this.sheets.get(name) || []).map(() => null); this.rowIds.set(name, ids); }
    return ids;
  }
  markSheet(name) { this.dirtySheets.add(name); this.droppedSheets.delete(name); }
  replaceSheet(name, data) { this.sheets.set(name, data); this.rowIds.set(name, data.map(() => null)); this.markSheet(name); }
  dropSheet(name) { this.sheets.delete(name); this.rowIds.delete(name); this.droppedSheets.add(name); this.dirtySheets.delete(name); }
  renameSheet(from, to) { const d = this.sheets.get(from) || []; this.dropSheet(from); this.replaceSheet(to, d); }
  setProp(k, v) { this.props.set(k, String(v)); this.dirtyMeta = true; }
  deleteProp(k) { this.props.delete(k); this.dirtyMeta = true; }
  setDoc(k, v) { this.docs.set(k, v); this.dirtyMeta = true; }

  writeAtomic(file, text) {
    const tmp = file + '.tmp';
    fs.writeFileSync(tmp, text);
    fs.renameSync(tmp, file);
  }

  async flush() {
    const dir = path.join(this.dir, 'sheets');
    for (const n of this.dirtySheets) this.writeAtomic(path.join(dir, fileOf(n)), JSON.stringify({ name: n, data: this.sheets.get(n) || [] }));
    for (const n of this.droppedSheets) {
      const f = path.join(dir, fileOf(n));
      if (fs.existsSync(f)) fs.renameSync(f, path.join(this.dir, 'deleted-' + Date.now() + '-' + fileOf(n)));   // 刪掉的工作表留一份
    }
    if (this.dirtyMeta) this.writeAtomic(path.join(this.dir, 'meta.json'), JSON.stringify({ props: Object.fromEntries(this.props), docs: Object.fromEntries(this.docs) }));
    this.dirtySheets.clear(); this.droppedSheets.clear(); this.dirtyMeta = false;
  }

  /** 備份：整份資料存成一個 JSON 檔（保留 30 份），格式跟 MySQL 版相同 */
  backupTo(dir) {
    fs.mkdirSync(dir, { recursive: true });
    const stamp = new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 19).replace(/[-:]/g, '').replace('T', '-');
    const file = path.join(dir, 'backup-' + stamp + '.json');
    fs.writeFileSync(file, JSON.stringify({ at: new Date().toISOString(), sheets: Object.fromEntries(this.sheets), props: Object.fromEntries(this.props), docs: Object.fromEntries(this.docs) }));
    const old = fs.readdirSync(dir).filter(f => /^backup-.*\.json$/.test(f)).sort();
    old.slice(0, Math.max(0, old.length - 30)).forEach(f => fs.unlinkSync(path.join(dir, f)));
    return file;
  }

  async close() {}
}

module.exports = { FileStore };
