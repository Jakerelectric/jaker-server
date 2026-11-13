'use strict';
/**
 * LINE 圖文選單：版本號改了才重新建立（啟動時檢查），建立後設為所有人的預設選單並刪掉舊的。
 * 圖片：public/richmenu.png（2500×843，2 列 × 3 欄）
 */
const fs = require('fs');
const path = require('path');

const VERSION = '2026-11-13-upload';   // 改選單內容或圖片時，這個要跟著改
const NAME = '傑克電機專案選單';

function definition(dashboardUrl) {
  const cols = [[0, 833], [833, 833], [1666, 834]], rows = [[0, 421], [421, 422]];
  const pb = (label) => ({ type: 'postback', label, data: 'cmd:' + label, displayText: label });
  const acts = [pb('每週更新'), pb('我的任務'), pb('新增任務'), pb('專案總覽'), pb('上傳檔案'),
    { type: 'uri', label: '開啟儀表板', uri: dashboardUrl }];
  return {
    size: { width: 2500, height: 843 }, selected: true, name: NAME, chatBarText: '功能選單',
    areas: acts.map((a, i) => ({ bounds: { x: cols[i % 3][0], y: rows[Math.floor(i / 3)][0], width: cols[i % 3][1], height: rows[Math.floor(i / 3)][1] }, action: a }))
  };
}

async function ensureRichMenu(store, cfg, log) {
  const token = store.props.get('LINE_TOKEN');
  if (!cfg.lineEnabled || !token || token === 'disabled') return;
  if (store.props.get('RICHMENU_VER') === VERSION) return;
  const H = { Authorization: 'Bearer ' + token };
  const api = async (url, opt) => {
    const r = await fetch(url, Object.assign({ headers: H }, opt || {}));
    const t = await r.text();
    if (!r.ok) throw new Error(url.replace(/^https:\/\/[^/]+/, '') + ' → ' + r.status + ' ' + t.slice(0, 200));
    return t ? JSON.parse(t) : {};
  };
  const base = (cfg.publicBase || 'https://work.jaker-ai.com').replace(/\/+$/, '');
  const old = (await api('https://api.line.me/v2/bot/richmenu/list')).richmenus || [];
  const { richMenuId: id } = await api('https://api.line.me/v2/bot/richmenu', {
    method: 'POST', headers: Object.assign({ 'Content-Type': 'application/json' }, H), body: JSON.stringify(definition(base + '/pm/?openExternalBrowser=1'))
  });
  await api('https://api-data.line.me/v2/bot/richmenu/' + id + '/content', {
    method: 'POST', headers: Object.assign({ 'Content-Type': 'image/png' }, H), body: fs.readFileSync(path.join(__dirname, '..', 'public', 'richmenu.png'))
  });
  await api('https://api.line.me/v2/bot/user/all/richmenu/' + id, { method: 'POST' });
  for (const m of old.filter(m => m.name === NAME)) {
    await fetch('https://api.line.me/v2/bot/richmenu/' + m.richMenuId, { method: 'DELETE', headers: H }).catch(() => {});
  }
  store.setProp('RICHMENU_VER', VERSION);
  await store.flush();
  log('LINE 圖文選單已更新（' + VERSION + '），刪除舊選單 ' + old.filter(m => m.name === NAME).length + ' 個');
}

module.exports = { ensureRichMenu, definition, VERSION };
