'use strict';
/**
 * 把 Google Drive 上的專案檔案搬到這台電腦，並把資料庫裡所有 Google Drive 連結換成本機連結。
 *   1. 在 Apps Script 執行 exportDriveManifest（產生 drive-manifest.json 放在照片根資料夾）
 *   2. 在 Google Drive 對「照片根資料夾」按右鍵 → 下載（會變成一或多個 zip），全部解壓縮到同一個資料夾
 *   3. node tools\import-drive.js <解壓縮後的資料夾>
 * 可以重複執行：已經搬過的檔案會略過。
 */
const path = require('path');
const fs = require('fs');
const { loadConfig } = require('../src/config');
const { Store } = require('../src/store');
const { createRuntime } = require('../src/runtime');

const MIME = {
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp', heic: 'image/heic',
  pdf: 'application/pdf', zip: 'application/zip', txt: 'text/plain', csv: 'text/csv',
  doc: 'application/msword', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  ppt: 'application/vnd.ms-powerpoint', pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  dwg: 'image/vnd.dwg', dxf: 'image/vnd.dxf', step: 'application/step', stp: 'application/step', mp4: 'video/mp4', mov: 'video/quicktime'
};

function walk(dir, out) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out); else out.push(p);
  }
  return out;
}
const { rewriteDriveLinks } = require('./drive-links');

(async () => {
  const src = process.argv[2];
  if (!src || !fs.existsSync(src) || !fs.statSync(src).isDirectory()) {
    console.error('用法：node tools\\import-drive.js <Google Drive 下載後解壓縮的資料夾>');
    process.exit(1);
  }
  const all = walk(path.resolve(src), []);
  const manFile = all.find(p => path.basename(p) === 'drive-manifest.json');
  if (!manFile) { console.error('找不到 drive-manifest.json：請先在 Apps Script 執行 exportDriveManifest，再重新下載資料夾。'); process.exit(1); }
  const man = JSON.parse(fs.readFileSync(manFile, 'utf8'));
  const base = path.dirname(manFile);
  const byName = {};
  all.forEach(p => { const n = path.basename(p); (byName[n] = byName[n] || []).push(p); });

  const ROOT = path.resolve(__dirname, '..');
  const cfg = loadConfig(ROOT);
  const store = new Store(cfg.db, { backupDir: path.join(cfg.dataDir, 'backups') });
  await store.open();
  const rt = createRuntime(store, {
    appDir: path.join(ROOT, 'apps', 'pm'), dataDir: cfg.dataDir, driveDir: cfg.driveDir, mount: '/pm', publicBase: cfg.publicBase,
    apiPath: '/pm/api', lineEnabled: false, log: () => {}
  });
  const D = rt.sandbox.DriveApp;
  const root = D.getRootFolder();
  if (man.root) root.setName(man.root);
  const done = Object.assign({}, store.docs.get('drive-migration') || {});   // Google ID → 本機網址
  const folderOf = {};
  function localFolder(rel) {
    if (!rel) return root;
    if (folderOf[rel]) return folderOf[rel];
    const parts = rel.split('/'), parent = localFolder(parts.slice(0, -1).join('/')), name = parts[parts.length - 1];
    const it = parent.getFoldersByName(name);
    return (folderOf[rel] = it.hasNext() ? it.next() : parent.createFolder(name));
  }
  let copied = 0, skipped = 0;
  const missing = [];
  const used = new Set();
  for (const it of man.items) {
    if (it.folder) { done[it.id] = done[it.id] || localFolder(it.path ? it.path + '/' + it.name : it.name).getUrl(); continue; }
    if (it.name === 'drive-manifest.json') continue;
    if (done[it.id]) { skipped++; continue; }
    const dir = path.join(base, ...(it.path ? it.path.split('/') : []));
    let file = path.join(dir, it.name);
    // 同一個資料夾有同名檔時，Google 下載會把後面的改名成「名稱 (1).jpg」「名稱 (2).jpg」…
    if (used.has(file)) {
      const dot = it.name.lastIndexOf('.'), stem = dot > 0 ? it.name.slice(0, dot) : it.name, ext = dot > 0 ? it.name.slice(dot) : '';
      for (let n = 1; n < 50; n++) { const alt = path.join(dir, stem + ' (' + n + ')' + ext); if (fs.existsSync(alt) && !used.has(alt)) { file = alt; break; } }
    }
    if (!fs.existsSync(file) || used.has(file)) {
      // 同資料夾有同名檔時，Google 下載會改名成「名稱 (1).jpg」；找不到就用檔名在整個資料夾裡找
      const c = byName[it.name] || [];
      file = c.find(p => !used.has(p) && it.path && p.indexOf(it.path.split('/')[0]) >= 0) || c.find(p => !used.has(p));
    }
    if (!file) { missing.push(it); continue; }
    used.add(file);
    const ext = (it.name.split('.').pop() || '').toLowerCase();
    const blob = rt.sandbox.Utilities.newBlob(fs.readFileSync(file), it.mime && it.mime.indexOf('google-apps') < 0 ? it.mime : (MIME[ext] || 'application/octet-stream'), it.name);
    done[it.id] = localFolder(it.path).createFile(blob).getUrl();
    copied++;
  }
  store.setDoc('drive-migration', done);

  // 把所有工作表裡的 Google Drive 連結換成本機連結
  const { changed, left } = rewriteDriveLinks(store);
  await store.flush();
  await store.close();

  console.log('複製檔案：' + copied + ' 個（之前已搬過 ' + skipped + ' 個）');
  console.log('改成本機連結：' + changed + ' 處');
  const logDir = path.join(cfg.dataDir, 'logs');
  fs.mkdirSync(logDir, { recursive: true });
  if (missing.length || left.length) {
    const f = path.join(logDir, 'drive-migration-missing.txt');
    fs.writeFileSync(f, '﻿' + ['下載的資料夾裡找不到的檔案：'].concat(missing.map(m => (m.path ? m.path + '/' : '') + m.name + '（' + m.id + '）'),
      ['', '資料庫裡還沒換掉的 Google 連結（檔案不在照片根資料夾裡，或已被刪除）：'], left).join('\r\n'));
    console.log('有 ' + missing.length + ' 個檔案找不到、' + left.length + ' 個連結沒換掉，清單在 ' + f);
  }
  console.log('完成。重新啟動服務後生效。');
})().catch(e => { console.error('搬移失敗：', e.message || e); process.exit(1); });
