'use strict';
/**
 * Apps Script 相容環境：讓原本的 Code.gs 不用改寫就能在自己的主機上執行。
 * 提供 SpreadsheetApp、PropertiesService、CacheService、LockService、UrlFetchApp、Utilities、
 * Session、HtmlService、ContentService、ScriptApp、DriveApp、Logger 的替代品。
 * 試算表資料放在記憶體（Store），請求結束後寫回 MySQL；檔案存在本機 data/drive。
 */
const vm = require('vm');
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { execFileSync } = require('child_process');

const TZ = 'Asia/Taipei';

// ---------- 日期格式（Utilities.formatDate） ----------
function partsIn(date, tz) {
  const f = new Intl.DateTimeFormat('en-US', {
    timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
    hourCycle: 'h23', weekday: 'short'
  });
  const o = {};
  f.formatToParts(date).forEach(p => { o[p.type] = p.value; });
  const wd = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 }[o.weekday];
  return { y: o.year, M: o.month, d: o.day, H: o.hour === '24' ? '00' : o.hour, m: o.minute, s: o.second, u: wd, E: o.weekday };
}
function formatDate(date, tz, fmt) {
  const p = partsIn(date instanceof Date ? date : new Date(date), tz || TZ);
  return String(fmt).replace(/yyyy|yy|MM|M|dd|d|HH|H|mm|ss|u|EEE|E|'[^']*'/g, t => {
    switch (t) {
      case 'yyyy': return p.y; case 'yy': return p.y.slice(2);
      case 'MM': return p.M; case 'M': return String(Number(p.M));
      case 'dd': return p.d; case 'd': return String(Number(p.d));
      case 'HH': return p.H; case 'H': return String(Number(p.H));
      case 'mm': return p.m; case 'ss': return p.s;
      case 'u': return String(p.u);
      case 'EEE': case 'E': return p.E;
      default: return t.slice(1, -1);
    }
  });
}

// ---------- 位元組（Apps Script 用帶號的 byte 陣列） ----------
const toSigned = buf => Array.from(buf, b => (b > 127 ? b - 256 : b));
const toBuf = x => {
  if (Buffer.isBuffer(x)) return x;
  if (typeof x === 'string') return Buffer.from(x, 'utf8');
  if (Array.isArray(x) || x instanceof Uint8Array || x instanceof Int8Array) return Buffer.from(Array.from(x, b => b & 255));
  return Buffer.from(String(x == null ? '' : x), 'utf8');
};

class Blob {
  constructor(bytes, mime, name) { this._buf = toBuf(bytes || []); this._mime = mime || 'application/octet-stream'; this._name = name || ''; }
  getBytes() { return toSigned(this._buf); }
  getDataAsString() { return this._buf.toString('utf8'); }
  getContentType() { return this._mime; }
  setContentType(m) { this._mime = m; return this; }
  getName() { return this._name; }
  setName(n) { this._name = String(n); return this; }
  getBlob() { return this; }
  copyBlob() { return new Blob(Buffer.from(this._buf), this._mime, this._name); }
}

// ---------- 試算表 ----------
function mkSpreadsheet(store) {
  const strOf = v => {
    if (v == null) return '';
    if (v instanceof Date) return formatDate(v, TZ, 'yyyy-MM-dd HH:mm:ss');
    return String(v);
  };
  class Range {
    constructor(sheet, r, c, nr, nc) { this.sh = sheet; this.r = r; this.c = c; this.nr = nr; this.nc = nc; }
    _grid() { return this.sh._data(); }
    getValues() {
      const g = this._grid(), out = [];
      for (let i = 0; i < this.nr; i++) {
        const row = g[this.r - 1 + i] || [], o = [];
        for (let j = 0; j < this.nc; j++) { const v = row[this.c - 1 + j]; o.push(v == null ? '' : v); }
        out.push(o);
      }
      return out;
    }
    getDisplayValues() { return this.getValues(); }
    getValue() { return this.getValues()[0][0]; }
    getDisplayValue() { return this.getValue(); }
    setValues(vals) {
      const g = this._grid(), ids = this.sh._ids();
      for (let i = 0; i < this.nr; i++) {
        const ri = this.r - 1 + i;
        while (g.length <= ri) { g.push([]); ids.push(null); }
        for (let j = 0; j < this.nc; j++) {
          const ci = this.c - 1 + j;
          while (g[ri].length <= ci) g[ri].push('');
          g[ri][ci] = strOf(vals[i] && vals[i][j]);
        }
      }
      this.sh._touch();
      return this;
    }
    setValue(v) { const a = []; for (let i = 0; i < this.nr; i++) { const r = []; for (let j = 0; j < this.nc; j++) r.push(v); a.push(r); } return this.setValues(a); }
    clearContent() { return this.setValue(''); }
    clear() { return this.clearContent(); }
    getRow() { return this.r; } getColumn() { return this.c; } getNumRows() { return this.nr; } getNumColumns() { return this.nc; }
    // 外觀設定：在資料庫裡沒有意義，直接略過
    setNumberFormat() { return this; } setFontWeight() { return this; } setBackground() { return this; } setFontColor() { return this; }
    setWrap() { return this; } setHorizontalAlignment() { return this; } setDataValidation() { return this; } setNote() { return this; }
  }
  class Sheet {
    constructor(name) { this.name = name; }
    _data() { let d = store.sheets.get(this.name); if (!d) { d = []; store.sheets.set(this.name, d); } return d; }
    _ids() { return store.idsOf(this.name); }   // 每一列對應資料表的 _id（新列為 null），跟著列一起增減
    _touch() {
      const d = this._data(), ids = this._ids();
      while (ids.length < d.length) ids.push(null);
      while (d.length && !d[d.length - 1].some(v => v !== '' && v != null)) { d.pop(); ids.splice(d.length); }   // 去掉尾端空白列
      store.markSheet(this.name);
    }
    getName() { return this.name; }
    setName(n) { store.renameSheet(this.name, n); this.name = n; return this; }
    getSheetId() { return this.name; }
    getLastRow() { return this._data().length; }
    getLastColumn() { return this._data().reduce((m, r) => Math.max(m, r.length), 0); }
    getMaxRows() { return Math.max(1000, this.getLastRow()); }
    getMaxColumns() { return Math.max(26, this.getLastColumn()); }
    getRange(r, c, nr, nc) {
      if (typeof r === 'string') throw new Error('不支援 A1 寫法：' + r);
      return new Range(this, r, c, nr || 1, nc || 1);
    }
    getDataRange() { return new Range(this, 1, 1, Math.max(1, this.getLastRow()), Math.max(1, this.getLastColumn())); }
    appendRow(arr) { const d = this._data(), ids = this._ids(); while (ids.length < d.length) ids.push(null); d.push(arr.map(strOf)); ids.push(null); this._touch(); return this; }
    deleteRow(r) { return this.deleteRows(r, 1); }
    deleteRows(r, n) { const d = this._data(), ids = this._ids(); while (ids.length < d.length) ids.push(null); d.splice(r - 1, n); ids.splice(r - 1, n); this._touch(); return this; }
    insertRowAfter() { return this; }
    setFrozenRows() { return this; } setColumnWidth() { return this; } autoResizeColumns() { return this; }
    hideColumns() { return this; } setTabColor() { return this; }
    clear() { store.replaceSheet(this.name, []); return this; }
  }
  const ss = {
    getId: () => 'local', getName: () => '傑克電機專案回報', getUrl: () => '#',
    getSheetByName: n => (store.sheets.has(n) ? new Sheet(n) : null),
    getSheets: () => [...store.sheets.keys()].map(n => new Sheet(n)),
    insertSheet: n => { store.replaceSheet(n, []); return new Sheet(n); },
    deleteSheet: sh => { store.dropSheet(sh.name); },
    setSpreadsheetTimeZone: () => {}, getSpreadsheetTimeZone: () => TZ
  };
  return { openById: () => ss, getActiveSpreadsheet: () => ss, getActive: () => ss, flush: () => {} };
}

// ---------- 檔案（本機磁碟，取代 Google Drive） ----------
function mkDrive(store, cfg) {
  const root = cfg.driveDir || path.join(cfg.dataDir, 'drive');
  fs.mkdirSync(root, { recursive: true });
  const idx = () => { let d = store.docs.get('drive'); if (!d) { d = { items: {} }; store.setDoc('drive', d); } return d; };
  const save = () => store.setDoc('drive', idx());
  const base = (cfg.publicBase || '') + cfg.mount;
  const newId = () => crypto.randomBytes(12).toString('hex');
  const ensureRoot = () => { const d = idx(); if (!d.items.root) { d.items.root = { id: 'root', kind: 'folder', name: '專案資料', parent: '' }; save(); } };
  const iter = arr => { let i = 0; return { hasNext: () => i < arr.length, next: () => arr[i++] }; };
  const children = (pid, kind) => Object.values(idx().items).filter(x => x.parent === pid && x.kind === kind && !x.trashed);
  class DFile {
    constructor(m) { this.m = m; }
    getId() { return this.m.id; } getName() { return this.m.name; }
    getUrl() { return base + '/drive/file/' + this.m.id; }
    getDownloadUrl() { return this.getUrl() + '?dl=1'; }
    getMimeType() { return this.m.mime; } getSize() { return this.m.size; }
    getDateCreated() { return new Date(this.m.created); }
    setName(n) { this.m.name = String(n); save(); return this; }
    setTrashed(t) { this.m.trashed = !!t; save(); return this; }
    isTrashed() { return !!this.m.trashed; }
    getBlob() { return new Blob(fs.readFileSync(path.join(root, this.m.id)), this.m.mime, this.m.name); }
    setDescription(d) { this.m.desc = String(d); save(); return this; }
    setSharing() { return this; } addViewer() { return this; } addEditor() { return this; }
    getParents() { const p = idx().items[this.m.parent]; return iter(p ? [new DFolder(p)] : []); }
    moveTo(folder) { this.m.parent = folder.getId(); save(); return this; }
  }
  class DFolder {
    constructor(m) { this.m = m; }
    getId() { return this.m.id; } getName() { return this.m.name; }
    getUrl() { return base + '/drive/folder/' + this.m.id; }
    setName(n) { this.m.name = String(n); save(); return this; }
    createFolder(name) { const m = { id: newId(), kind: 'folder', name: String(name), parent: this.m.id, created: Date.now() }; idx().items[m.id] = m; save(); return new DFolder(m); }
    createFile(blob, content, mime) {
      if (typeof blob === 'string') blob = new Blob(content || '', mime || 'text/plain', blob);
      const m = { id: newId(), kind: 'file', name: blob.getName() || 'file', mime: blob.getContentType(), parent: this.m.id, created: Date.now(), size: blob._buf.length };
      fs.writeFileSync(path.join(root, m.id), blob._buf);
      idx().items[m.id] = m; save();
      return new DFile(m);
    }
    getFolders() { return iter(children(this.m.id, 'folder').map(m => new DFolder(m))); }
    getFoldersByName(n) { return iter(children(this.m.id, 'folder').filter(m => m.name === n).map(m => new DFolder(m))); }
    getFiles() { return iter(children(this.m.id, 'file').map(m => new DFile(m))); }
    getFilesByName(n) { return iter(children(this.m.id, 'file').filter(m => m.name === n).map(m => new DFile(m))); }
    getParents() { const p = idx().items[this.m.parent]; return iter(p ? [new DFolder(p)] : []); }
    setTrashed(t) { this.m.trashed = !!t; save(); return this; }
    setSharing() { return this; } addViewer() { return this; } addEditor() { return this; } removeViewer() { return this; }
    getViewers() { return []; } getEditors() { return []; }
  }
  const api = {
    getFolderById: id => {
      ensureRoot();
      const m = idx().items[id];
      if (m && m.kind === 'folder') return new DFolder(m);
      return new DFolder(idx().items.root);   // 舊的 Google Drive 資料夾 ID → 改用本機根目錄
    },
    getFileById: id => {
      const m = idx().items[id];
      if (!m || m.kind !== 'file') throw new Error('找不到檔案 ' + id);
      return new DFile(m);
    },
    createFolder: name => { ensureRoot(); return new DFolder(idx().items.root).createFolder(name); },
    getRootFolder: () => { ensureRoot(); return new DFolder(idx().items.root); },
    // 給網頁伺服器用
    _item: id => idx().items[id] || null,
    _children: id => Object.values(idx().items).filter(x => x.parent === id && !x.trashed),
    _path: id => path.join(root, id)
  };
  return api;
}

// ---------- 對外連線（UrlFetchApp，用 curl 同步執行） ----------
function mkUrlFetch(cfg, log) {
  class HTTPResponse {
    constructor(code, buf, headers) { this.code = code; this.buf = buf; this.headers = headers || {}; }
    getResponseCode() { return this.code; }
    getContentText() { return this.buf.toString('utf8'); }
    getContent() { return toSigned(this.buf); }
    getBlob() { return new Blob(this.buf, this.headers['content-type'] || 'application/octet-stream', ''); }
    getHeaders() { return this.headers; } getAllHeaders() { return this.headers; }
  }
  const lineHost = /^https:\/\/api(-data)?\.line\.me\//;
  function fetch(url, opt) {
    opt = opt || {};
    if (lineHost.test(url) && !cfg.lineEnabled) {
      log('（LINE 已停用，略過）' + (opt.method || 'get').toUpperCase() + ' ' + url.replace(/\?.*/, ''));
      return new HTTPResponse(200, Buffer.from('{}'), { 'content-type': 'application/json' });
    }
    const tmp = path.join(os.tmpdir(), 'jk-' + crypto.randomBytes(8).toString('hex'));
    const method = String(opt.method || 'get').toUpperCase();
    const args = ['-sS', '-o', tmp, '-w', '%{http_code}', '-D', tmp + '.h', '--max-time', '60'];
    // POST 帶資料時不要用 -X POST：用了 curl 會在轉址後繼續 POST，Apps Script 的結果頁要用 GET 拿
    if (method !== 'GET' && !(method === 'POST' && opt.payload != null)) args.push('-X', method);
    if (opt.followRedirects !== false) args.push('-L');
    // Apps Script 的 POST 會先 302 轉址到結果頁，必須用 GET 去拿（curl 預設就是這樣），不能加 --post302
    const headers = Object.assign({}, opt.headers || {});
    let body = null;
    if (opt.payload != null) {
      if (typeof opt.payload === 'object' && !(opt.payload instanceof Blob) && !Array.isArray(opt.payload)) {
        body = Buffer.from(new URLSearchParams(opt.payload).toString());
        headers['Content-Type'] = headers['Content-Type'] || 'application/x-www-form-urlencoded';
      } else body = opt.payload instanceof Blob ? opt.payload._buf : toBuf(opt.payload);
      if (opt.contentType) headers['Content-Type'] = opt.contentType;
      args.push('--data-binary', '@-');
    }
    Object.keys(headers).forEach(k => args.push('-H', k + ': ' + headers[k]));
    args.push(url);
    let code = 0, buf = Buffer.alloc(0), hdr = {};
    try {
      const out = execFileSync(cfg.curl || 'curl', args, { input: body || undefined, timeout: 65000, windowsHide: true });
      code = Number(String(out).trim().slice(-3)) || 0;
      if (fs.existsSync(tmp)) buf = fs.readFileSync(tmp);
      if (fs.existsSync(tmp + '.h')) {
        // 只取最後一段標頭（跟著轉址時會有好幾段）
        const blocks = fs.readFileSync(tmp + '.h', 'utf8').trim().split(/\r?\n\r?\n/);
        blocks[blocks.length - 1].split(/\r?\n/).slice(1).forEach(l => { const i = l.indexOf(':'); if (i > 0) hdr[l.slice(0, i).trim().toLowerCase()] = l.slice(i + 1).trim(); });
      }
    } catch (e) {
      if (!opt.muteHttpExceptions) throw new Error('連線失敗：' + url.replace(/\?.*/, '') + '（' + String(e.message || e).slice(0, 200) + '）');
      code = 0; buf = Buffer.from(String(e.message || e));
    } finally {
      try { fs.unlinkSync(tmp); } catch (e) {}
      try { fs.unlinkSync(tmp + '.h'); } catch (e) {}
    }
    if (code >= 400 && !opt.muteHttpExceptions) throw new Error('Request failed for ' + url.replace(/\?.*/, '') + ' returned code ' + code);
    return new HTTPResponse(code, buf, hdr);
  }
  return { fetch, fetchAll: reqs => reqs.map(r => fetch(r.url, r)) };
}

// ---------- 樣板（HtmlService） ----------
function mkHtml(appDir) {
  class HtmlOutput {
    constructor(html) { this.html = html; this.title = ''; }
    getContent() { return this.html; }
    setTitle(t) { this.title = t; return this; } getTitle() { return this.title; }
    addMetaTag() { return this; } setXFrameOptionsMode() { return this; } setSandboxMode() { return this; }
    setFaviconUrl() { return this; } append(s) { this.html += s; return this; }
  }
  return {
    createHtmlOutput: html => new HtmlOutput(String(html || '')),
    createHtmlOutputFromFile: name => new HtmlOutput(fs.readFileSync(path.join(appDir, name + '.html'), 'utf8')),
    createTemplateFromFile(name) {
      const src = fs.readFileSync(path.join(appDir, name + '.html'), 'utf8');
      const t = {};
      t.evaluate = function () {
        const vars = Object.assign({}, t);
        delete vars.evaluate;
        const html = src.replace(/<\?(!?=)\s*([\s\S]*?)\s*\?>/g, (m, kind, expr) => {
          const v = Function(...Object.keys(vars), 'return (' + expr + ');')(...Object.values(vars));
          const s = v == null ? '' : String(v);
          return kind === '!=' ? s : s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
        });
        return new HtmlOutput(html);
      };
      return t;
    },
    XFrameOptionsMode: { ALLOWALL: 'ALLOWALL', DEFAULT: 'DEFAULT' },
    SandboxMode: { IFRAME: 'IFRAME' }
  };
}

/**
 * 建立一個執行環境：載入 apps/<app>/Code.gs，回傳可以呼叫其中函式的物件。
 * cfg: { appDir, dataDir, mount, publicBase, apiPath, lineEnabled, curl, log }
 */
function createRuntime(store, cfg) {
  const log = cfg.log || ((...a) => console.log(...a));
  const cache = new Map();
  let lockHeld = false;
  const scriptProps = {
    getProperty: k => (store.props.has(k) ? store.props.get(k) : null),
    setProperty: (k, v) => { store.setProp(k, v); return scriptProps; },
    deleteProperty: k => { store.deleteProp(k); return scriptProps; },
    getProperties: () => Object.fromEntries(store.props),
    setProperties: o => { Object.keys(o).forEach(k => store.setProp(k, o[k])); return scriptProps; },
    getKeys: () => [...store.props.keys()]
  };
  const scriptCache = {
    get: k => { const e = cache.get(k); if (!e) return null; if (e.exp < Date.now()) { cache.delete(k); return null; } return e.v; },
    put: (k, v, sec) => { cache.set(k, { v: String(v), exp: Date.now() + 1000 * (sec || 600) }); },
    remove: k => { cache.delete(k); },
    getAll: ks => { const o = {}; ks.forEach(k => { const v = scriptCache.get(k); if (v != null) o[k] = v; }); return o; },
    putAll: (o, sec) => Object.keys(o).forEach(k => scriptCache.put(k, o[k], sec)),
    removeAll: ks => ks.forEach(k => cache.delete(k))
  };
  const drive = mkDrive(store, cfg);
  const trigger = { timeBased: () => trigger, onWeekDay: () => trigger, atHour: () => trigger, nearMinute: () => trigger,
    everyDays: () => trigger, everyHours: () => trigger, everyMinutes: () => trigger, at: () => trigger, inTimezone: () => trigger, create: () => ({}) };
  const sandbox = {
    console: { log: (...a) => log(...a), info: (...a) => log(...a), warn: (...a) => log(...a), error: (...a) => log('[錯誤]', ...a) },
    SpreadsheetApp: mkSpreadsheet(store),
    PropertiesService: { getScriptProperties: () => scriptProps, getUserProperties: () => scriptProps, getDocumentProperties: () => scriptProps },
    CacheService: { getScriptCache: () => scriptCache, getUserCache: () => scriptCache, getDocumentCache: () => scriptCache },
    LockService: {
      getScriptLock: () => ({
        hasLock: () => lockHeld, waitLock: () => { lockHeld = true; }, tryLock: () => { lockHeld = true; return true; },
        releaseLock: () => { lockHeld = false; }
      })
    },
    UrlFetchApp: mkUrlFetch(cfg, log),
    Utilities: {
      formatDate, getUuid: () => crypto.randomUUID(),
      sleep: ms => { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms); },
      DigestAlgorithm: { SHA_256: 'sha256', SHA_1: 'sha1', MD5: 'md5', SHA_512: 'sha512' },
      Charset: { UTF_8: 'utf8' },
      computeDigest: (alg, s) => toSigned(crypto.createHash(alg).update(toBuf(s)).digest()),
      computeHmacSha256Signature: (v, k) => toSigned(crypto.createHmac('sha256', toBuf(k)).update(toBuf(v)).digest()),
      base64Encode: b => toBuf(b).toString('base64'),
      base64EncodeWebSafe: b => toBuf(b).toString('base64').replace(/\+/g, '-').replace(/\//g, '_'),
      base64Decode: s => toSigned(Buffer.from(String(s), 'base64')),
      base64DecodeWebSafe: s => toSigned(Buffer.from(String(s).replace(/-/g, '+').replace(/_/g, '/'), 'base64')),
      newBlob: (bytes, mime, name) => new Blob(bytes, mime, name),
      jsonStringify: JSON.stringify, jsonParse: JSON.parse
    },
    Session: {
      getScriptTimeZone: () => TZ,
      getActiveUser: () => ({ getEmail: () => '' }),
      getEffectiveUser: () => ({ getEmail: () => cfg.ownerEmail || '' }),
      getTemporaryActiveUserKey: () => ''
    },
    HtmlService: mkHtml(cfg.appDir),
    ContentService: {
      createTextOutput: t => ({ t: String(t == null ? '' : t), mime: 'text/plain', setMimeType(m) { this.mime = m; return this; }, getContent() { return this.t; } }),
      MimeType: { JSON: 'application/json', TEXT: 'text/plain', JAVASCRIPT: 'application/javascript' }
    },
    ScriptApp: {
      newTrigger: () => trigger, getProjectTriggers: () => [], deleteTrigger: () => {},
      WeekDay: { MONDAY: 1, TUESDAY: 2, WEDNESDAY: 3, THURSDAY: 4, FRIDAY: 5, SATURDAY: 6, SUNDAY: 7 },
      getService: () => ({ getUrl: () => (cfg.publicBase || '') + cfg.mount + '/' }),
      getScriptId: () => 'local'
    },
    DriveApp: drive,
    Logger: { log: (...a) => log(...a) },
    Buffer: undefined
  };
  vm.createContext(sandbox);
  let src = fs.readFileSync(path.join(cfg.appDir, 'Code.gs'), 'utf8');
  // 公司網址版的 API 位址改成這台主機自己的路徑
  src = src.replace(/const WEB_API_URL = '[^']*';/, 'const WEB_API_URL = ' + JSON.stringify(cfg.apiPath) + ';');
  if (cfg.adminApi) src = src.replace(/const ADMIN_API_URL = '[^']*';/, 'const ADMIN_API_URL = ' + JSON.stringify(cfg.adminApi) + ';');
  vm.runInContext(src, sandbox, { filename: 'Code.gs' });

  // 每次請求前清掉 Apps Script 原本「每次執行都是新的」那些暫存變數
  const resetScript = new vm.Script(
    'try { _SS = null; _ROWS = {}; _AFTER = []; } catch (e) {}\n' +
    'try { _DEPTS = null; } catch (e) {}\n' +
    'try { _TREE = null; _MET = null; } catch (e) {}\n' +
    'try { _AUTH_FAIL = 0; _AUTH_CLEARED = false; } catch (e) {}\n' +
    'try { _WEBAUTH = null; } catch (e) {}');
  return {
    sandbox, drive,
    reset() { lockHeld = false; resetScript.runInContext(sandbox); },
    call(name, ...args) {
      const fn = sandbox[name];
      if (typeof fn !== 'function') throw new Error('沒有這個函式：' + name);
      this.reset();
      return fn(...args);
    }
  };
}

module.exports = { createRuntime, formatDate, Blob };
