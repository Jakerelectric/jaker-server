'use strict';
/** 把資料裡的 Google Drive 連結換成本機連結（對照表存在 gas_docs 的 drive-migration） */

/** 從各種 Google 連結取出檔案／資料夾 ID */
function driveIds(text) {
  const out = [];
  String(text).replace(/https?:\/\/(?:drive|docs)\.google\.com\/[^\s"'<>，、]*/g, url => {
    const m = url.match(/\/d\/([\w-]{20,})/) || url.match(/[?&]id=([\w-]{20,})/) || url.match(/\/folders\/([\w-]{20,})/);
    if (m) out.push({ url, id: m[1] });
    return url;
  });
  return out;
}

/** 回傳 { changed: 換掉幾處, left: [還沒換掉的連結說明] } */
function rewriteDriveLinks(store) {
  const done = store.docs.get('drive-migration') || {};
  let changed = 0;
  const left = [];
  for (const [name, data] of store.sheets) {
    let dirty = false;
    for (let i = 1; i < data.length; i++) {
      for (let j = 0; j < (data[i] || []).length; j++) {
        const v = data[i][j];
        if (!v || String(v).indexOf('google.com') < 0) continue;
        let nv = String(v);
        driveIds(v).forEach(x => {
          if (done[x.id]) { nv = nv.split(x.url).join(done[x.id]); changed++; }
          else if (!/spreadsheets|script\.google/.test(x.url)) left.push(name + ' 第 ' + (i + 1) + ' 列：' + x.url);
        });
        if (nv !== v) { data[i][j] = nv; dirty = true; }
      }
    }
    if (dirty) store.markSheet(name);
  }
  return { changed, left };
}

module.exports = { driveIds, rewriteDriveLinks };
