/**
 * 傑克電機 專案回報系統（LINE 版）
 * ------------------------------------------------------------
 * LINE 官方帳號私訊 → 本程式 → Google 試算表（專案／任務／每週更新／照片／成員）
 * 另附網頁儀表板（Dashboard.html），可嵌入 Google 協作平台入口網頁。
 *
 * 權限（LINE 與網頁相同）：
 *   主管（成員表「角色」填 管理員）：全部功能，主管開的專案直接成立
 *   成員也可以開專案，但要由提案單位的主管（單位表「主管」欄）核准後才成立
 *   專案負責人：自己專案的每週更新、新增／刪除任務、標記任務完成
 *   參與成員：該專案的每週更新、標記自己負責的任務
 *   其他人：只能查看
 * 網頁版用登入的公司信箱認人，請在成員表「公司信箱」欄填上每位成員的信箱。
 *
 * 安裝步驟請看交付說明。必要的「指令碼屬性」：
 *   LINE_TOKEN   LINE Channel access token（長期）
 * 選用的「指令碼屬性」：
 *   BIND_CODE    綁定密語。設定後，新成員第一次使用要先輸入這組密語，避免外人加好友就能寫入。
 */

// 資料所在的試算表（傑克電機專案回報）
const SHEET_ID = '1fgFseJ10Y54WfBnjZSdHLSogR57gzSOyrSajNJlK6ZA';
// 同一次執行內重複使用：試算表只開一次、每張表只讀一次（寫入後自動重讀）
var _SS = null, _ROWS = {}, _AFTER = [];
function ss_() { return _SS || (_SS = SpreadsheetApp.openById(SHEET_ID)); }

// ===== 可調整的設定 =====
const CONFIG = {
  WEEKLY_REMIND: true,    // 週五 14:00 提醒「本週還沒更新」的專案負責人
  OVERDUE_REMIND: true,   // 平日 08:30 提醒任務負責人「今天到期／已逾期」的任務
  MONDAY_SUMMARY: true,   // 週一 08:40 推送專案總覽給「管理員」
  NOTIFY_ASSIGNEE: true,  // 幫別人新增任務時，通知被指派的人
  PHOTO_ROOT_NAME: '傑克電機專案照片'
};
// 主動推播（提醒、通知）會用到官方帳號每月的免費訊息則數；回覆訊息不計。

// 開發類階段依「設計與開發管制程序」；★ 為審查點
const STAGES = ['開發提案', '可行性評估', '設計', '設計審查', '樣品試作', '設計驗證', '文件整理及發行', '產品確認'];
const GATES = ['可行性評估', '設計審查', '設計驗證', '產品確認'];
function stageLabel_(s) { return GATES.indexOf(s) >= 0 ? s + '★' : s; }
// 案件編號原則：JK-單位-年度流水號（例如 JK-HV-2601）
// 單位代碼放在試算表「單位」工作表，依組織架構維護；第一次使用時自動建立以下預設值
const DEFAULT_DEPTS = [['GM', '總經理室', ''], ['RD', '開發課', '開發部'], ['HV', '高壓實驗室', '開發部']];
var _DEPTS = null;
/** 啟用中的單位 { 代碼: 單位名稱 }，依排序 */
function depts_() {
  if (_DEPTS) return _DEPTS;
  if (!rows_('D').length) {   // 空的單位表：先填入預設單位
    sheet_('D').getRange(2, 1, DEFAULT_DEPTS.length, 5).setValues(DEFAULT_DEPTS.map(function (d, i) { return [d[0], d[1], d[2], String((i + 1) * 10), '是']; }));
    delete _ROWS['D'];
  }
  const o = {};
  rows_('D').filter(function (d) { return /^[A-Z][A-Z0-9]{1,3}$/.test(normCode_(d['代碼'])) && d['啟用'] !== '否'; })
    .sort(function (a, b) { return (Number(a['排序']) || 999) - (Number(b['排序']) || 999); })
    .forEach(function (d) { o[normCode_(d['代碼'])] = d['單位名稱'] || normCode_(d['代碼']); });
  return (_DEPTS = o);
}
function deptParents_() { const o = {}; rows_('D').forEach(function (d) { o[normCode_(d['代碼'])] = d['上層部門'] || ''; }); return o; }
const TEST_RESULTS = ['待判定', '合格', '不合格'];
// 專案類型與各自的階段（最後一個階段＝結案）
const TYPES = { '開發': STAGES, '管理': ['啟動', '文件建立', '導入運行', '內部稽核', '驗證'], '製程': ['問題提出', '現況分析', '改善對策', '試行驗證', '標準化'] };
function typeOf_(p) { return p && TYPES[p['類型']] ? p['類型'] : '開發'; }
// 階段：有主任務／子任務時，階段＝主任務（自動取第一個未完成的主任務）；否則用類型的預設階段，在每週更新時選
function stagesOf_(p) { return metrics_(p).stages; }
function isClosed_(p) { return metrics_(p).closed; }
function curStage_(p) { return metrics_(p).stage; }
function hasHier_(p) { return metrics_(p).hier; }
const LIGHTS = ['正常', '有風險', '卡關'];
const LIGHT_ICON = { '正常': '🟢', '有風險': '🟡', '卡關': '🔴', '逾期': '🔴' };
const RISK_GAP = 10;  // 實際進度落後計畫進度 10～未滿 20 個百分點＝黃燈（有風險）
const RED_GAP = 20;   // 落後 20 個百分點以上＝紅燈（卡關）
const PCT_STEPS = [0, 25, 50, 75, 100];   // 任務完成度回報的級距
const DUE_SOON_DAYS = 3;                  // 到期前幾天提醒

const SH = { P: '專案', T: '任務', U: '每週更新', F: '照片', M: '成員', R: '意見回饋', E: '研究試驗單', D: '單位', C: '變更紀錄' };
const HEAD = {
  P: ['編號', '專案名稱', '目的與預期成果', '負責人', '參與成員', '階段', '燈號', '開始日', '截止日', '卡關事項', '建立時間', '最近更新', '類型', '部門', '產品規格', '實際開案日', '實際結案日', '基準開始日', '基準結案日', '基準鎖定日', '基準鎖定人', '核准狀態', '申請人', '核准人', '核准時間', '退回原因'],
  T: ['編號', '專案編號', '任務', '負責人', '完成日', '狀態', '完成時間', '建立人', '建立時間', '開始日', '實際開始日', '層級', '排序', '權重', '完成度', '進度回報日', '提醒延後至', '基準開始日', '基準完成日'],
  U: ['時間', '專案編號', '填寫人', '燈號', '階段', '本週完成', '下週計畫', '卡關事項'],
  F: ['時間', '專案編號', '上傳人', '檔案連結', '檔名', '分類', '說明'],
  M: ['姓名', 'LINE userId', '角色', '綁定時間', '接收提醒', '公司信箱'],
  R: ['編號', '時間', '類型', '提出人', '來源', '內容', '附件', '狀態', '處理回覆', '處理人', '處理時間'],
  D: ['代碼', '單位名稱', '上層部門', '排序', '啟用', '主管'],
  C: ['時間', '專案編號', '任務編號', '項目', '原值', '新值', '原因', '修改人'],
  E: ['試驗單編號', '專案編號', '試驗名稱', '試驗日期', '試驗人員', '試驗目的', '試驗條件與參數', '試驗結果', '判定', '附件', '建立人', '建立時間']
};
const FILE_CATS = ['客戶需求', '圖面', '規格書', '報價／合約', '試驗報告', '會議記錄', '照片', '其他'];
const FILE_MAX_MB = 20;   // 網頁上傳單一檔案上限
const FB_TYPES = ['錯誤', '建議'];
const FB_STATUS = ['待處理', '處理中', '已完成', '不採用'];

// =====================================================================
// 一、初始化（在編輯器裡手動執行一次 setup）
// =====================================================================
function setup() {
  const ss = ss_();
  ss.setSpreadsheetTimeZone(Session.getScriptTimeZone());
  Object.keys(HEAD).forEach(function (k) {
    let sh = ss.getSheetByName(SH[k]);
    if (!sh) sh = ss.insertSheet(SH[k]);
    if (sh.getLastRow() === 0) {
      sh.getRange(1, 1, 1, HEAD[k].length).setValues([HEAD[k]])
        .setFontWeight('bold').setBackground('#0064F3').setFontColor('#FFFFFF');
      sh.setFrozenRows(1);
      sh.getRange(1, 1, sh.getMaxRows(), HEAD[k].length).setNumberFormat('@'); // 全部存成文字，日期不會被自動轉換
    }
  });
  const def = ss.getSheetByName('工作表1') || ss.getSheetByName('Sheet1');
  if (def && def.getLastRow() === 0 && ss.getSheets().length > 1) ss.deleteSheet(def);

  // 照片根資料夾
  const props = PropertiesService.getScriptProperties();
  if (!props.getProperty('PHOTO_FOLDER_ID')) {
    const folder = DriveApp.createFolder(CONFIG.PHOTO_ROOT_NAME);
    props.setProperty('PHOTO_FOLDER_ID', folder.getId());
  }

  importLegacy_();
  installTriggers_();

  const ok = props.getProperty('LINE_TOKEN') ? '已設定' : '⚠ 尚未設定，請到「專案設定 → 指令碼屬性」新增 LINE_TOKEN';
  Logger.log('完成初始化。LINE_TOKEN：' + ok);
}

// 舊版「傑克電機專案追蹤表」中的實際資料（範例資料不匯入）
function importLegacy_() {
  if (rows_('P').length) return;
  const now = nowStr_();
  append_('P', {
    '編號': 'P01', '專案名稱': '2.25英吋套管開發(CS2C001-B)', '目的與預期成果': '',
    '負責人': 'Lily', '參與成員': 'Kevin、Jay', '階段': '開發', '燈號': '正常',
    '開始日': '2026-09-22', '截止日': '2026-10-30', '卡關事項': '', '建立時間': now, '最近更新': ''
  });
  append_('T', {
    '編號': 'T001', '專案編號': 'P01', '任務': '開立模具', '負責人': 'Lily', '完成日': '2026-11-02',
    '狀態': '未完成', '完成時間': '', '建立人': 'Lily', '建立時間': now
  });
}

function installTriggers_() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (['weeklyReminder', 'dailyOverdue', 'mondaySummary'].indexOf(t.getHandlerFunction()) >= 0) ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('weeklyReminder').timeBased().onWeekDay(ScriptApp.WeekDay.FRIDAY).atHour(14).nearMinute(0).create();
  ScriptApp.newTrigger('dailyOverdue').timeBased().everyDays(1).atHour(8).nearMinute(30).create();
  ScriptApp.newTrigger('mondaySummary').timeBased().onWeekDay(ScriptApp.WeekDay.MONDAY).atHour(8).nearMinute(40).create();
}

/** 在編輯器執行，確認 LINE_TOKEN 是否有效 */
function testToken() {
  const res = UrlFetchApp.fetch('https://api.line.me/v2/bot/info', {
    headers: { Authorization: 'Bearer ' + token_() }, muteHttpExceptions: true
  });
  noteAuth_(res.getResponseCode());
  Logger.log(res.getResponseCode() === 200 ? '✅ 金鑰有效：' + res.getContentText() : '❌ 金鑰無效：' + res.getContentText());
}

// =====================================================================
// 二、網頁入口：LINE Webhook（doPost）與儀表板（doGet）
// =====================================================================
function doPost(e) {
  let body = null;
  try { body = JSON.parse(e.postData.contents); } catch (err) { body = null; }
  if (body && (body.api || body.page)) return webApi_(body);   // 公司網址 work.jaker.com.tw/pm 的儀表板
  try {
    (body.events || []).forEach(function (ev) {
      // 照片／檔案常一次傳很多個，要排隊處理；其他訊息只有寫入時才排隊
      const media = ev.type === 'message' && ev.message && ['image', 'file', 'video'].indexOf(ev.message.type) >= 0;
      try { if (media) withLock_(function () { handleEvent_(ev); }); else handleEvent_(ev); }
      catch (err) { console.error(err && err.stack || err); try { if (ev.replyToken) reply_(ev.replyToken, txt_('系統發生錯誤，請稍後再試，或輸入「取消」重新開始。')); } catch (x) {} }
      flushAfter_();
    });
  } catch (err) { console.error(err && err.stack || err); }
  failIfAuth_();   // 金鑰失效時讓這次執行顯示「失敗」，不會再悄悄沒回覆
  return ContentService.createTextOutput('OK');
}

function doGet() {
  const email = Session.getActiveUser().getEmail();
  if (!email) {
    return HtmlService.createHtmlOutput('<p style="font-family:sans-serif;padding:24px;line-height:1.6">請用公司 Google 帳號登入後，從「專案儀表板」網址開啟。</p>')
      .setTitle('傑克電機 專案儀表板');
  }
  const t = HtmlService.createTemplateFromFile('Dashboard');
  t.data = JSON.stringify(dashboardData_(webUser_())).replace(/</g, '\\u003c');
  t.api = '""';
  return t.evaluate()
    .setTitle('傑克電機 專案儀表板')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

function dashboardData_(u) {
  const photos = rows_('F');
  const m = u && u.member;
  return {
    me: { email: u ? u.email : '', name: m ? m['姓名'] : '', role: m ? m['角色'] : '', admin: isAdmin_(m), owner: isOwner_(m) },
    today: todayStr_(),
    projects: rows_('P').filter(function (p) { return canSeeProject_(m, p); }).map(function (p) {
      const c = strip_(p), mt = metrics_(p); c['類型'] = typeOf_(p); c['燈號'] = mt.light; c['階段'] = mt.stage; c._m = mt;
      if (isPending_(p)) c._ap = { state: p['核准狀態'], applicant: p['申請人'] || '', approvers: approversFor_(p), can: canApprove_(m, p), mine: !!m && p['申請人'] === m['姓名'] };
      return c;
    }),
    types: TYPES, riskGap: RISK_GAP, redGap: RED_GAP,
    tasks: tasksOut_(),
    updates: rows_('U').slice(-400).map(strip_),
    photos: photos.slice(-2000).map(strip_), fileCats: FILE_CATS, fileMaxMb: FILE_MAX_MB,
    members: rows_('M').map(function (m) { return m['姓名']; }),
    feedback: rows_('R').slice(-300).map(strip_),
    tests: rows_('E').slice(-1000).map(strip_),
    changes: rows_('C').slice(-800).map(strip_),
    pctSteps: PCT_STEPS,
    depts: depts_(), deptParents: deptParents_(), gates: GATES,
    units: isOwner_(m) ? unitsForAdmin_() : [],
    membersAdmin: isOwner_(m) ? membersForAdmin_() : [],
    lineAlert: isAdmin_(m) ? lineAlert_() : null,
    sheetUrl: ss_().getUrl()
  };
}

// =====================================================================
// 三、LINE 訊息處理
// =====================================================================
function handleEvent_(ev) {
  if (!ev.source || ev.source.type !== 'user') return;              // 只處理一對一私訊
  if (ev.webhookEventId && seen_(ev.webhookEventId)) return;        // LINE 重送時不重複處理
  const uid = ev.source.userId, rt = ev.replyToken;

  if (ev.type === 'follow') {
    const m = memberByUid_(uid);
    if (m) return reply_(rt, menu_('歡迎回來，' + m['姓名'] + '！'));
    return startBind_(uid, rt);
  }
  if (ev.type !== 'message' && ev.type !== 'postback') return;

  const st = getState_(uid);
  const inp = parseInput_(ev);
  const me = memberByUid_(uid);
  if (!me) return handleBind_(uid, rt, inp, st);

  if (ev.type === 'message' && ['image', 'file', 'video'].indexOf(ev.message.type) >= 0) {
    const item = { id: ev.message.id, type: ev.message.type, name: ev.message.fileName || '' };
    return handleMedia_(me, uid, rt, item, st);
  }
  if (ev.type === 'message' && ev.message.type !== 'text') return reply_(rt, menu_('目前只看得懂文字、照片、影片和檔案（例如 PDF）喔。'));

  const t = inp.text;
  if (/^(取消|算了|重來)$/.test(t)) { clearState_(uid); return reply_(rt, menu_('已取消。')); }
  if (/^(選單|功能|menu|help|\?|？)$/i.test(t)) { clearState_(uid); return reply_(rt, menu_()); }

  const cmd = commandOf_(inp);
  if (cmd) { clearState_(uid); return startCommand_(cmd, me, uid, rt); }

  const doneCode = (inp.data.indexOf('done:') === 0) ? inp.data.slice(5) : ((t.match(/^完成\s*(\S+-\d+|T\d+)$/i) || [])[1]);
  if (doneCode) return completeTask_(doneCode.toUpperCase(), me, rt);
  if (inp.data.indexOf('view:') === 0) return reply_(rt, projectDetail_(inp.data.slice(5)));
  const startCode = (inp.data.indexOf('start:') === 0) ? inp.data.slice(6) : ((t.match(/^開始\s*(\S+-\d+)$/i) || [])[1]);
  if (startCode) return reply_(rt, startTaskLine_(startCode.toUpperCase(), me));
  if (inp.data.indexOf('snz:') === 0) return reply_(rt, snoozeLine_(inp.data.slice(4), me));
  if (inp.data.indexOf('xfer:') === 0) return startTransfer_(uid, rt, me, inp.data.slice(5));
  if (inp.data.indexOf('pa:') === 0 || inp.data.indexOf('pr:') === 0) return approveLine_(uid, rt, me, inp.data.slice(0, 2), inp.data.slice(3));
  if (inp.data.indexOf('pct:') === 0 && !(st && st.flow === 'prog')) {   // 從「我的任務」直接回報單一任務
    const a = inp.data.slice(4).split(':');
    return reply_(rt, progressLine_(a[0], Number(a[1]), me));
  }

  if (st) return continueFlow_(st, inp, me, uid, rt);

  if (t && t.length <= 20 && projectByCode_(t)) return reply_(rt, projectDetail_(projectByCode_(t)['編號']));
  return reply_(rt, menu_('看不懂這句話，可以用下面的功能：'));
}

function parseInput_(ev) {
  const inp = { text: '', data: '', date: '' };
  if (ev.type === 'message' && ev.message.type === 'text') inp.text = String(ev.message.text || '').trim();
  if (ev.type === 'postback') {
    inp.data = ev.postback.data || '';
    inp.date = (ev.postback.params && ev.postback.params.date) || '';
  }
  return inp;
}

const COMMANDS = ['每週更新', '新增任務', '我的任務', '任務進度', '轉派任務', '專案總覽', '新增專案', '使用說明', '意見回饋', '我的回饋', '試驗單'];
function commandOf_(inp) {
  if (inp.data.indexOf('cmd:') === 0) return inp.data.slice(4);
  const t = inp.text.replace(/\s/g, '');
  if (COMMANDS.indexOf(t) >= 0) return t;
  if (t === '更新' || t === '回報進度' || t === '回報') return '每週更新';
  if (t === '總覽') return '專案總覽';
  if (['回報任務進度', '任務進度回報', '完成度', '回報完成度'].indexOf(t) >= 0) return '任務進度';
  if (['轉派', '轉交', '轉派給別人', '換負責人'].indexOf(t) >= 0) return '轉派任務';
  if (t === '說明') return '使用說明';
  if (['新增試驗單', '研究試驗單', '試驗', '開試驗單'].indexOf(t) >= 0) return '試驗單';
  if (['回報問題', '回報錯誤', '錯誤回報', '問題回報', '意見', '建議回饋', '我要建議', '系統問題'].indexOf(t) >= 0) return '意見回饋';
  return '';
}

function startCommand_(cmd, me, uid, rt) {
  switch (cmd) {
    case '每週更新': return askProject_(uid, rt, { flow: 'update', d: {} }, '要更新哪個專案？', me);
    case '新增任務': return askProject_(uid, rt, { flow: 'task', d: {} }, '任務要加在哪個專案？', me);
    case '我的任務': return reply_(rt, myTasks_(me));
    case '任務進度': return reply_(rt, myTasks_(me));   // 完成度改依經過時間推算，不再逐項回報
    case '轉派任務': return startTransfer_(uid, rt, me, '');
    case '專案總覽': return reply_(rt, overview_());
    case '新增專案':
      setState_(uid, { flow: 'proj', step: 'name', d: {} });
      return reply_(rt, txt_('📁 新增專案' + (isAdmin_(me) ? '' : '\n（成員開的專案會送給提案單位的主管核准，核准後才成立）') + '\n\n專案名稱是？', [qMsg_('取消', '取消')]));
    case '使用說明': return reply_(rt, help_());
    case '意見回饋':
      setState_(uid, { flow: 'fb', step: 'type', d: { files: [] } });
      return reply_(rt, txt_('💬 意見回饋\n系統哪裡怪怪的，或希望多什麼功能，都歡迎告訴我們。\n\n要回報哪一種？', fbTypeItems_()));
    case '我的回饋': return reply_(rt, myFeedback_(me));
    case '試驗單': return askProject_(uid, rt, { flow: 'test', d: { files: [] } }, '🧪 要開哪個專案的研究試驗單？', me);
  }
  return reply_(rt, menu_());
}

// ----- 成員綁定 -----
function startBind_(uid, rt) {
  const code = PropertiesService.getScriptProperties().getProperty('BIND_CODE');
  if (code) {
    setState_(uid, { flow: 'bind', step: 'code', d: {} });
    return reply_(rt, txt_('歡迎使用傑克電機專案回報！\n第一次使用請先輸入公司提供的綁定密語：'));
  }
  setState_(uid, { flow: 'bind', step: 'name', d: {} });
  return reply_(rt, txt_('歡迎使用傑克電機專案回報！\n第一次使用請輸入你的名字（請和專案表上的稱呼一致，例如：Lily、王小明）：'));
}

function handleBind_(uid, rt, inp, st) {
  if (!st || st.flow !== 'bind') return startBind_(uid, rt);
  if (st.step === 'code') {
    const code = PropertiesService.getScriptProperties().getProperty('BIND_CODE');
    if (inp.text !== code) return reply_(rt, txt_('密語不正確，請再輸入一次。'));
    setState_(uid, { flow: 'bind', step: 'name', d: {} });
    return reply_(rt, txt_('✅ 密語正確。\n請輸入你的名字（請和專案表上的稱呼一致，例如：Lily、王小明）：'));
  }
  if (st.step === 'name') {
    const name = inp.text.replace(/\s+/g, ' ').trim().slice(0, 20);
    if (!name) return reply_(rt, txt_('請直接輸入你的名字。'));
    setState_(uid, { flow: 'bind', step: 'confirm', d: { name: name } });
    return reply_(rt, txt_('你是「' + name + '」嗎？', [qPost_('對，就是我', 'yes', '對'), qPost_('重新輸入', 'no', '重新輸入')]));
  }
  if (st.step === 'confirm') {
    if (inp.data === 'no' || inp.text === '重新輸入' || inp.text === '不是') {
      setState_(uid, { flow: 'bind', step: 'name', d: {} });
      return reply_(rt, txt_('請重新輸入你的名字：'));
    }
    if (inp.data !== 'yes' && !/^(對|是|yes)/i.test(inp.text)) {
      return reply_(rt, txt_('你是「' + st.d.name + '」嗎？', [qPost_('對，就是我', 'yes', '對'), qPost_('重新輸入', 'no', '重新輸入')]));
    }
    const name = st.d.name;
    let taken = false, first = false;
    withLock_(function () {
      const ex = rows_('M').filter(function (m) { return m['姓名'] === name; })[0];
      if (ex && ex['LINE userId']) { taken = true; return; }
      if (ex) { setCells_('M', ex._row, { 'LINE userId': uid, '綁定時間': nowStr_() }); return; }   // 管理員先在網頁建好的成員：直接綁上
      first = rows_('M').length === 0;
      append_('M', { '姓名': name, 'LINE userId': uid, '角色': first ? '管理員' : '成員', '綁定時間': nowStr_(), '接收提醒': '是' });
    });
    if (taken) {
      clearState_(uid);
      return reply_(rt, txt_('「' + name + '」已經被其他 LINE 帳號綁定了。若要換手機，請管理員在「成員」表刪除舊的那一列再重新綁定。'));
    }
    clearState_(uid);
    return reply_(rt, menu_('✅ 綁定完成，' + name + '！' + (first ? '\n（你是第一位成員，已設為管理員）' : '') + '\n\n之後可以直接用下面的按鈕操作，或輸入「選單」叫出功能。'));
  }
  return startBind_(uid, rt);
}

// ----- 對話流程 -----
function askProject_(uid, rt, st, prompt, me) {
  const all = rows_('P').filter(function (p) { return !isClosed_(p) && !isPending_(p); });
  if (!all.length) { clearState_(uid); return reply_(rt, menu_('目前沒有進行中的專案。')); }
  const ps = all.filter(function (p) { return canFlow_(st.flow, me, p); });
  if (!ps.length) {
    clearState_(uid);
    return reply_(rt, menu_(st.flow === 'task'
      ? '只有專案負責人、參與成員或主管可以新增任務，你目前沒有參與的專案。'
      : '你目前不是任何專案的負責人或參與成員，所以不能' + (st.flow === 'photo' ? '存檔案' : st.flow === 'test' ? '開試驗單' : '更新') + '。如需加入專案，請聯絡主管。'));
  }
  st.step = 'project';
  setState_(uid, st);
  const items = ps.slice(0, 12).map(function (p) {
    const label = p['編號'] + ' ' + p['專案名稱'];
    return qPost_(label, 'pick:' + p['編號'], label);
  });
  items.push(qMsg_('取消', '取消'));
  let text = prompt;
  if (ps.length > 12) text += '\n\n' + ps.map(function (p) { return p['編號'] + ' ' + p['專案名稱']; }).join('\n') + '\n\n（請點選或直接輸入專案編號）';
  return reply_(rt, txt_(text, items));
}

function resolveProject_(inp) {
  let code = '';
  if (inp.data.indexOf('pick:') === 0) code = inp.data.slice(5);
  else code = inp.text.split(/\s+/)[0];
  const ps = rows_('P');
  if (code && projectByCode_(code)) return projectByCode_(code);
  if (inp.data) return null;
  if (inp.text) return ps.filter(function (p) { return p['專案名稱'] === inp.text; })[0] || null;
  return null;
}

function continueFlow_(st, inp, me, uid, rt) {
  const d = st.d || {};
  const key = st.flow + '/' + st.step;

  // 共用：選專案
  if (st.step === 'project') {
    const p = resolveProject_(inp);
    if (!p) return askProject_(uid, rt, st, '找不到這個專案，請從下面選一個：', me);
    if (!canFlow_(st.flow, me, p)) return askProject_(uid, rt, st, '你沒有【' + p['編號'] + '】的權限，請從下面選一個：', me);
    d.pid = p['編號']; d.pname = p['專案名稱'];
    if (st.flow === 'photo') {
      const r = savePhotos_(p, d.ids || [], me);
      clearState_(uid);
      return reply_(rt, txt_('📎 已將 ' + r.saved + ' 個檔案存到【' + p['編號'] + ' ' + p['專案名稱'] + '】' +
        (r.failed ? '\n（' + r.failed + ' 個下載失敗，可能檔案太大或已過期，請重傳）' : '') + '\n' + r.url, menuItems_()));
    }
    if (st.flow === 'update') {
      const mt = metrics_(p);
      const head = '【' + p['編號'] + ' ' + p['專案名稱'] + '】\n' + metricsLine_(mt) + '\n（燈號依進度與日期自動判斷）';
      if (mt.hier) {
        setState_(uid, { flow: 'update', step: 'done', d: d });
        return reply_(rt, txt_(head + '\n\n① 本週完成了什麼？\n（直接打字，可以分好幾行；沒有就按「無」）', noneItems_()));
      }
      setState_(uid, { flow: 'update', step: 'stage', d: d });
      return reply_(rt, txt_(head + '\n\n① 專案階段有變動嗎？' + (typeOf_(p) === '開發' ? '（★ 為審查點）' : ''), stageItems_(p)));
    }
    if (st.flow === 'test') {
      setState_(uid, { flow: 'test', step: 'name', d: d });
      return reply_(rt, txt_('【' + p['編號'] + ' ' + p['專案名稱'] + '】\n🧪 新增研究試驗單（編號自動產生，例如 ' + p['編號'] + '-001）\n\n試驗名稱？例如：耐電壓試驗、局部放電試驗', [qMsg_('取消', '取消')]));
    }
    if (st.flow === 'task') {
      setState_(uid, { flow: 'task', step: 'title', d: d });
      return reply_(rt, txt_('【' + p['編號'] + ' ' + p['專案名稱'] + '】\n要新增什麼任務？（直接打字）', [qMsg_('取消', '取消')]));
    }
  }

  switch (key) {
    // ===== 每週更新 =====
    case 'update/stage': {
      let v = null;
      if (inp.data.indexOf('stage:') === 0) v = inp.data.slice(6);
      else if (/^(不變|沒變|無)$/.test(inp.text)) v = '';
      const sts = stagesOf_(projectByCode_(d.pid));
      if (v && sts.indexOf(v) < 0) v = null;
      else if (v === null && sts.indexOf(inp.text.replace(/★/g, '')) >= 0) v = inp.text.replace(/★/g, '');
      if (v === null) return reply_(rt, txt_('請從按鈕選擇階段，或按「不變」。', stageItems_(projectByCode_(d.pid))));
      d.stage = v;
      setState_(uid, { flow: 'update', step: 'done', d: d });
      return reply_(rt, txt_('② 本週完成了什麼？\n（直接打字，可以分好幾行；沒有就按「無」）', noneItems_()));
    }
    case 'update/done':
    case 'update/next':
    case 'update/blocker': {
      if (!inp.text && inp.data !== 'none') return reply_(rt, txt_('請直接打字回覆，沒有就按「無」。', noneItems_()));
      const v = (inp.data === 'none' || /^(無|沒有|略過|none)$/i.test(inp.text)) ? '' : inp.text;
      if (st.step === 'done') {
        d.done = v; setState_(uid, { flow: 'update', step: 'next', d: d });
        return reply_(rt, txt_('下週計畫？', noneItems_()));
      }
      if (st.step === 'next') {
        d.next = v; setState_(uid, { flow: 'update', step: 'blocker', d: d });
        return reply_(rt, txt_('有卡關或需要主管決策的事嗎？', noneItems_()));
      }
      d.blocker = v;
      clearState_(uid);
      return reply_(rt, saveUpdate_(d, me));
    }

    // ===== 轉派任務 =====
    case 'xfer/task': {
      let code = inp.data.indexOf('xt:') === 0 ? inp.data.slice(3) : normCode_(inp.text);
      return startTransfer_(uid, rt, me, code);
    }
    case 'xfer/who': {
      let to = inp.data.indexOf('xw:') === 0 ? inp.data.slice(3) : inp.text.trim();
      const m = memberByName_(to);
      if (!m) return reply_(rt, txt_('成員表裡找不到「' + to + '」，請從按鈕選，或輸入正確的名字。', transferWhoItems_(d.code, me)));
      clearState_(uid);
      let msg = '';
      withLock_(function () {
        const t = rows_('T').filter(function (x) { return x['編號'] === d.code; })[0];
        if (!t) { msg = '找不到任務 ' + d.code; return; }
        if (!canToggleTask_(me, projectByCode_(t['專案編號']), t)) { msg = '只有任務負責人、專案負責人或主管可以轉派這個任務。'; return; }
        if (t['負責人'] === to) { msg = d.code + ' 的負責人本來就是 ' + to + '。'; return; }
        transferTask_(t, to, me['姓名'], '');
        msg = '↪ 已轉派：' + d.code + ' ' + t['任務'] + '\n' + (t['負責人'] || '未指定') + ' → ' + to + '\n（已用 LINE 通知 ' + to + '）';
      });
      return reply_(rt, txt_(msg, menuItems_()));
    }

    // ===== 回報任務完成度（逐一詢問） =====
    case 'prog/ask': {
      const code = d.codes[d.i];
      let v = null;
      if (inp.data.indexOf('pct:') === 0) { const a = inp.data.slice(4).split(':'); if (a[0] === code) v = Number(a[1]); }
      else if (inp.data === 'skip' || /^(略過|跳過)$/.test(inp.text)) v = -1;
      else if (inp.data === 'stop' || /^(結束|完成回報)$/.test(inp.text)) { d.i = d.codes.length; }
      else { const m = inp.text.match(/^(\d{1,3})\s*%?$/); if (m && Number(m[1]) <= 100) v = Number(m[1]); else if (/^(完成|已完成|做完了)$/.test(inp.text)) v = 100; }
      if (v === null && d.i < d.codes.length) return reply_(rt, progAsk_(d, '請點按鈕選完成度，或輸入 0～100 的數字。'));
      if (v !== null && v >= 0) {
        const t = rows_('T').filter(function (x) { return x['編號'] === code; })[0];
        if (t && canToggleTask_(me, projectByCode_(t['專案編號']), t)) { withLock_(function () { const f = rows_('T').filter(function (x) { return x['編號'] === code; })[0]; if (f) saveProgress_(f, v); }); d.n++; }
      }
      if (v !== null) d.i++;
      if (d.i >= d.codes.length) {
        clearState_(uid);
        return reply_(rt, txt_('✅ 已回報 ' + d.n + ' 項任務的完成度，謝謝！', menuItems_()));
      }
      setState_(uid, { flow: 'prog', step: 'ask', d: d });
      return reply_(rt, progAsk_(d));
    }

    // ===== 新增任務 =====
    case 'task/title': {
      if (!inp.text) return reply_(rt, txt_('請直接打字輸入任務內容。', [qMsg_('取消', '取消')]));
      d.title = inp.text.slice(0, 120);
      const mains = (tree_().byP[d.pid] || []).filter(function (it) { return it.lv === 1; });
      if (mains.length) {
        setState_(uid, { flow: 'task', step: 'parent', d: d });
        return reply_(rt, txt_('要放在哪個主任務底下？\n（選「新的主任務」就是另外開一個主任務）', parentItems_(mains)));
      }
      return askAssignee_(uid, rt, d, me);
    }
    case 'task/parent': {
      const mains = (tree_().byP[d.pid] || []).filter(function (it) { return it.lv === 1; });
      let v = null;
      if (inp.data === 'par:') v = '';
      else if (inp.data.indexOf('par:') === 0) v = inp.data.slice(4);
      else if (inp.text) { const hit = mains.filter(function (it) { return it.t['任務'] === inp.text || it.t['編號'] === normCode_(inp.text); })[0]; if (hit) v = hit.t['編號']; }
      if (v === null || (v && !mains.some(function (it) { return it.t['編號'] === v; }))) return reply_(rt, txt_('請從按鈕選擇主任務：', parentItems_(mains)));
      d.parent = v;
      return askAssignee_(uid, rt, d, me);
    }
    case 'task/assignee': {
      const v = (inp.data.indexOf('who:') === 0) ? inp.data.slice(4) : inp.text.slice(0, 20);
      if (!v) return reply_(rt, txt_('請輸入負責人的名字。'));
      d.assignee = v;
      setState_(uid, { flow: 'task', step: 'due', d: d });
      return reply_(rt, txt_('預定完成日？（點「選擇日期」，或輸入例如 11/15）', [qDate_('📅 選擇日期', 'due'), qPost_('不設定', 'due:none', '不設定完成日')]));
    }
    case 'task/due': {
      let v = null;
      if (inp.date) v = inp.date;
      else if (inp.data === 'due:none' || /^(不設定|無|略過)$/.test(inp.text)) v = '';
      else if (inp.text) v = parseDate_(inp.text);
      if (v === null) return reply_(rt, txt_('看不懂這個日期，請點「選擇日期」或輸入像 11/15 的格式。', [qDate_('📅 選擇日期', 'due'), qPost_('不設定', 'due:none', '不設定完成日')]));
      d.due = v;
      clearState_(uid);
      return reply_(rt, saveTask_(d, me));
    }

    // ===== 研究試驗單 =====
    case 'test/name': {
      if (!inp.text) return reply_(rt, txt_('請直接打字輸入試驗名稱。', [qMsg_('取消', '取消')]));
      d.name = inp.text.slice(0, 80);
      setState_(uid, { flow: 'test', step: 'param', d: d });
      return reply_(rt, txt_('① 試驗條件與參數？\n（例如電壓、時間、溫度、樣品數量，可以分好幾行；有照片或檔案可以直接傳）', noneItems_()));
    }
    case 'test/param':
    case 'test/result': {
      if (!inp.text && inp.data !== 'none') return reply_(rt, txt_('請直接打字回覆，沒有就按「無」。', noneItems_()));
      const v = (inp.data === 'none' || /^(無|沒有|略過)$/.test(inp.text)) ? '' : inp.text.slice(0, 1500);
      if (st.step === 'param') {
        d.param = v; setState_(uid, { flow: 'test', step: 'result', d: d });
        return reply_(rt, txt_('② 試驗結果？（量測數據、觀察到的現象；還沒結果就按「無」）', noneItems_()));
      }
      d.result = v; setState_(uid, { flow: 'test', step: 'judge', d: d });
      return reply_(rt, txt_('③ 判定？', judgeItems_()));
    }
    case 'test/judge': {
      const v = inp.data.indexOf('judge:') === 0 ? inp.data.slice(6) : inp.text;
      if (TEST_RESULTS.indexOf(v) < 0) return reply_(rt, txt_('請選擇判定：', judgeItems_()));
      d.judge = v;
      clearState_(uid);
      const code = saveTest_(d, me);
      return reply_(rt, txt_('✅ 已建立研究試驗單 ' + code + '\n' + d.name + '\n專案：' + d.pid + ' ' + d.pname + '\n判定：' + v +
        ((d.files || []).length ? '\n附件 ' + d.files.length + ' 個' : '') + '\n\n試驗目的或其他內容，可以到網頁儀表板補充。', [qPost_('再開一張', 'cmd:試驗單', '試驗單')].concat(menuItems_())));
    }

    // ===== 意見回饋 =====
    case 'fb/type': {
      let v = inp.data.indexOf('fbt:') === 0 ? inp.data.slice(4) : '';
      if (!v && /錯誤|問題|bug/i.test(inp.text)) v = '錯誤';
      if (!v && /建議|功能|想要/.test(inp.text)) v = '建議';
      if (FB_TYPES.indexOf(v) < 0) return reply_(rt, txt_('請選擇要回報的類型：', fbTypeItems_()));
      d.type = v;
      setState_(uid, { flow: 'fb', step: 'content', d: d });
      return reply_(rt, txt_(v === '錯誤'
        ? '🐞 請描述遇到的問題：\n・在哪個功能（LINE 或網頁、哪個按鈕）\n・做了什麼、出現什麼狀況\n\n有截圖可以先傳，再打字說明。'
        : '💡 請說明你的建議：希望多什麼功能，或哪裡可以更好用。\n\n有參考畫面可以先傳圖片，再打字說明。', [qMsg_('取消', '取消')]));
    }
    case 'fb/content': {
      if (!inp.text) return reply_(rt, txt_('請直接打字說明內容。', [qMsg_('取消', '取消')]));
      clearState_(uid);
      const code = saveFeedback_({ type: d.type, content: inp.text, files: d.files || [] }, me['姓名'], 'LINE');
      return reply_(rt, txt_('✅ 已收到你的' + (d.type === '錯誤' ? '錯誤回報' : '建議') + '（' + code + '），謝謝！\n主管處理後會用 LINE 通知你。' +
        ((d.files || []).length ? '\n附件 ' + d.files.length + ' 個已一起存檔。' : ''), [qPost_('我的回饋', 'cmd:我的回饋', '我的回饋')].concat(menuItems_())));
    }

    // ===== 專案退回原因（核准人） =====
    case 'prej/reason': {
      if (!inp.text) return reply_(rt, txt_('請輸入退回原因。', [qMsg_('取消', '取消')]));
      clearState_(uid);
      let msg = '';
      withLock_(function () {
        const p = projectByCode_(d.code);
        if (!p || p['核准狀態'] !== '待核准') { msg = d.code + ' 已經不是待核准狀態了。'; return; }
        if (!canApprove_(me, p)) { msg = '你不是 ' + d.code + ' 的核准人。'; return; }
        rejectProject_(p, me, inp.text.slice(0, 200));
        msg = '↩ 已退回 ' + d.code + '，已通知申請人。';
      });
      return reply_(rt, menu_(msg));
    }

    // ===== 新增專案 =====
    case 'proj/name': {
      if (!inp.text) return reply_(rt, txt_('請輸入專案名稱。', [qMsg_('取消', '取消')]));
      if (rows_('P').some(function (p) { return p['專案名稱'] === inp.text; })) return reply_(rt, txt_('已經有同名的專案了，請換個名稱。', [qMsg_('取消', '取消')]));
      d.name = inp.text.slice(0, 80);
      setState_(uid, { flow: 'proj', step: 'code', d: d });
      return reply_(rt, txt_('哪個單位提案？\n選單位後會自動編號（JK-單位-年度流水號，例如 JK-HV-2601）；也可以直接輸入完整編號。' + deptListText_(), deptItems_()));
    }
    case 'proj/code': {
      let v = '';
      if (inp.data.indexOf('dept:') === 0 && depts_()[inp.data.slice(5)]) {
        const k = inp.data.slice(5);
        if (deptKids_(k).length) return reply_(rt, txt_(depts_()[k] + '的哪個單位提案？\n（整個部門的案子請選「部門案」）', deptKidItems_(k)));
        d.dept = k;
      }
      else if (inp.data.indexOf('deptx:') === 0 && depts_()[inp.data.slice(6)]) d.dept = inp.data.slice(6);
      else if (depts_()[normCode_(inp.text)]) d.dept = normCode_(inp.text);
      else {
        v = normCode_(inp.text);
        const err = v ? checkProjectCode_(v) : '請選擇單位，或直接輸入案件編號。';
        if (err) return reply_(rt, txt_('⚠ ' + err, deptItems_()));
        d.dept = deptOfCode_(v);
      }
      d.code = v;
      setState_(uid, { flow: 'proj', step: 'type', d: d });
      return reply_(rt, txt_('案件編號：' + (v || nextProjectCode_(d.dept) + '（儲存時確定）') + '\n\n專案類型？\n開發類：開發提案→可行性評估★→設計→設計審查★→樣品試作→設計驗證★→文件整理及發行→產品確認★\n管理類：啟動→文件建立→導入運行→內部稽核→驗證',
        [qPost_('開發類', 'type:開發', '開發類'), qPost_('管理類', 'type:管理', '管理類'), qMsg_('取消', '取消')]));
    }
    case 'proj/type': {
      const v = inp.data.indexOf('type:') === 0 ? inp.data.slice(5) : inp.text.replace(/類$/, '');
      if (!TYPES[v]) return reply_(rt, txt_('請選擇專案類型：', [qPost_('開發類', 'type:開發', '開發類'), qPost_('管理類', 'type:管理', '管理類')]));
      d.type = v;
      setState_(uid, { flow: 'proj', step: 'goal', d: d });
      return reply_(rt, txt_('專案目的與預期成果？（可略過）', [qPost_('略過', 'skip', '略過')]));
    }
    case 'proj/goal': {
      d.goal = (inp.data === 'skip' || /^(略過|無)$/.test(inp.text)) ? '' : inp.text.slice(0, 600);
      setState_(uid, { flow: 'proj', step: 'owner', d: d });
      return reply_(rt, txt_('負責人是誰？', [qPost_('我自己', 'who:' + me['姓名'], '負責人：我自己')]));
    }
    case 'proj/owner': {
      const v = (inp.data.indexOf('who:') === 0) ? inp.data.slice(4) : inp.text.slice(0, 20);
      if (!v) return reply_(rt, txt_('請輸入負責人的名字。'));
      d.owner = v;
      setState_(uid, { flow: 'proj', step: 'members', d: d });
      return reply_(rt, txt_('參與成員？（用頓號分隔，例如：Kevin、Jay；可略過）', [qPost_('略過', 'skip', '略過')]));
    }
    case 'proj/members': {
      d.members = (inp.data === 'skip' || /^(略過|無)$/.test(inp.text)) ? '' : splitNames_(inp.text).join('、');
      setState_(uid, { flow: 'proj', step: 'due', d: d });
      return reply_(rt, txt_('預計完成（截止）日？', [qDate_('📅 選擇日期', 'due'), qPost_('不設定', 'due:none', '不設定截止日')]));
    }
    case 'proj/due': {
      let v = null;
      if (inp.date) v = inp.date;
      else if (inp.data === 'due:none' || /^(不設定|無|略過)$/.test(inp.text)) v = '';
      else if (inp.text) v = parseDate_(inp.text);
      if (v === null) return reply_(rt, txt_('看不懂這個日期，請點「選擇日期」或輸入像 12/31 的格式。', [qDate_('📅 選擇日期', 'due'), qPost_('不設定', 'due:none', '不設定截止日')]));
      d.due = v;
      clearState_(uid);
      return reply_(rt, saveProject_(d, me));
    }
  }
  clearState_(uid);
  return reply_(rt, menu_());
}

// ----- 照片、影片、檔案（PDF 等） -----
function handleMedia_(me, uid, rt, item, st) {
  if (st && st.flow === 'fb') {
    const url = saveFbFile_(item, me);
    if (!url) return reply_(rt, txt_('⚠ 檔案下載失敗，請重傳一次。'));
    st.d.files = (st.d.files || []).concat([url]);
    setState_(uid, st);
    return reply_(rt, txt_('📎 已附上（' + st.d.files.length + ' 個）。' + (st.step === 'type' ? '請先選擇類型：' : '請繼續打字說明。'), st.step === 'type' ? fbTypeItems_() : [qMsg_('取消', '取消')]));
  }
  if (st && st.flow === 'test' && st.d && st.d.pid) {
    const r = savePhotos_(projectByCode_(st.d.pid), [item], me);
    if (!r.saved) return reply_(rt, txt_('⚠ 檔案下載失敗，請重傳一次。'));
    st.d.files = (st.d.files || []).concat(r.urls);
    setState_(uid, st);
    return reply_(rt, txt_('📎 已附上（' + st.d.files.length + ' 個），請繼續剛才的步驟。'));
  }
  if (st && st.d && st.d.pid && (st.flow === 'update' || st.flow === 'task')) {
    const p = projectByCode_(st.d.pid);
    const r = savePhotos_(p, [item], me);
    return reply_(rt, txt_((r.saved ? '📎 已存到【' + p['編號'] + '】' : '⚠ 檔案下載失敗，請稍後重傳') + '，請繼續剛才的步驟。'));
  }
  if (st && st.flow === 'photo' && st.step === 'project') {   // 一次傳多個：累積起來，不重複詢問
    st.d.ids.push(item);
    setState_(uid, st);
    return;
  }
  return askProject_(uid, rt, { flow: 'photo', d: { ids: [item] } }, '📎 要存到哪個專案？\n（一次傳多張照片或多個檔案會一起存）', me);
}

function savePhotos_(p, items, me) {
  ensureHead_('F');
  const folder = projectFolder_(p);
  const stamp = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyyMMdd_HHmmss');
  let saved = 0, failed = 0;
  const urls = [];
  items.forEach(function (it, i) {
    if (typeof it === 'string') it = { id: it, type: 'image', name: '' };
    const res = UrlFetchApp.fetch('https://api-data.line.me/v2/bot/message/' + it.id + '/content', {
      headers: { Authorization: 'Bearer ' + token_() }, muteHttpExceptions: true
    });
    if (res.getResponseCode() !== 200) { failed++; console.error('檔案下載失敗', it.id, res.getContentText()); return; }
    const ext = it.type === 'video' ? '.mp4' : '.jpg';
    const name = it.name ? p['編號'] + '_' + stamp.slice(0, 8) + '_' + it.name : p['編號'] + '_' + stamp + '_' + (i + 1) + ext;
    const file = folder.createFile(res.getBlob().setName(name));
    append_('F', { '時間': nowStr_(), '專案編號': p['編號'], '上傳人': me['姓名'], '檔案連結': file.getUrl(), '檔名': name, '分類': it.type === 'file' ? '其他' : '照片' });
    urls.push(file.getUrl());
    saved++;
  });
  return { url: folder.getUrl(), saved: saved, failed: failed, urls: urls };
}

function childFolder_(name) {
  const root = DriveApp.getFolderById(PropertiesService.getScriptProperties().getProperty('PHOTO_FOLDER_ID'));
  const it = root.getFoldersByName(name);
  return it.hasNext() ? it.next() : root.createFolder(name);
}
function saveFbFile_(it, me) {
  const res = UrlFetchApp.fetch('https://api-data.line.me/v2/bot/message/' + it.id + '/content', {
    headers: { Authorization: 'Bearer ' + token_() }, muteHttpExceptions: true
  });
  if (res.getResponseCode() !== 200) { console.error('回饋附件下載失敗', it.id, res.getContentText()); return ''; }
  const stamp = Utilities.formatDate(new Date(), tz_(), 'yyyyMMdd_HHmmss');
  const name = '回饋_' + stamp + '_' + me['姓名'] + '_' + (it.name || (it.type === 'video' ? 'video.mp4' : 'image.jpg'));
  return childFolder_('意見回饋附件').createFile(res.getBlob().setName(name)).getUrl();
}

// =====================================================================
// 意見回饋（錯誤回報、功能建議）
// =====================================================================
function saveFeedback_(d, byName, source) {
  let code;
  withLock_(function () {
    ensureHead_('R');
    code = nextCode_('R', 'R', 3);
    append_('R', {
      '編號': code, '時間': nowStr_(), '類型': d.type, '提出人': byName, '來源': source,
      '內容': String(d.content).slice(0, 1500), '附件': (d.files || []).join('\n'), '狀態': '待處理', '處理回覆': '', '處理人': '', '處理時間': ''
    });
  });
  const msg = '💬 新的' + (d.type === '錯誤' ? '錯誤回報' : '建議') + ' ' + code + '\n提出人：' + byName + '（' + source + '）\n\n' + cut_(d.content, 800) +
    ((d.files || []).length ? '\n\n📎 附件 ' + d.files.length + ' 個' : '') + '\n\n請到儀表板「意見回饋」分頁處理。';
  rows_('M').filter(function (m) { return isAdmin_(m) && m['姓名'] !== byName && m['接收提醒'] !== '否' && m['LINE userId']; })
    .forEach(function (m) { pushLater_(m['LINE userId'], txt_(msg)); });
  return code;
}

function myFeedback_(me) {
  const fs = rows_('R').filter(function (f) { return f['提出人'] === me['姓名']; }).slice(-5).reverse();
  if (!fs.length) return txt_('你還沒有回報過意見。', [qPost_('💬 意見回饋', 'cmd:意見回饋', '意見回饋')].concat(menuItems_()));
  const L = ['💬 我的意見回饋（最近 ' + fs.length + ' 筆）'];
  fs.forEach(function (f) {
    L.push('\n' + f['編號'] + '［' + f['類型'] + '］' + (f['狀態'] || '待處理') + '\n' + cut_(f['內容'], 60) + (f['處理回覆'] ? '\n↳ ' + f['處理人'] + '：' + cut_(f['處理回覆'], 120) : ''));
  });
  return txt_(L.join('\n'), menuItems_());
}

function projectFolder_(p) {
  const root = DriveApp.getFolderById(PropertiesService.getScriptProperties().getProperty('PHOTO_FOLDER_ID'));
  const it = root.getFolders();
  while (it.hasNext()) {
    const f = it.next();
    if (f.getName().indexOf(p['編號'] + ' ') === 0) return f;
  }
  return root.createFolder(p['編號'] + ' ' + p['專案名稱']);
}

// =====================================================================
// 四、寫入資料
// =====================================================================
function saveUpdate_(d, me) {
  if (!d.done && !d.next && !d.blocker) return menu_('三項都是「無」，這次沒有存檔。');
  let p, stage;
  withLock_(function () {
    p = projectByCode_(d.pid);
    stage = d.stage || curStage_(p);
    d.status = metrics_(p).light;
    append_('U', {
      '時間': nowStr_(), '專案編號': d.pid, '填寫人': me['姓名'], '燈號': d.status, '階段': stage,
      '本週完成': d.done, '下週計畫': d.next, '卡關事項': d.blocker
    });
    setCells_('P', p._row, Object.assign({ '燈號': d.status, '階段': stage, '卡關事項': d.blocker, '最近更新': nowStr_() }, autoDates_(p, stage)));
  });
  const lines = ['✅ 已存檔：' + d.pid + ' ' + p['專案名稱'],
    '燈號：' + LIGHT_ICON[d.status] + d.status + '　階段：' + stage];
  if (d.done) lines.push('\n【本週完成】\n' + d.done);
  if (d.next) lines.push('\n【下週計畫】\n' + d.next);
  if (d.blocker) lines.push('\n【卡關】\n' + d.blocker);
  return txt_(lines.join('\n'), [qPost_('看 ' + d.pid + ' 詳情', 'view:' + d.pid, d.pid)].concat(menuItems_()));
}

function saveTask_(d, me) {
  let code;
  withLock_(function () {
    ensureHead_('T');
    const start = d.due && d.due < todayStr_() ? d.due : todayStr_();
    code = insertTask_(d.pid, d.parent || '', {
      '專案編號': d.pid, '任務': d.title, '負責人': d.assignee, '完成日': d.due,
      '狀態': '未完成', '完成時間': '', '建立人': me['姓名'], '建立時間': nowStr_(), '開始日': start, '權重': '1'
    });
  });
  const msg = '✅ 已新增任務 ' + code + '\n' + d.title + '\n專案：' + d.pid + ' ' + d.pname + '\n負責人：' + d.assignee + (d.due ? '\n完成日：' + d.due : '');
  notifyAssignee_(me['姓名'], code, d);
  return txt_(msg, [qPost_('再新增一個', 'cmd:新增任務', '新增任務')].concat(menuItems_()));
}

function notifyAssignee_(byName, code, d) {
  if (!CONFIG.NOTIFY_ASSIGNEE || !d.assignee || d.assignee === byName) return;
  const m = memberByName_(d.assignee);
  if (!m || m['接收提醒'] === '否') return;
  pushLater_(m['LINE userId'], txt_('📌 ' + byName + ' 指派了一個任務給你\n\n' + code + ' ' + d.title + '\n專案：' + d.pid + ' ' + d.pname + (d.due ? '\n完成日：' + d.due : ''),
    [qPost_('我的任務', 'cmd:我的任務', '我的任務')]));
}

function saveProject_(d, me) {
  let code, obj = {};
  withLock_(function () {
    ensureHead_('P');
    code = d.code || (d.dept ? nextProjectCode_(d.dept) : nextCode_('P', 'P', 2));
    if (d.code && checkProjectCode_(code)) { code = ''; return; }
    obj = {
      '編號': code, '專案名稱': d.name, '目的與預期成果': d.goal, '負責人': d.owner, '參與成員': d.members,
      '階段': TYPES[d.type || '開發'][0], '燈號': '正常', '開始日': todayStr_(), '截止日': d.due, '卡關事項': '', '建立時間': nowStr_(), '最近更新': '',
      '類型': d.type || '開發', '部門': d.dept || deptOfCode_(code)
    };
    if (!isAdmin_(me)) { obj['核准狀態'] = '待核准'; obj['申請人'] = me['姓名']; }
    append_('P', obj);
  });
  if (!code) return menu_('⚠ 專案編號「' + d.code + '」剛剛被別人用掉了，請重新「新增專案」換一個編號。');
  if (obj['核准狀態'] === '待核准') {
    const who = notifyApprovers_(obj, false);
    return txt_('📝 已送出專案申請 ' + code + '\n' + d.name + '\n\n等待 ' + (who.join('、') || '管理員') + ' 核准，核准後會用 LINE 通知你，之後就可以新增任務。', menuItems_());
  }
  return txt_('✅ 已建立專案 ' + code + '\n' + d.name + '\n負責人：' + d.owner + (d.members ? '\n成員：' + d.members : '') + (d.due ? '\n截止日：' + d.due : '') +
    '\n\n接著可以幫它新增任務。', [qPost_('新增任務', 'cmd:新增任務', '新增任務')].concat(menuItems_()));
}

function completeTask_(code, me, rt) {
  const t = rows_('T').filter(function (x) { return x['編號'] === code; })[0];
  if (!t) return reply_(rt, txt_('找不到任務 ' + code + '。輸入「我的任務」可以看到自己的任務編號。'));
  if (t['狀態'] === '已完成') return reply_(rt, txt_(code + ' 已經是完成狀態了。', menuItems_()));
  if (isContainer_(t)) return reply_(rt, txt_(code + ' 是主任務，底下的子任務全部完成後會自動完成。', menuItems_()));
  if (!canToggleTask_(me, projectByCode_(t['專案編號']), t)) return reply_(rt, txt_('只有任務負責人、專案負責人或主管可以標記 ' + code + '。', menuItems_()));
  withLock_(function () {
    const fresh = rows_('T').filter(function (x) { return x['編號'] === code; })[0];
    if (fresh) taskDone_(fresh);
  });
  const left = rows_('T').filter(function (x) { return x['負責人'] === me['姓名'] && x['狀態'] !== '已完成'; }).length;
  return reply_(rt, txt_('✅ 完成：' + code + ' ' + t['任務'] + '\n（' + me['姓名'] + ' 還有 ' + left + ' 項未完成）', menuItems_()));
}

// =====================================================================
// 五、查詢內容
// =====================================================================
function myTasks_(me) {
  const today = todayStr_();
  const ts = rows_('T').filter(function (t) { return t['負責人'] === me['姓名'] && t['狀態'] !== '已完成' && !isContainer_(t); })
    .sort(function (a, b) { return (a['完成日'] || '9999') < (b['完成日'] || '9999') ? -1 : 1; });
  if (!ts.length) return txt_('目前沒有未完成的任務 👍', menuItems_());
  const lines = ['📋 ' + me['姓名'] + ' 的未完成任務（' + ts.length + '）'];
  ts.forEach(function (t) {
    lines.push('\n' + t['編號'] + ' ' + t['任務'] + '\n　' + t['專案編號'] + '｜' + taskStateText_(t, today) + dueNote_(t['完成日'], today));
  });
  lines.push('\n點下方按鈕：未開始的任務按「▶ 開始」，做完按「✅ 完成」；完成度依經過時間自動推算。');
  const items = [];
  ts.forEach(function (t) {
    if (items.length >= 11) return;
    if (!t['實際開始日']) items.push(qPost_('▶ 開始 ' + t['任務'], 'start:' + t['編號'], '開始 ' + t['編號']));
    else items.push(qPost_('✅ 完成 ' + t['任務'], 'done:' + t['編號'], '完成 ' + t['編號']));
  });
  items.push(qPost_('↪ 轉派任務', 'cmd:轉派任務', '轉派任務'));
  return txt_(lines.join('\n'), items);
}
// ----- 轉派任務 -----
/** 換負責人：寫入、記在變更紀錄、通知新舊負責人（推播在回覆之後送） */
function transferTask_(t, to, byName, note) {
  const from = t['負責人'] || '';
  setCells_('T', t._row, { '負責人': to });
  logChange_(t['專案編號'], t['編號'], '轉派負責人', from || '未指定', to, note || '', byName);
  notifyTransfer_(t, from, to, byName, note);
}
function notifyTransfer_(t, from, to, byName, note) {
  if (!CONFIG.NOTIFY_ASSIGNEE) return;
  const p = projectByCode_(t['專案編號']) || {};
  const head = t['編號'] + ' ' + t['任務'] + '\n專案：' + t['專案編號'] + ' ' + (p['專案名稱'] || '') + (t['完成日'] ? '\n完成日：' + t['完成日'] : '') + (note ? '\n說明：' + note : '');
  const nm = memberByName_(to);
  if (nm && to !== byName && nm['接收提醒'] !== '否' && nm['LINE userId'])
    pushLater_(nm['LINE userId'], txt_('📌 ' + byName + ' 把任務轉派給你' + (from && from !== byName ? '（原負責人：' + from + '）' : '') + '\n\n' + head,
      [qPost_('▶ 開始', 'start:' + t['編號'], '開始 ' + t['編號']), qPost_('↪ 再轉派', 'xfer:' + t['編號'], '轉派 ' + t['編號']), qPost_('我的任務', 'cmd:我的任務', '我的任務')]));
  const om = from ? memberByName_(from) : null;
  if (om && from !== byName && from !== to && om['接收提醒'] !== '否' && om['LINE userId'])
    pushLater_(om['LINE userId'], txt_('↪ ' + byName + ' 已把你的任務轉給 ' + to + '\n\n' + head));
}
/** LINE：轉派流程（code 空白＝先選任務） */
function startTransfer_(uid, rt, me, code) {
  if (!code) {
    const ts = rows_('T').filter(function (t) { return t['負責人'] === me['姓名'] && t['狀態'] !== '已完成' && !isContainer_(t); }).slice(0, 12);
    if (!ts.length) { clearState_(uid); return reply_(rt, txt_('你目前沒有未完成的任務可以轉派。\n（主管或專案負責人也可以在網頁的任務清單按「↪ 轉派」）', menuItems_())); }
    setState_(uid, { flow: 'xfer', step: 'task', d: {} });
    return reply_(rt, txt_('↪ 要轉派哪一個任務？\n' + ts.map(function (t) { return t['編號'] + ' ' + t['任務']; }).join('\n') + '\n\n（點選，或輸入任務編號）',
      ts.map(function (t) { return qPost_(t['任務'], 'xt:' + t['編號'], '轉派 ' + t['編號']); }).concat([qMsg_('取消', '取消')])));
  }
  const t = rows_('T').filter(function (x) { return x['編號'] === code; })[0];
  if (!t) { clearState_(uid); return reply_(rt, txt_('找不到任務 ' + code + '。', menuItems_())); }
  if (isContainer_(t)) { clearState_(uid); return reply_(rt, txt_(code + ' 是主任務，請轉派底下的子任務。', menuItems_())); }
  if (t['狀態'] === '已完成') { clearState_(uid); return reply_(rt, txt_(code + ' 已經完成了。', menuItems_())); }
  if (!canToggleTask_(me, projectByCode_(t['專案編號']), t)) { clearState_(uid); return reply_(rt, txt_('只有任務負責人、專案負責人或主管可以轉派 ' + code + '。', menuItems_())); }
  setState_(uid, { flow: 'xfer', step: 'who', d: { code: code } });
  return reply_(rt, txt_('↪ ' + code + ' ' + t['任務'] + '\n目前負責人：' + (t['負責人'] || '未指定') + '\n\n要轉給誰？（點選，或輸入名字）', transferWhoItems_(code, me)));
}
function transferWhoItems_(code, me) {
  const t = rows_('T').filter(function (x) { return x['編號'] === code; })[0] || {}, p = projectByCode_(t['專案編號']) || {};
  const first = uniq_([p['負責人']].concat(splitNames_(p['參與成員'])));
  const names = uniq_(first.concat(rows_('M').map(function (m) { return m['姓名']; })))
    .filter(function (n) { return n && n !== t['負責人'] && memberByName_(n); }).slice(0, 12);
  return names.map(function (n) { return qPost_(n, 'xw:' + n, '轉給 ' + n); }).concat([qMsg_('取消', '取消')]);
}

/** 任務狀態文字：未開始／進行中 50% */
function taskStateText_(t, today) {
  if (t['狀態'] === '已完成') return '已完成';
  if (!t['實際開始日']) {
    const ps = t['開始日'] || String(t['建立時間'] || '').slice(0, 10);
    return ps && ps < today ? '⚠ 應開始未開始（預定 ' + shortDate_(ps) + '）' : '未開始' + (ps ? '（預定 ' + shortDate_(ps) + ' 開始）' : '');
  }
  const it = itemOf_(t), f = it ? fracs_(it, dnum_(today)) : null;
  return '進行中' + (f ? '（依經過時間推算 ' + Math.round(f[1] * 1000) / 10 + '%）' : '');
}

// ----- 開始任務、回報完成度、延後提醒 -----
/** 記錄實際開始日（不覆蓋已有的）；專案還沒開案時一起補上實際開案日 */
function startTask_(t, dateStr) {
  const d = dateStr || todayStr_();
  if (!t['實際開始日']) setCells_('T', t._row, { '實際開始日': d, '提醒延後至': '' });
  const p = projectByCode_(t['專案編號']);
  if (p && !p['實際開案日']) setCells_('P', p._row, { '實際開案日': d });
}
/** 回報完成度：100＝完成；大於 0 時自動補實際開始日 */
function saveProgress_(t, pct) {
  pct = Math.max(0, Math.min(100, Math.round(Number(pct) || 0)));
  ensureHead_('T');
  if (pct >= 100) { setCells_('T', t._row, { '完成度': '100', '進度回報日': todayStr_() }); taskDone_(t); return; }
  setCells_('T', t._row, { '完成度': String(pct), '進度回報日': todayStr_() });
  if (pct > 0 && !t['實際開始日']) startTask_(t);
}
function findTaskFor_(code, me) {
  const t = rows_('T').filter(function (x) { return x['編號'] === code; })[0];
  if (!t) return { err: '找不到任務 ' + code + '。輸入「我的任務」可以看到自己的任務編號。' };
  if (isContainer_(t)) return { err: code + ' 是主任務，請在底下的子任務操作。' };
  if (!canToggleTask_(me, projectByCode_(t['專案編號']), t)) return { err: '只有任務負責人、專案負責人或主管可以操作 ' + code + '。' };
  return { t: t };
}
function startTaskLine_(code, me) {
  const r = findTaskFor_(code, me);
  if (r.err) return txt_(r.err, menuItems_());
  if (r.t['狀態'] === '已完成') return txt_(code + ' 已經完成了。', menuItems_());
  if (r.t['實際開始日']) return txt_(code + ' 已在 ' + r.t['實際開始日'] + ' 開始。', menuItems_());
  withLock_(function () { ensureHead_('T'); const f = rows_('T').filter(function (x) { return x['編號'] === code; })[0]; if (f) startTask_(f); });
  return txt_('▶ 已開始：' + code + ' ' + r.t['任務'] + '\n實際開始日：' + todayStr_() + '\n\n完成度會依經過時間自動推算，做完時記得按「完成」。', menuItems_());
}
function progressLine_(code, pct, me) {
  const r = findTaskFor_(code, me);
  if (r.err) return txt_(r.err, menuItems_());
  withLock_(function () { const f = rows_('T').filter(function (x) { return x['編號'] === code; })[0]; if (f) saveProgress_(f, pct); });
  return txt_((pct >= 100 ? '✅ 已完成：' : '📊 已回報 ' + pct + '%：') + code + ' ' + r.t['任務'], menuItems_());
}
/** snz:代碼,代碼:天數 → 這段期間不再提醒「應開始未開始」 */
function snoozeLine_(arg, me) {
  const a = arg.split(':'), days = Math.max(1, Math.min(30, Number(a[1]) || 3)), until = addDays_(todayStr_(), days);
  const done = [];
  withLock_(function () {
    ensureHead_('T');
    a[0].split(',').forEach(function (code) {
      const r = findTaskFor_(code, me);
      if (!r.err && !r.t['實際開始日']) { setCells_('T', r.t._row, { '提醒延後至': until }); done.push(code); }
    });
  });
  return txt_(done.length ? '⏸ 已延後提醒到 ' + shortDate_(until) + '：' + done.join('、') + '\n（預定日期不變，甘特圖仍會標示「應開始未開始」）' : '沒有需要延後的任務。', menuItems_());
}
function pct1_(v) { return v === null || v === undefined ? '—' : Number(v).toFixed(1) + '%'; }
function addDays_(s, n) { return new Date(Date.parse(s + 'T00:00:00Z') + n * 86400000).toISOString().slice(0, 10); }
/** LINE：逐一回報自己進行中任務的完成度 */
function startProgress_(uid, rt, me) {
  const ts = rows_('T').filter(function (t) { return t['負責人'] === me['姓名'] && t['狀態'] !== '已完成' && !isContainer_(t); })
    .sort(function (a, b) { return (a['實際開始日'] ? 0 : 1) - (b['實際開始日'] ? 0 : 1) || ((a['完成日'] || '9999') < (b['完成日'] || '9999') ? -1 : 1); }).slice(0, 15);
  if (!ts.length) return reply_(rt, txt_('目前沒有未完成的任務 👍', menuItems_()));
  const d = { codes: ts.map(function (t) { return t['編號']; }), i: 0, n: 0 };
  setState_(uid, { flow: 'prog', step: 'ask', d: d });
  return reply_(rt, progAsk_(d, '📊 回報任務完成度（共 ' + ts.length + ' 項，一次一項）'));
}
function progAsk_(d, head) {
  const code = d.codes[d.i], t = rows_('T').filter(function (x) { return x['編號'] === code; })[0] || {};
  const today = todayStr_();
  const text = (head ? head + '\n\n' : '') + '（' + (d.i + 1) + '/' + d.codes.length + '）' + code + ' ' + (t['任務'] || '') +
    '\n　' + (t['專案編號'] || '') + '｜' + taskStateText_(t, today) + dueNote_(t['完成日'], today) + '\n\n目前完成多少？';
  const items = PCT_STEPS.map(function (v) { return qPost_(v >= 100 ? '✅ 完成' : v + '%', 'pct:' + code + ':' + v, code + ' ' + (v >= 100 ? '完成' : v + '%')); });
  items.push(qPost_('略過', 'skip', '略過'), qPost_('結束', 'stop', '結束回報'));
  return txt_(text, items);
}

function overview_() {
  const today = todayStr_();
  const ps = rows_('P').filter(function (p) { return !isPending_(p); }), ts = rows_('T');
  if (!ps.length) return txt_('目前還沒有專案。', menuItems_());
  const lines = ['📊 專案總覽（' + today + '）'];
  ps.forEach(function (p) {
    const mt = metrics_(p);
    lines.push('\n' + (LIGHT_ICON[mt.light] || '⚪') + ' ' + p['編號'] + ' ' + p['專案名稱'] +
      '\n　' + (p['負責人'] || '未指定') + '｜' + (typeOf_(p) !== '開發' ? '[' + typeOf_(p) + '] ' : '') + mt.stage + '(' + (mt.stageIdx + 1) + '/' + mt.stages.length + ')｜任務 ' + mt.done + '/' + mt.count +
      (mt.planned !== null ? '\n　進度 預定 ' + pct1_(mt.planned) + '／實際 ' + pct1_(mt.actual) : '') +
      (p['截止日'] ? '\n　預定結案 ' + shortDate_(p['截止日']) + (!mt.closed && p['截止日'] < today ? ' ⚠逾期' + daysBetween_(p['截止日'], today) + '天' : '') : '') +
      '\n　最近更新 ' + (p['最近更新'] ? shortDate_(p['最近更新'].slice(0, 10)) : '尚無') +
      (p['卡關事項'] ? '\n　卡關：' + p['卡關事項'] : ''));
  });
  lines.push('\n輸入專案編號（例如 JK-HV-2601）可看詳情。');
  const items = ps.filter(function (p) { return !isClosed_(p); }).slice(0, 13)
    .map(function (p) { return qPost_(p['編號'] + ' ' + p['專案名稱'], 'view:' + p['編號'], p['編號']); });
  return txt_(lines.join('\n'), items);
}

function projectDetail_(code) {
  const p = projectByCode_(code);
  if (!p) return txt_('找不到專案 ' + code + '。', menuItems_());
  const today = todayStr_();
  const ts = rows_('T').filter(function (t) { return t['專案編號'] === p['編號'] && !isContainer_(t); });
  const open = ts.filter(function (t) { return t['狀態'] !== '已完成'; });
  const mt = metrics_(p);
  const ups = rows_('U').filter(function (u) { return u['專案編號'] === code; }).slice(-3).reverse();
  const photos = rows_('F').filter(function (f) { return f['專案編號'] === code; });
  const L = [(LIGHT_ICON[mt.light] || '') + ' ' + p['編號'] + ' ' + p['專案名稱']];
  if (p['目的與預期成果']) L.push(p['目的與預期成果']);
  L.push('\n負責人：' + (p['負責人'] || '未指定') + (p['參與成員'] ? '\n成員：' + p['參與成員'] : ''));
  L.push((depts_()[p['部門']] ? '單位：' + depts_()[p['部門']] + '　' : '') + '類型：' + typeOf_(p) + '類\n' + metricsLine_(mt));
  if (p['產品規格']) L.push('產品規格：' + p['產品規格']);
  L.push('期間：' + (p['開始日'] || '?') + ' → ' + (p['截止日'] || '未定'));
  if (p['基準鎖定日']) L.push('基準結案：' + (p['基準結案日'] || '未定') + (mt.slip ? '（目前' + (mt.slip > 0 ? '延後 ' + mt.slip : '提前 ' + (-mt.slip)) + ' 天）' : ''));
  if (p['卡關事項']) L.push('⚠ 卡關：' + p['卡關事項']);
  L.push('\n【未完成任務 ' + open.length + '/' + ts.length + '】');
  if (!open.length) L.push('（無）');
  open.forEach(function (t) { L.push(t['編號'] + ' ' + t['任務'] + '｜' + (t['負責人'] || '未指定') + dueNote_(t['完成日'], today)); });
  L.push('\n【最近更新】');
  if (!ups.length) L.push('（尚無）');
  ups.forEach(function (u) {
    L.push('\n' + u['時間'].slice(0, 10) + ' ' + u['填寫人'] + ' ' + (LIGHT_ICON[u['燈號']] || ''));
    if (u['本週完成']) L.push('完成：' + u['本週完成']);
    if (u['下週計畫']) L.push('計畫：' + u['下週計畫']);
    if (u['卡關事項']) L.push('卡關：' + u['卡關事項']);
  });
  const tests = rows_('E').filter(function (e) { return e['專案編號'] === code; });
  if (tests.length) {
    L.push('\n【研究試驗單 ' + tests.length + ' 份】');
    tests.slice(-3).reverse().forEach(function (e) { L.push(e['試驗單編號'] + ' ' + e['試驗名稱'] + '｜' + e['判定'] + '｜' + e['試驗日期']); });
  }
  if (photos.length) L.push('\n📎 照片與檔案 ' + photos.length + ' 個\n' + projectFolder_(p).getUrl());
  return txt_(L.join('\n'), [qPost_('更新這個專案', 'cmd:每週更新', '每週更新')].concat(menuItems_()));
}

function help_() {
  return txt_([
    '📖 使用說明',
    '',
    '【每週更新】選專案 →（階段）→ 本週完成 → 下週計畫 → 卡關；燈號依進度與日期自動判斷',
    '【新增任務】選專案 → 任務內容 → 主任務 → 負責人 → 預定完成日',
    '【我的任務】看自己未完成的任務；未開始的按「▶ 開始」，做完按「✅ 完成」（完成度依經過時間自動推算）',
    '【轉派任務】把自己的任務轉給別人（例如主管轉給部屬），對方會收到 LINE 通知',
    '【專案總覽】所有專案的燈號、階段、任務與逾期狀況',
    '【新增專案】名稱 → 單位（自動編號 JK-HV-2601）→ 類型 → 目的 → 負責人 → 成員 → 截止日（成員開的專案要由提案單位主管核准）',
    '【試驗單】選專案 → 試驗名稱 → 條件與參數 → 結果 → 判定，可附照片；編號自動產生（例如 JK-HV-2601-001）',
    '【意見回饋】回報系統錯誤或提出建議，可附截圖；輸入「我的回饋」看處理進度',
    '',
    '其他：',
    '・傳照片、影片或 PDF 等檔案：選專案後存進雲端資料夾',
    '・輸入 P01：看該專案詳情',
    '・輸入「開始 JK-HV-2601-0101」：記錄任務的實際開始日',
    '・輸入「完成 JK-HV-2601-0101」：直接把任務標記完成',
    '・輸入「取消」：中途放棄',
    '・輸入「選單」：叫出功能按鈕'
  ].join('\n'), menuItems_());
}

// =====================================================================
// 六、排程提醒（setup 會自動建立觸發條件）
// =====================================================================
/** 週五：提醒專案負責人「本週還沒更新」 */
function weeklyReminder() {
  if (!CONFIG.WEEKLY_REMIND) return;
  const monday = weekStart_();
  const ups = rows_('U');
  const by = {};
  function bucket(n) { return (by[n] = by[n] || { proj: [], tasks: [] }); }
  rows_('P').filter(function (p) { return !isClosed_(p) && !isPending_(p); }).forEach(function (p) {
    const has = ups.some(function (u) { return u['專案編號'] === p['編號'] && u['時間'].slice(0, 10) >= monday; });
    if (!has && p['負責人']) bucket(p['負責人']).proj.push(p);
  });
  Object.keys(by).forEach(function (name) {
    const m = memberByName_(name);
    if (!m || m['接收提醒'] === '否') return;
    const b = by[name], parts = ['⏰ 週五提醒'], items = [];
    if (b.proj.length) {
      parts.push('\n以下專案本週還沒更新：\n' + b.proj.map(function (p) { return '・' + p['編號'] + ' ' + p['專案名稱']; }).join('\n'));
      items.push(qPost_('📝 每週更新', 'cmd:每週更新', '每週更新'));
    }
    parts.push('\n下班前花 1 分鐘回報一下吧！');
    push_(m['LINE userId'], txt_(parts.join('\n'), items));
  });
  failIfAuth_();
}

/** 平日早上：每人一則「今日任務提醒」— 今天預定開始、應開始未開始、即將到期、今天到期／逾期（沒有事就不發，節省訊息則數） */
function dailyOverdue() {
  if (!CONFIG.OVERDUE_REMIND) return;
  const dow = Number(Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'u')); // 1=週一…7=週日
  if (dow > 5) return;
  // 每天早上順便檢查一次 LINE 金鑰（不消耗訊息則數），失效時這次排程會顯示失敗並寄通知信給擁有者
  noteAuth_(UrlFetchApp.fetch('https://api.line.me/v2/bot/info', { headers: { Authorization: 'Bearer ' + token_() }, muteHttpExceptions: true }).getResponseCode());
  const digest = dailyDigest_(todayStr_(), dow);
  Object.keys(digest).forEach(function (name) {
    const m = memberByName_(name);
    if (!m || m['接收提醒'] === '否') return;
    push_(m['LINE userId'], digest[name]);
  });
  failIfAuth_();
}
/** 組出每個人今天要收到的提醒訊息 { 姓名: 訊息 }（dow：1＝週一） */
function dailyDigest_(today, dow) {
  const soon = addDays_(today, DUE_SOON_DAYS), by = {};
  function bucket(n) { return (by[n] = by[n] || { startToday: [], notStarted: [], soon: [], due: [] }); }
  rows_('T').filter(function (t) { return t['狀態'] !== '已完成' && t['負責人'] && !isContainer_(t); }).forEach(function (t) {
    const ps = t['開始日'] || String(t['建立時間'] || '').slice(0, 10), due = t['完成日'];
    if (due && due <= today) { bucket(t['負責人']).due.push(t); return; }
    if (!t['實際開始日'] && ps) {
      const snooze = t['提醒延後至'];
      if (ps === today) bucket(t['負責人']).startToday.push(t);
      // 應開始未開始：預定開始日隔天提醒一次，之後每週一；延後提醒到期那天再提醒
      else if (ps < today && (!snooze || snooze <= today) && (addDays_(ps, 1) === today || dow === 1 || snooze === today)) bucket(t['負責人']).notStarted.push(t);
    }
    if (due === soon) bucket(t['負責人']).soon.push(t);
  });
  const out = {};
  Object.keys(by).forEach(function (name) {
    const b = by[name], L = ['📌 今日任務提醒（' + shortDate_(today) + '）'], items = [], unstarted = [];
    function line(t, note) { return '・' + t['編號'] + ' ' + t['任務'] + '（' + t['專案編號'] + '）' + (note || ''); }
    if (b.due.length) L.push('\n⚠ 今天到期／已逾期：\n' + b.due.map(function (t) { return line(t, dueNote_(t['完成日'], today)); }).join('\n'));
    if (b.startToday.length) L.push('\n▶ 今天預定開始：\n' + b.startToday.map(function (t) { return line(t); }).join('\n'));
    if (b.notStarted.length) L.push('\n⏳ 已過預定開始日、還沒開始：\n' + b.notStarted.map(function (t) { return line(t, '　預定 ' + shortDate_(t['開始日'] || String(t['建立時間']).slice(0, 10))); }).join('\n'));
    if (b.soon.length) L.push('\n🗓 ' + DUE_SOON_DAYS + ' 天後到期：\n' + b.soon.map(function (t) { return line(t, '　' + shortDate_(t['完成日']) + '｜' + taskStateText_(t, today)); }).join('\n'));
    b.startToday.concat(b.notStarted).forEach(function (t) {
      unstarted.push(t['編號']);
      if (items.length < 9) items.push(qPost_('▶ 開始 ' + t['任務'], 'start:' + t['編號'], '開始 ' + t['編號']));
    });
    if (unstarted.length) items.push(qPost_('⏸ 未開始的延後 3 天', 'snz:' + unstarted.slice(0, 20).join(',') + ':3', '延後提醒 3 天'));
    items.push(qPost_('📋 我的任務', 'cmd:我的任務', '我的任務'));
    out[name] = txt_(L.join('\n'), items);
  });
  return out;
}

/** 週一：給主管與管理員一份「落後專案清單」 */
function mondaySummary() {
  if (!CONFIG.MONDAY_SUMMARY) return;
  const msg = lagReport_();
  rows_('M').filter(function (m) { return isAdmin_(m) && m['接收提醒'] !== '否'; })
    .forEach(function (m) { push_(m['LINE userId'], msg); });
  failIfAuth_();
}
function lagReport_() {
  const today = todayStr_(), ps = rows_('P').filter(function (p) { return !isClosed_(p) && !isPending_(p); });
  const lag = ps.map(function (p) { return { p: p, m: metrics_(p) }; }).filter(function (x) { return x.m.light !== '正常'; })
    .sort(function (a, b) { return ((b.m.planned || 0) - (b.m.actual || 0)) - ((a.m.planned || 0) - (a.m.actual || 0)); });
  const L = ['📊 週一落後專案清單（' + today + '）', '進行中 ' + ps.length + ' 案，落後 ' + lag.length + ' 案'];
  if (!lag.length) L.push('\n本週沒有落後的專案 👍');
  lag.forEach(function (x) {
    const p = x.p, m = x.m;
    L.push('\n' + (LIGHT_ICON[m.light] || '') + ' ' + p['編號'] + ' ' + p['專案名稱'] + '｜' + (p['負責人'] || '未指定') +
      (m.planned !== null ? '\n　預定 ' + pct1_(m.planned) + '／實際 ' + pct1_(m.actual) + '（落後 ' + (Math.round((m.planned - m.actual) * 10) / 10) + '）' : '') +
      (p['截止日'] ? '\n　預定結案 ' + shortDate_(p['截止日']) + (p['截止日'] < today ? ' ⚠已逾期 ' + daysBetween_(p['截止日'], today) + ' 天' : '') : '') +
      (m.slip > 0 ? '\n　比基準計畫延後 ' + m.slip + ' 天' : '') +
      (m.notStarted ? '\n　應開始未開始的任務 ' + m.notStarted + ' 項' : '') +
      (p['卡關事項'] ? '\n　卡關：' + p['卡關事項'] : ''));
  });
  const items = lag.slice(0, 11).map(function (x) { return qPost_(x.p['編號'] + ' ' + x.p['專案名稱'], 'view:' + x.p['編號'], x.p['編號']); });
  items.push(qPost_('📊 專案總覽', 'cmd:專案總覽', '專案總覽'));
  return txt_(L.join('\n'), items);
}

// =====================================================================
// 七、LINE API 與訊息格式
// =====================================================================
function token_() {
  const t = PropertiesService.getScriptProperties().getProperty('LINE_TOKEN');
  if (!t) throw new Error('尚未設定指令碼屬性 LINE_TOKEN');
  return t;
}
function lineApi_(path, payload) {
  const res = UrlFetchApp.fetch('https://api.line.me/v2/bot/' + path, {
    method: 'post', contentType: 'application/json',
    headers: { Authorization: 'Bearer ' + token_() },
    payload: JSON.stringify(payload), muteHttpExceptions: true
  });
  if (res.getResponseCode() >= 300) console.error('LINE API ' + path + ' ' + res.getResponseCode() + ' ' + res.getContentText());
  noteAuth_(res.getResponseCode());
  return res;
}
// ----- LINE 金鑰失效偵測：記在指令碼屬性 LINE_AUTH_FAIL，儀表板會對主管顯示警告 -----
var _AUTH_FAIL = 0, _AUTH_CLEARED = false;
function noteAuth_(code) {
  const props = PropertiesService.getScriptProperties();
  if (code === 401) {
    _AUTH_FAIL = code;
    if (!props.getProperty('LINE_AUTH_FAIL')) props.setProperty('LINE_AUTH_FAIL', JSON.stringify({ at: nowStr_(), code: code }));
  } else if (code < 300 && !_AUTH_CLEARED) {   // 每次執行只檢查一次，成功就清掉警告
    _AUTH_CLEARED = true;
    if (props.getProperty('LINE_AUTH_FAIL')) props.deleteProperty('LINE_AUTH_FAIL');
  }
}
function failIfAuth_() {
  if (_AUTH_FAIL) throw new Error('LINE 金鑰失效（' + _AUTH_FAIL + '）：LINE 上收不到回覆。請到「專案設定 → 指令碼屬性」更新 LINE_TOKEN。');
}
function lineAlert_() {
  try { const v = PropertiesService.getScriptProperties().getProperty('LINE_AUTH_FAIL'); return v ? JSON.parse(v) : null; } catch (e) { return null; }
}
function reply_(replyToken, msgs) {
  if (!replyToken) return;
  return lineApi_('message/reply', { replyToken: replyToken, messages: [].concat(msgs).slice(0, 5) });
}
function push_(to, msgs) {
  return lineApi_('message/push', { to: to, messages: [].concat(msgs).slice(0, 5) });
}
function txt_(text, items) {
  const m = { type: 'text', text: cut_(text, 4900) };
  if (items && items.length) m.quickReply = { items: items.slice(0, 13) };
  return m;
}
function qMsg_(label, text) { return { type: 'action', action: { type: 'message', label: cut_(label, 20), text: text } }; }
function qPost_(label, data, display) {
  return { type: 'action', action: { type: 'postback', label: cut_(label, 20), data: data, displayText: cut_(display || label, 300) } };
}
function qDate_(label, data) { return { type: 'action', action: { type: 'datetimepicker', label: cut_(label, 20), data: data, mode: 'date' } }; }
function menuItems_() {
  return [qPost_('📝 每週更新', 'cmd:每週更新', '每週更新'), qPost_('➕ 新增任務', 'cmd:新增任務', '新增任務'),
    qPost_('📋 我的任務', 'cmd:我的任務', '我的任務'), qPost_('📊 專案總覽', 'cmd:專案總覽', '專案總覽'),
    qPost_('📁 新增專案', 'cmd:新增專案', '新增專案'), qPost_('📖 使用說明', 'cmd:使用說明', '使用說明'),
    qPost_('🧪 試驗單', 'cmd:試驗單', '試驗單'), qPost_('💬 意見回饋', 'cmd:意見回饋', '意見回饋')];
}
function fbTypeItems_() { return [qPost_('🐞 錯誤回報', 'fbt:錯誤', '錯誤回報'), qPost_('💡 功能建議', 'fbt:建議', '功能建議'), qMsg_('取消', '取消')]; }
function menu_(prefix) { return txt_((prefix ? prefix + '\n\n' : '') + '請選擇功能 👇', menuItems_()); }
function stageItems_(p) {
  const cur = curStage_(p);
  return [qPost_('不變（' + cur + '）', 'stage:', '階段不變')].concat(stagesOf_(p).slice(0, 12).map(function (s, i) { return qPost_((i + 1) + '. ' + stageLabel_(s), 'stage:' + s, '階段：' + s); }));
}
function parentItems_(mains) {
  return mains.slice(-11).map(function (it) { return qPost_(it.t['任務'], 'par:' + it.t['編號'], '放在：' + it.t['任務']); }).concat([qPost_('＋ 新的主任務', 'par:', '新的主任務'), qMsg_('取消', '取消')]);
}
function assigneeItems_(p, me) {
  const names = uniq_([p['負責人']].concat(splitNames_(p['參與成員']))).filter(function (n) { return n && n !== me['姓名']; });
  return [qPost_('我自己', 'who:' + me['姓名'], '負責人：我自己')].concat(names.slice(0, 11).map(function (n) { return qPost_(n, 'who:' + n, '負責人：' + n); }));
}
function askAssignee_(uid, rt, d, me) {
  setState_(uid, { flow: 'task', step: 'assignee', d: d });
  return reply_(rt, txt_('負責人是誰？（點選，或直接輸入名字）', assigneeItems_(projectByCode_(d.pid), me)));
}
function metricsLine_(mt) {
  return '階段：' + stageLabel_(mt.stage) + '（' + (mt.stageIdx + 1) + '/' + mt.stages.length + '）　燈號：' + (LIGHT_ICON[mt.light] || '') + mt.light +
    (mt.planned !== null ? '\n進度：預定 ' + pct1_(mt.planned) + '／實際 ' + pct1_(mt.actual) : '');
}
function noneItems_() { return [qPost_('無', 'none', '無'), qMsg_('取消', '取消')]; }

// =====================================================================
// 八、試算表存取與小工具
// =====================================================================
function sheet_(k) {
  let sh = ss_().getSheetByName(SH[k]);
  if (!sh && (k === 'R' || k === 'E' || k === 'D' || k === 'C')) {   // 新增的工作表：第一次用到時自動建立
    sh = ss_().insertSheet(SH[k]);
    sh.getRange(1, 1, 1, HEAD[k].length).setValues([HEAD[k]]).setFontWeight('bold').setBackground('#0064F3').setFontColor('#FFFFFF');
    sh.setFrozenRows(1);
    sh.getRange(1, 1, sh.getMaxRows(), HEAD[k].length).setNumberFormat('@');
  }
  if (!sh) throw new Error('找不到工作表「' + SH[k] + '」，請先執行 setup');
  return sh;
}
function rows_(k) {
  if (_ROWS[k]) return _ROWS[k];
  const v = sheet_(k).getDataRange().getDisplayValues();
  const h = v.shift() || [];
  const out = [];
  v.forEach(function (r, i) {
    if (!r.join('')) return;
    const o = { _row: i + 2 };
    h.forEach(function (key, j) { o[key] = String(r[j] == null ? '' : r[j]).trim(); });
    out.push(o);
  });
  _ROWS[k] = out;
  return out;
}
function append_(k, obj) {
  sheet_(k).appendRow(HEAD[k].map(function (h) { return obj[h] == null ? '' : String(obj[h]); }));
  delete _ROWS[k];
}
function setCells_(k, row, obj) {
  const sh = sheet_(k);
  Object.keys(obj).forEach(function (h) {
    const c = HEAD[k].indexOf(h);
    if (c >= 0) sh.getRange(row, c + 1).setValue(obj[h] == null ? '' : String(obj[h]));
  });
  delete _ROWS[k];
}
function deleteRow_(k, row) { sheet_(k).deleteRow(row); delete _ROWS[k]; }
/** 寫入時排隊（避免兩人同時寫入弄亂資料）；拿到鎖後重新讀取最新資料 */
function withLock_(fn) {
  const lock = LockService.getScriptLock();
  if (lock.hasLock()) return fn();
  lock.waitLock(25000);
  _ROWS = {};
  try { return fn(); } finally { lock.releaseLock(); }
}
/** 通知類推播延到回覆之後才送，使用者不用等 */
function pushLater_(to, msgs) { _AFTER.push([to, msgs]); }
function flushAfter_() { const q = _AFTER; _AFTER = []; q.forEach(function (x) { try { push_(x[0], x[1]); } catch (e) { console.error(e); } }); }
/** 舊版建立的工作表若缺少新欄位，補上標題 */
function ensureHead_(k) {
  const sh = sheet_(k);
  const cur = sh.getRange(1, 1, 1, HEAD[k].length).getDisplayValues()[0];
  let changed = false;
  HEAD[k].forEach(function (h, i) { if (cur[i] !== h) { sh.getRange(1, i + 1).setValue(h); changed = true; } });
  if (changed) delete _ROWS[k];
}
function strip_(o) { const c = {}; Object.keys(o).forEach(function (k) { if (k !== '_row') c[k] = o[k]; }); return c; }
function projectByCode_(code) { const c = normCode_(code); return c ? rows_('P').filter(function (p) { return normCode_(p['編號']) === c; })[0] || null : null; }
function memberByUid_(uid) { return rows_('M').filter(function (m) { return m['LINE userId'] === uid; })[0] || null; }
function memberByName_(name) { return rows_('M').filter(function (m) { return m['姓名'] === name; })[0] || null; }
function nextCode_(k, prefix, pad) {
  let max = 0;
  const re = new RegExp('^' + prefix + '(\\d+)$', 'i');
  rows_(k).forEach(function (r) { const m = String(r['編號']).match(re); if (m && Number(m[1]) > max) max = Number(m[1]); });
  return prefix + String(max + 1).padStart(pad, '0');
}
// ----- 專案編號（可自訂）與任務編號（專案編號-流水號，例如 P03-01） -----
function normCode_(s) { return String(s || '').trim().toUpperCase().replace(/\s+/g, ''); }
/** 檢查專案編號格式與是否重複；沒問題回傳空字串 */
function checkProjectCode_(code, exceptRow) {
  if (!/^[A-Z0-9][A-Z0-9_\-]{1,19}$/.test(code)) return '專案編號只能用英文、數字、- 或 _，長度 2～20 個字';
  if (rows_('P').some(function (p) { return normCode_(p['編號']) === code && p._row !== exceptRow; })) return '專案編號「' + code + '」已經被使用了，請換一個';
  return '';
}
// ===== 任務階層（主任務／子任務）、權重與進度 =====
var _TREE = null, _MET = null;
function dnum_(s) { return s ? Math.floor(Date.parse(String(s).slice(0, 10) + 'T00:00:00Z') / 86400000) : null; }
function taskDoneDate_(t) { return t['狀態'] === '已完成' ? String(t['完成時間'] || '').slice(0, 10) : ''; }
function taskOrder_(a, b) {
  const x = Number(a['排序']) || 0, y = Number(b['排序']) || 0;
  if (x !== y) return (x || 1e9) - (y || 1e9);
  return String(a['編號']).localeCompare(String(b['編號']), 'en', { numeric: true }) || a._row - b._row;
}
function weightOf_(t) { const v = String(t['權重'] == null ? '' : t['權重']).trim(); if (v === '') return 1; const n = Number(v); return isNaN(n) || n < 0 ? 1 : n; }
/** 依專案整理任務：順序、層級、子任務、主任務的彙總日期與權重 */
function tree_() {
  const all = rows_('T');
  if (_TREE && _TREE.src === all) return _TREE;
  const byP = {}, info = {};
  all.forEach(function (t) { (byP[t['專案編號']] = byP[t['專案編號']] || []).push(t); });
  Object.keys(byP).forEach(function (pid) {
    let main = null;
    byP[pid] = byP[pid].sort(taskOrder_).map(function (t) {
      const lv = String(t['層級']) === '2' && main ? 2 : 1;
      const ae = taskDoneDate_(t), done = t['狀態'] === '已完成';
      let ps = t['開始日'] || String(t['建立時間'] || '').slice(0, 10), pe = t['完成日'] || '';   // 沒填預定開始日＝用建立日（與網頁一致）
      if (ps && pe && ps > pe) ps = pe;
      const pv = String(t['完成度'] == null ? '' : t['完成度']).trim(), pct = pv === '' || isNaN(Number(pv)) ? null : Math.max(0, Math.min(100, Number(pv)));
      const it = { t: t, lv: lv, kids: [], parent: lv === 2 ? main.t['編號'] : '', w: weightOf_(t),
        ps: ps, pe: pe, as: t['實際開始日'] || (done ? (ps && ps <= ae ? ps : ae) : ''), ae: ae, done: done, pct: pct,
        bs: t['基準開始日'] || '', be: t['基準完成日'] || '' };
      if (lv === 1) main = it; else main.kids.push(it);
      info[t['編號'] + '@' + t._row] = it;
      return it;
    });
    byP[pid].forEach(function (it) {
      if (!it.kids.length) return;
      const k = it.kids, min = function (a) { return a.filter(Boolean).sort()[0] || ''; }, max = function (a) { return a.filter(Boolean).sort().pop() || ''; };
      it.ps = min(k.map(function (x) { return x.ps || x.pe; })); it.pe = max(k.map(function (x) { return x.pe; }));
      it.as = min(k.map(function (x) { return x.as; }));
      it.done = k.every(function (x) { return x.done; });
      it.ae = it.done ? max(k.map(function (x) { return x.ae; })) : '';
      it.w = k.reduce(function (a, x) { return a + x.w; }, 0);
      it.bs = min(k.map(function (x) { return x.bs; })); it.be = max(k.map(function (x) { return x.be; }));
    });
  });
  return (_TREE = { src: all, byP: byP, info: info });
}
function itemOf_(t) { return tree_().info[t['編號'] + '@' + t._row] || null; }
function isContainer_(t) { const it = itemOf_(t); return !!(it && it.kids.length); }
/** 到今天的計畫／實際完成率（依經過時間推算）：
 *  計畫＝從計畫開始日起經過的天數 ÷ 計畫天數；實際＝從實際開始日起經過的天數 ÷ 計畫天數（按完成＝100%，未完成最多 99%）
 *  比計畫早開始的任務，從計畫開始日才起算（提早開始不提前計分，避免進度被灌高；提早做完按「完成」仍算 100%）
 *  專案總進度＝Σ 任務完成率 × 權重%，例：11/2～11/4 的任務、權重 5%，第一天＝1/3 × 5% ≒ 1.7% */
function fracs_(it, T) {
  const pe = dnum_(it.pe), ps = it.ps ? dnum_(it.ps) : pe, as = dnum_(it.as);
  const dur = (pe !== null && ps !== null) ? pe - ps + 1 : null;
  let pf = 0;
  if (dur) pf = T >= pe ? 1 : (T >= ps ? (T - ps + 1) / dur : 0);
  let af = 0;
  if (it.done) af = 1;
  else if (as !== null && dur && T >= as) { const s0 = Math.max(as, ps); af = T >= s0 ? Math.min(0.99, (T - s0 + 1) / dur) : 0; }
  return [pf, af];
}
/** 專案的進度、階段、燈號、狀態（燈號全部自動判斷） */
function metrics_(p) {
  const tr = tree_();
  if (!_MET || _MET.src !== tr) _MET = { src: tr, map: {} };
  const key = p['編號'] + '|' + p['階段'] + '|' + p['實際開案日'] + '|' + p['實際結案日'] + '|' + p['截止日'] + '|' + p['類型'] + '|' + p['基準結案日'];
  if (_MET.map[key]) return _MET.map[key];
  const items = tr.byP[p['編號']] || [], today = todayStr_(), T = dnum_(today);
  const leaves = items.filter(function (it) { return !it.kids.length; });
  const hier = items.length > 0;   // 有任務就以主任務當階段（階段與主任務連動）
  let stages, stage, closed;
  if (hier) {
    const mains = items.filter(function (it) { return it.lv === 1; });
    stages = mains.map(function (it) { return it.t['任務']; });
    const cur = mains.filter(function (it) { return !it.done; })[0];
    stage = cur ? cur.t['任務'] : stages[stages.length - 1]; closed = !cur;
  } else {
    stages = TYPES[typeOf_(p)];
    stage = stages.indexOf(p['階段']) >= 0 ? p['階段'] : stages[0];
    closed = stage === stages[stages.length - 1];
  }
  if (p['實際結案日']) closed = true;
  const tAs = items.map(function (it) { return it.as; }).filter(Boolean).sort()[0] || '';
  const actualStart = p['實際開案日'] || tAs;
  let actualEnd = p['實際結案日'] || '';
  if (closed && !actualEnd) actualEnd = (hier ? items.map(function (it) { return it.ae; }).filter(Boolean).sort().pop() : '') || String(p['最近更新'] || '').slice(0, 10) || today;
  // 進度：依任務權重加權（只算有計畫日期的任務）；沒有排日期的任務時，用專案本身的計畫／實際日期
  let W = 0, P = 0, A = 0;
  leaves.filter(function (it) { return it.pe; }).forEach(function (it) { const f = fracs_(it, T); W += it.w; P += it.w * f[0]; A += it.w * f[1]; });
  if (!(W > 0) && p['截止日']) {
    const f = fracs_({ ps: p['開始日'] || '', pe: p['截止日'], as: actualStart, done: closed }, T);
    W = 1; P = f[0]; A = f[1];
  }
  const has = W > 0;
  const planned = has ? Math.round(P / W * 1000) / 10 : null, actual = has ? Math.round(A / W * 1000) / 10 : null;   // 顯示到小數一位
  const due = p['截止日'], lag = has ? planned - actual : 0;
  let light;
  if (closed) light = due && actualEnd > due ? '逾期' : '正常';
  else if (lag >= RED_GAP || (due && today > due)) light = '卡關';
  else if (lag >= RISK_GAP) light = '有風險';
  else light = '正常';
  const status = closed ? '完成' : light !== '正常' ? '延遲' : (actualStart && actualStart <= today) || actual > 0 ? '執行中' : '未開始';
  return (_MET.map[key] = { planned: planned, actual: actual, light: light, status: status, stage: stage, stages: stages,
    stageIdx: Math.max(0, stages.indexOf(stage)), hier: hier, closed: closed, actualStart: actualStart, actualEnd: actualEnd,
    count: leaves.length, done: leaves.filter(function (it) { return it.done; }).length,
    notStarted: leaves.filter(function (it) { return !it.done && !it.as && it.ps && it.ps < today; }).length,
    locked: !!p['基準鎖定日'], slip: p['基準結案日'] && due ? dnum_(due) - dnum_(p['基準結案日']) : 0,
    mains: items.filter(function (it) { return it.lv === 1; }).map(function (it) {   // 各主任務的預定／實際進度（依子任務權重）
      let w = 0, pp = 0, aa = 0;
      (it.kids.length ? it.kids : [it]).filter(function (x) { return x.pe; }).forEach(function (x) { const f = fracs_(x, T); w += x.w; pp += x.w * f[0]; aa += x.w * f[1]; });
      return { code: it.t['編號'], name: it.t['任務'], planned: w > 0 ? Math.round(pp / w * 1000) / 10 : null, actual: w > 0 ? Math.round(aa / w * 1000) / 10 : (it.done ? 100 : null),
        done: it.done, ps: it.ps, pe: it.pe, kids: it.kids.length };
    }) });
}
/** 儀表板用：依專案、樹狀順序輸出任務，附上層級與彙總欄位 */
function tasksOut_() {
  const tr = tree_(), out = [];
  Object.keys(tr.byP).forEach(function (pid) {
    tr.byP[pid].forEach(function (it) {
      const c = strip_(it.t);
      c._lv = it.lv; c._parent = it.parent; c._kids = it.kids.length; c._w = it.w;
      c._ps = it.ps; c._pe = it.pe; c._as = it.as; c._ae = it.ae; c._done = it.done; c._bs = it.bs; c._be = it.be;
      out.push(c);
    });
  });
  return out;
}
function pad2_(n) { return String(n).padStart(2, '0'); }
/** 依目前順序重新編排任務編號：主任務 -0100、子任務 -0101 */
function renumberTasks_(pid) {
  const items = tree_().byP[pid] || [], want = {};
  let m = 0, k = 0;
  items.forEach(function (it, i) {
    if (it.lv === 1) { m++; k = 0; } else k++;
    if (m > 99 || k > 99) throw new Error('主任務或子任務超過 99 個');
    want[it.t._row] = { '編號': pid + '-' + pad2_(m) + pad2_(it.lv === 1 ? 0 : k), '排序': String((i + 1) * 10), '層級': String(it.lv) };
  });
  ['編號', '排序', '層級'].forEach(function (h) { setColumn_('T', h, function (r) { return want[r._row] ? want[r._row][h] : undefined; }); });
}
/** 新增任務：parentCode 有值＝放在該主任務最後面當子任務；否則加在最後當主任務。回傳新編號 */
function insertTask_(pid, parentCode, obj) {
  ensureHead_('T');
  renumberTasks_(pid);
  const items = tree_().byP[pid] || [];
  const par = parentCode ? items.filter(function (it) { return it.lv === 1 && it.t['編號'] === parentCode; })[0] : null;
  if (parentCode && !par) throw new Error('找不到主任務 ' + parentCode);
  let ord, lv = 1;
  if (par) { lv = 2; const last = par.kids.length ? par.kids[par.kids.length - 1] : par; ord = Number(last.t['排序']) + 5; }
  else ord = (items.length + 1) * 10;
  append_('T', Object.assign({}, obj, { '編號': pid + '-NEW', '層級': String(lv), '排序': String(ord) }));
  const row = sheet_('T').getLastRow();
  renumberTasks_(pid);
  const t = rows_('T').filter(function (r) { return r._row === row; })[0];
  return t ? t['編號'] : '';
}
/** 移動任務：up／down（主任務連同子任務一起移）、indent（變成上一個主任務的子任務）、outdent（變回主任務） */
function moveTask_(t, op) {
  const pid = t['專案編號'], row = t._row;
  renumberTasks_(pid);
  const items = (tree_().byP[pid] || []).map(function (it) { return { row: it.t._row, lv: it.lv }; });
  const i = items.findIndex(function (x) { return x.row === row; });
  if (i < 0) throw new Error('找不到任務');
  const blockEnd = function (s) { let e = s + 1; while (e < items.length && items[e].lv === 2) e++; return e; };
  if (op === 'indent') { if (items[i].lv === 2) return '已經是子任務了'; if (i === 0) return '第一個任務不能變成子任務'; items[i].lv = 2; }
  else if (op === 'outdent') { if (items[i].lv === 1) return '已經是主任務了'; items[i].lv = 1; }
  else if (items[i].lv === 2) {
    const j = op === 'up' ? i - 1 : i + 1;
    if (j < 0 || j >= items.length || items[j].lv !== 2) return op === 'up' ? '已經是這個主任務的第一個子任務' : '已經是這個主任務的最後一個子任務';
    const tmp = items[i]; items[i] = items[j]; items[j] = tmp;
  } else {
    const e = blockEnd(i);
    if (op === 'up') {
      let s = i - 1; while (s >= 0 && items[s].lv === 2) s--;
      if (s < 0) return '已經在最上面';
      items.splice.apply(items, [s, 0].concat(items.splice(i, e - i)));
    } else {
      if (e >= items.length) return '已經在最下面';
      const e2 = blockEnd(e);
      items.splice.apply(items, [i + (e2 - e), 0].concat(items.splice(i, e - i)));
    }
  }
  if (items[0]) items[0].lv = 1;
  const want = {};
  items.forEach(function (x, k) { want[x.row] = { '排序': String((k + 1) * 10), '層級': String(x.lv) }; });
  ['排序', '層級'].forEach(function (h) { setColumn_('T', h, function (r) { return want[r._row] ? want[r._row][h] : undefined; }); });
  renumberTasks_(pid);
  return '';
}
/** 依單位與年度產生下一個案件編號，例如 JK-HV-2603 */
function nextProjectCode_(dept, dateStr) {
  const pre = 'JK-' + dept + '-' + String(dateStr || todayStr_()).slice(2, 4);
  let max = 0;
  rows_('P').forEach(function (p) {
    const c = normCode_(p['編號']);
    if (c.indexOf(pre) === 0 && /^\d+$/.test(c.slice(pre.length))) max = Math.max(max, Number(c.slice(pre.length)));
  });
  return pre + String(max + 1).padStart(2, '0');
}
function deptOfCode_(code) { const m = normCode_(code).match(/^JK-([A-Z][A-Z0-9]{1,3})-/); return m && depts_()[m[1]] ? m[1] : ''; }
/** 某部門底下的課／組代碼 */
function deptKids_(code) { const ds = depts_(), par = deptParents_(), name = ds[code]; return Object.keys(ds).filter(function (k) { return k !== code && name && par[k] === name; }); }
function deptItems_() {
  // 先選部門（最上層單位），有課／組的部門再選第二層
  const ds = depts_(), par = deptParents_(), names = {};
  Object.keys(ds).forEach(function (k) { names[ds[k]] = 1; });
  const top = Object.keys(ds).filter(function (k) { return !par[k] || !names[par[k]]; });
  return top.slice(0, 12).map(function (k) { return qPost_(ds[k], 'dept:' + k, ds[k]); }).concat([qMsg_('取消', '取消')]);
}
function deptKidItems_(code) {
  const ds = depts_();
  return deptKids_(code).slice(0, 11).map(function (k) { return qPost_(ds[k] + ' ' + nextProjectCode_(k), 'deptx:' + k, ds[k]); })
    .concat([qPost_(ds[code] + '（部門案）', 'deptx:' + code, ds[code] + '（部門案）'), qMsg_('取消', '取消')]);
}
function deptListText_() { return '\n（也可以直接輸入單位代碼，例如 HV）'; }
/** 研究試驗單編號：案件編號-流水號三碼，例如 JK-HV-2601-001 */
function nextTestCode_(pid) {
  const pre = pid + '-';
  let max = 0;
  rows_('E').forEach(function (e) {
    const c = String(e['試驗單編號']);
    if (e['專案編號'] === pid && c.indexOf(pre) === 0 && /^\d+$/.test(c.slice(pre.length))) max = Math.max(max, Number(c.slice(pre.length)));
  });
  return pre + String(max + 1).padStart(3, '0');
}
/** 每週更新時自動補上實際開案日；進入最後階段時補上實際結案日 */
function autoDates_(p, stage) {
  const o = {}, st = stagesOf_(p);
  if (!p['實際開案日']) o['實際開案日'] = todayStr_();
  // 有主任務的專案：全部主任務完成才算結案（由進度自動判斷，不寫入）；預定階段的專案：選到最後一個階段就結案
  if (!hasHier_(p) && stage === st[st.length - 1] && !p['實際結案日']) o['實際結案日'] = todayStr_();
  return o;
}
/** 標記任務完成；沒填實際開始日時，以預定開始日（不晚於今天）補上 */
function taskDone_(t) {
  const today = todayStr_(), cells = { '狀態': '已完成', '完成時間': nowStr_() };
  if (!t['實際開始日']) cells['實際開始日'] = t['開始日'] && t['開始日'] < today ? t['開始日'] : today;
  setCells_('T', t._row, cells);
  const p = projectByCode_(t['專案編號']);
  if (p && !p['實際開案日']) setCells_('P', p._row, { '實際開案日': cells['實際開始日'] || today });
}
function judgeItems_() { return TEST_RESULTS.map(function (r) { return qPost_(r, 'judge:' + r, '判定：' + r); }).concat([qMsg_('取消', '取消')]); }
function saveTest_(d, me) {
  let code;
  withLock_(function () {
    ensureHead_('E');
    code = nextTestCode_(d.pid);
    append_('E', {
      '試驗單編號': code, '專案編號': d.pid, '試驗名稱': d.name, '試驗日期': todayStr_(), '試驗人員': me['姓名'], '試驗目的': '',
      '試驗條件與參數': d.param || '', '試驗結果': d.result || '', '判定': d.judge || '待判定', '附件': (d.files || []).join('\n'),
      '建立人': me['姓名'], '建立時間': nowStr_()
    });
  });
  return code;
}

/** 整欄一次寫回（比逐格快）；fn 回傳 undefined 表示不改 */
function setColumn_(k, header, fn) {
  const sh = sheet_(k), c = HEAD[k].indexOf(header) + 1, rs = rows_(k), last = sh.getLastRow();
  if (c < 1 || last < 2 || !rs.length) return 0;
  const rng = sh.getRange(2, c, last - 1, 1), vals = rng.getDisplayValues();
  let n = 0;
  rs.forEach(function (r) { const v = fn(r); if (v !== undefined && v !== vals[r._row - 2][0]) { vals[r._row - 2][0] = String(v); n++; } });
  if (n) rng.setValues(vals);
  delete _ROWS[k];
  return n;
}
/** 修改專案編號：任務編號、每週更新、檔案紀錄、雲端資料夾名稱一起改 */
function renameProject_(p, nu) {
  const old = p['編號'];
  setColumn_('T', '編號', function (t) { const c = String(t['編號']); return t['專案編號'] === old && c.indexOf(old + '-') === 0 ? nu + c.slice(old.length) : undefined; });
  setColumn_('E', '試驗單編號', function (e) { const c = String(e['試驗單編號']); return e['專案編號'] === old && c.indexOf(old + '-') === 0 ? nu + c.slice(old.length) : undefined; });
  ['T', 'U', 'F', 'E', 'C'].forEach(function (k) { setColumn_(k, '專案編號', function (r) { return r['專案編號'] === old ? nu : undefined; }); });
  setColumn_('C', '任務編號', function (r) { const c = String(r['任務編號']); return r['專案編號'] === nu && c.indexOf(old + '-') === 0 ? nu + c.slice(old.length) : undefined; });
  setCells_('P', p._row, { '編號': nu });
  try {
    const it = DriveApp.getFolderById(PropertiesService.getScriptProperties().getProperty('PHOTO_FOLDER_ID')).getFolders();
    while (it.hasNext()) { const f = it.next(); if (f.getName().indexOf(old + ' ') === 0) f.setName(nu + f.getName().slice(old.length)); }
  } catch (e) { console.error('資料夾改名失敗', e); }
}
/** 一次性：把舊的 T001 格式任務編號改成「專案編號-流水號」（在編輯器執行） */
function migrateTaskCodes() {
  withLock_(function () {
    const seq = {}, used = {};
    rows_('T').forEach(function (t) { if (/^.+-\d+$/.test(t['編號']) && t['編號'].indexOf(t['專案編號'] + '-') === 0) used[t['編號']] = 1; });
    const n = setColumn_('T', '編號', function (t) {
      const pid = t['專案編號'], c = String(t['編號']);
      if (!pid || c.indexOf(pid + '-') === 0) return undefined;
      let code;
      do { seq[pid] = (seq[pid] || 0) + 1; code = pid + '-' + String(seq[pid]).padStart(2, '0'); } while (used[code]);
      used[code] = 1;
      return code;
    });
    Logger.log('已更新 ' + n + ' 個任務編號');
  });
}
function splitNames_(s) { return String(s || '').split(/[、,，\/\s]+/).map(function (x) { return x.trim(); }).filter(Boolean); }
function uniq_(a) { return a.filter(function (x, i) { return x && a.indexOf(x) === i; }); }
function cut_(s, n) { s = String(s); return s.length > n ? s.slice(0, n - 1) + '…' : s; }

function tz_() { return Session.getScriptTimeZone(); }
function nowStr_() { return Utilities.formatDate(new Date(), tz_(), 'yyyy-MM-dd HH:mm'); }
function todayStr_() { return Utilities.formatDate(new Date(), tz_(), 'yyyy-MM-dd'); }
function weekStart_() {
  const d = new Date();
  const dow = Number(Utilities.formatDate(d, tz_(), 'u'));
  return Utilities.formatDate(new Date(d.getTime() - (dow - 1) * 86400000), tz_(), 'yyyy-MM-dd');
}
function shortDate_(s) { const m = String(s).match(/^\d{4}-(\d{2})-(\d{2})/); return m ? Number(m[1]) + '/' + Number(m[2]) : s; }
function daysBetween_(a, b) { return Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 86400000); }
function dueNote_(due, today) {
  if (!due) return '';
  if (due < today) return '｜完成日 ' + shortDate_(due) + ' ⚠逾期' + daysBetween_(due, today) + '天';
  if (due === today) return '｜今天到期';
  return '｜完成日 ' + shortDate_(due);
}
/** 接受 2026-11-15、2026/11/15、11/15、11-15、1115 */
function parseDate_(s) {
  s = String(s).trim().replace(/[年月]/g, '/').replace(/日/g, '');
  const today = todayStr_();
  const y0 = Number(today.slice(0, 4));
  let m = s.match(/^(\d{4})[\/\-.](\d{1,2})[\/\-.](\d{1,2})$/), y, mo, d;
  if (m) { y = +m[1]; mo = +m[2]; d = +m[3]; }
  else if ((m = s.match(/^(\d{1,2})[\/\-.](\d{1,2})$/)) || (m = s.match(/^(\d{2})(\d{2})$/))) {
    mo = +m[1]; d = +m[2]; y = y0;
    const cand = y + '-' + String(mo).padStart(2, '0') + '-' + String(d).padStart(2, '0');
    if (cand < today && daysBetween_(cand, today) > 60) y = y0 + 1; // 例如 12 月輸入 1/10 → 明年
  } else return null;
  const dt = new Date(Date.UTC(y, mo - 1, d));
  if (dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return null;
  return y + '-' + String(mo).padStart(2, '0') + '-' + String(d).padStart(2, '0');
}

// 對話狀態暫存（6 小時）
function getState_(uid) { const s = CacheService.getScriptCache().get('st_' + uid); return s ? JSON.parse(s) : null; }
function setState_(uid, st) { CacheService.getScriptCache().put('st_' + uid, JSON.stringify(st), 21600); }
function clearState_(uid) { CacheService.getScriptCache().remove('st_' + uid); }
function seen_(id) {
  const c = CacheService.getScriptCache();
  if (c.get('ev_' + id)) return true;
  c.put('ev_' + id, '1', 3600);
  return false;
}

// =====================================================================
// 九、網頁儀表板的寫入功能（由 Dashboard.html 透過 google.script.run 呼叫）
// =====================================================================
// ===== 公司網址版（work.jaker.com.tw/pm）：用行政服務的帳號登入，畫面與資料都走這裡 =====
/** 這支程式「所有人可存取」的部署（LINE Webhook 同一個），公司網址的儀表板用它讀寫資料 */
const WEB_API_URL = 'https://script.google.com/a/macros/jaker.com.tw/s/AKfycby6BBqGJwJdaK8C0-HSTdITNhjfcyyS5skvuryZ16poXFPz5AF567SEaiLuVKsh-ZpC/exec';
/** 行政服務入口的 API：用來確認登入代碼是哪位員工 */
const ADMIN_API_URL = 'https://script.google.com/a/macros/jaker.com.tw/s/AKfycbzV_WQ7PIykmOIIF0Q-xrp_bxKaKiE195c_YB7qgvwvDINYWpKERU70uW__CpmgBbJV/exec';
var _WEBAUTH = null;
function webApi_(body) {
  const out = function (o) { return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); };
  try {
    const who = tokenUser_(body.token);
    if (!who) return out({ ok: false, auth: true, error: '登入已過期，請重新登入。' });
    const m = (who.name && memberByName_(who.name)) || (who.email && rows_('M').filter(function (x) { return String(x['公司信箱'] || '').toLowerCase() === who.email; })[0]) || null;
    _WEBAUTH = { email: who.name || who.email || '', member: m };
    if (body.page) {
      const t = HtmlService.createTemplateFromFile('Dashboard');
      t.data = JSON.stringify(dashboardData_(webUser_())).replace(/</g, '\\u003c');
      t.api = JSON.stringify(WEB_API_URL);
      return out({ ok: true, html: t.evaluate().getContent() });
    }
    const name = String(body.api || '');
    const g = (typeof globalThis !== 'undefined') ? globalThis : this;
    if (!/^api_\w+$/.test(name) || typeof g[name] !== 'function') throw new Error('不支援的操作：' + name);
    const data = g[name].apply(null, Array.isArray(body.args) ? body.args : []);
    return out({ ok: true, data: data === undefined ? null : data });
  } catch (err) {
    console.error(err && err.stack || err);
    return out({ ok: false, error: String(err && err.message || err).replace(/^(Error|Exception):\s*/, '') });
  } finally { _WEBAUTH = null; }
}
/** 登入代碼 → 員工（向行政服務確認；同一個代碼 10 分鐘內不重複查） */
function tokenUser_(token) {
  token = String(token || '').trim().slice(0, 300);
  if (!token) return null;
  const c = CacheService.getScriptCache();
  const k = 'tk:' + Utilities.base64EncodeWebSafe(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, token)).slice(0, 43);
  const hit = c.get(k);
  if (hit) return hit === '-' ? null : JSON.parse(hit);
  const who = adminWho_(token);
  c.put(k, who ? JSON.stringify(who) : '-', who ? 600 : 60);
  return who;
}
/** 向行政服務確認登入代碼（whoami）；回傳 {name, email, id} 或 null */
function adminWho_(token) {
  const r = UrlFetchApp.fetch(ADMIN_API_URL, {
    method: 'post', contentType: 'text/plain;charset=utf-8', followRedirects: true, muteHttpExceptions: true,
    payload: JSON.stringify({ api: 1, fn: 'whoami', arg: token })
  });
  if (r.getResponseCode() !== 200) throw new Error('暫時無法確認登入（行政服務沒有回應），請稍後再試。');
  let j = null;
  try { j = JSON.parse(r.getContentText()); } catch (e) { throw new Error('暫時無法確認登入，請稍後再試。'); }
  const u = j && j.ok && j.v && j.v.user;
  return u && u.name ? { name: String(u.name).trim(), email: String(u.email || '').toLowerCase(), id: String(u.id || '') } : null;
}
function webGuard_() {
  if (_WEBAUTH) return _WEBAUTH.email;
  const email = Session.getActiveUser().getEmail();
  if (!email) throw new Error('請用公司 Google 帳號登入後再操作');
  return email;
}
/** 用登入的公司信箱對應成員表 */
function webUser_() {
  if (_WEBAUTH) { ensureHead_('M'); return { email: _WEBAUTH.email, member: _WEBAUTH.member }; }
  const email = webGuard_().toLowerCase();
  ensureHead_('M');
  const m = rows_('M').filter(function (x) { return String(x['公司信箱'] || '').toLowerCase() === email; })[0] || null;
  return { email: email, member: m };
}
function webWrite_(fn) {
  const u = webUser_();
  if (!u.member) throw new Error('你的帳號（' + u.email + '）還沒登記在成員表，目前只能查看。請聯絡主管。');
  withLock_(function () { fn(u.member); });
  flushAfter_();
  return dashboardData_(webUser_());
}
function cleanText_(s, n) { return String(s == null ? '' : s).trim().slice(0, n); }
function cleanDate_(s) {
  s = String(s || '').trim();
  if (!s) return '';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) throw new Error('日期格式不正確：' + s);
  return s;
}

function api_getData() { return dashboardData_(webUser_()); }

/** 新增或編輯專案（f.code 有值就是編輯） */
function api_saveProject(f) {
  return webWrite_(function (me) {
    const admin = isAdmin_(me);
    if (!admin && f.code) {
      const p0 = projectByCode_(f.code);
      if (!p0 || !isPending_(p0) || p0['申請人'] !== me['姓名']) throw new Error('只有主管可以編輯專案；成員只能修改自己還沒核准的申請');
    }
    ensureHead_('P');
    const type = TYPES[f.type] ? f.type : '開發';
    const name = cleanText_(f.name, 80);
    if (!name) throw new Error('請輸入專案名稱');
    if (rows_('P').some(function (p) { return p['專案名稱'] === name && p['編號'] !== f.code; })) throw new Error('已經有同名的專案了');
    const data = {
      '專案名稱': name, '目的與預期成果': cleanText_(f.goal, 600), '負責人': cleanText_(f.owner, 40),
      '參與成員': splitNames_(f.members).join('、'),
      '類型': type,
      '開始日': cleanDate_(f.start), '截止日': cleanDate_(f.due),
      '部門': depts_()[f.dept] ? f.dept : '', '產品規格': cleanText_(f.spec, 120),
      '實際開案日': admin ? cleanDate_(f.actualStart) : '', '實際結案日': admin ? cleanDate_(f.actualEnd) : ''
    };
    if (!admin) { data['核准狀態'] = '待核准'; data['退回原因'] = ''; }   // 成員：新申請或修改後重新送出
    const want = normCode_(f.newCode);
    if (f.code) {
      const p = projectByCode_(f.code);
      if (!p) throw new Error('找不到專案 ' + f.code);
      if (p['基準鎖定日']) {   // 基準已鎖定：改預定日期要填原因並留紀錄
        const ch = [['開始日', '預定開案日'], ['截止日', '預定結案日']].filter(function (x) { return (p[x[0]] || '') !== data[x[0]]; });
        if (ch.length) {
          const reason = cleanText_(f.reason, 200);
          if (!reason) throw new Error('這個專案已鎖定基準計畫，修改預定日期請填寫變更原因');
          ch.forEach(function (x) { logChange_(p['編號'], '', x[1], p[x[0]], data[x[0]], reason, me['姓名']); });
        }
      }
      if (TYPES[type].indexOf(p['階段']) < 0) data['階段'] = TYPES[type][0];   // 換類型時階段重設
      if (want && want !== p['編號']) {
        const err = checkProjectCode_(want, p._row);
        if (err) throw new Error(err);
      }
      setCells_('P', p._row, data);
      if (want && want !== p['編號']) renameProject_(p, want);
      if (!admin) notifyApprovers_(Object.assign({}, p, data, { '編號': want || p['編號'] }), true);
    } else {
      if (want) { const err = checkProjectCode_(want); if (err) throw new Error(err); }
      data['編號'] = want || (data['部門'] ? nextProjectCode_(data['部門'], data['開始日'] || todayStr_()) : nextCode_('P', 'P', 2));
      if (!data['部門']) data['部門'] = deptOfCode_(data['編號']);
      data['建立時間'] = nowStr_();
      data['最近更新'] = '';
      data['階段'] = TYPES[type][0]; data['燈號'] = '正常'; data['卡關事項'] = '';
      if (!data['開始日']) data['開始日'] = todayStr_();
      if (!admin) data['申請人'] = me['姓名'];
      append_('P', data);
      if (!admin) notifyApprovers_(data, false);
    }
  });
}

/** 核准／退回成員開的專案（提案單位主管或管理員） */
function api_approveProject(code) {
  return webWrite_(function (me) {
    const p = projectByCode_(code);
    if (!p) throw new Error('找不到專案 ' + code);
    if (p['核准狀態'] !== '待核准') throw new Error(code + ' 目前不是待核准狀態');
    if (!canApprove_(me, p)) throw new Error('你不是這個專案的核准人');
    approveProject_(p, me);
  });
}
function api_rejectProject(code, reason) {
  return webWrite_(function (me) {
    const p = projectByCode_(code);
    if (!p) throw new Error('找不到專案 ' + code);
    if (p['核准狀態'] !== '待核准') throw new Error(code + ' 目前不是待核准狀態');
    if (!canApprove_(me, p)) throw new Error('你不是這個專案的核准人');
    reason = cleanText_(reason, 200);
    if (!reason) throw new Error('請填寫退回原因');
    rejectProject_(p, me, reason);
  });
}

function api_addTask(f) {
  return webWrite_(function (me) {
    const p = projectByCode_(f.pid);
    if (!p) throw new Error('找不到專案 ' + f.pid);
    if (!canUpdate_(me, p)) throw new Error('只有專案負責人、參與成員或主管可以新增任務');
    const title = cleanText_(f.title, 120);
    if (!title) throw new Error('請輸入任務內容');
    const by = me['姓名'];
    ensureHead_('T');
    const d = { pid: p['編號'], pname: p['專案名稱'], title: title, assignee: cleanText_(f.assignee, 20), due: cleanDate_(f.due) };
    const start = cleanDate_(f.start) || todayStr_();
    if (d.due && d.due < start) throw new Error('完成日不能早於開始日');
    const code = insertTask_(d.pid, cleanText_(f.parent, 40), {
      '專案編號': d.pid, '任務': title, '負責人': d.assignee, '完成日': d.due,
      '狀態': '未完成', '完成時間': '', '建立人': by, '建立時間': nowStr_(), '開始日': start, '權重': cleanWeight_(f.weight)
    });
    if (p['基準鎖定日']) logChange_(d.pid, code, '新增任務', '', title + '（' + start + ' → ' + (d.due || '未定') + '）', cleanText_(f.reason, 200), by);
    notifyAssignee_(by, code, d);
  });
}

function api_setTaskDone(code, done) {
  return webWrite_(function (me) {
    const t = rows_('T').filter(function (x) { return x['編號'] === code; })[0];
    if (!t) throw new Error('找不到任務 ' + code);
    if (!canToggleTask_(me, projectByCode_(t['專案編號']), t)) throw new Error('只有任務負責人、專案負責人或主管可以標記這個任務');
    if (isContainer_(t)) throw new Error('主任務會在底下的子任務全部完成後自動完成');
    if (done) taskDone_(t); else setCells_('T', t._row, { '狀態': '未完成', '完成時間': '' });
  });
}

/** 修改任務名稱、負責人、開始日、完成日（專案負責人或主管） */
function api_updateTask(code, f) {
  return webWrite_(function (me) {
    ensureHead_('T');
    const t = rows_('T').filter(function (x) { return x['編號'] === code; })[0];
    if (!t) throw new Error('找不到任務 ' + code);
    if (!canManageTasks_(me, projectByCode_(t['專案編號']))) throw new Error('只有專案負責人或主管可以修改任務');
    const title = cleanText_(f.title, 120);
    if (!title) throw new Error('請輸入任務內容');
    const start = cleanDate_(f.start), due = cleanDate_(f.due);
    if (start && due && due < start) throw new Error('完成日不能早於開始日');
    const cells = { '任務': title, '負責人': cleanText_(f.assignee, 20), '開始日': start, '完成日': due };
    if (f.weight !== undefined) cells['權重'] = cleanWeight_(f.weight);
    if (isContainer_(t)) { delete cells['開始日']; delete cells['完成日']; delete cells['權重']; f.actualStart = undefined; }   // 主任務的時程與權重由子任務彙總
    const p = projectByCode_(t['專案編號']);
    if (p && p['基準鎖定日'] && !isContainer_(t)) {   // 基準已鎖定：只有主管能改預定日期，且要填原因
      const curStart = t['開始日'] || String(t['建立時間'] || '').slice(0, 10);
      const ch = [];
      if (start !== curStart && !(start === '' && !t['開始日'])) ch.push(['預定開始日', curStart, start]);
      if (due !== (t['完成日'] || '')) ch.push(['預定完成日', t['完成日'] || '', due]);
      if (ch.length) {
        if (!isAdmin_(me)) throw new Error('這個專案已鎖定基準計畫，預定日期要由主管修改');
        const reason = cleanText_(f.reason, 200);
        if (!reason) throw new Error('這個專案已鎖定基準計畫，修改預定日期請填寫變更原因');
        ch.forEach(function (x) { logChange_(p['編號'], code, x[0], x[1], x[2], reason, me['姓名']); });
      }
    }
    if (f.actualStart !== undefined) {
      const as = cleanDate_(f.actualStart), ae = cleanDate_(f.actualEnd);
      if (as && ae && ae < as) throw new Error('實際完成日不能早於實際開始日');
      if (ae && ae > todayStr_()) throw new Error('實際完成日不能晚於今天');
      cells['實際開始日'] = as;
      const curEnd = t['狀態'] === '已完成' ? String(t['完成時間']).slice(0, 10) : '';
      if (ae !== curEnd) {
        if (ae) { cells['狀態'] = '已完成'; cells['完成時間'] = ae === todayStr_() ? nowStr_() : ae + ' 00:00'; }
        else { cells['狀態'] = '未完成'; cells['完成時間'] = ''; }
      }
    }
    setCells_('T', t._row, cells);
    if (cells['負責人'] !== (t['負責人'] || '') && cells['負責人']) {   // 在修改視窗換了負責人：一樣記錄並通知
      logChange_(t['專案編號'], code, '轉派負責人', t['負責人'] || '未指定', cells['負責人'], cleanText_(f.reason, 200), me['姓名']);
      notifyTransfer_(t, t['負責人'] || '', cells['負責人'], me['姓名'], '');
    }
  });
}

function api_deleteTask(code) {
  return webWrite_(function (me) {
    const t = rows_('T').filter(function (x) { return x['編號'] === code; })[0];
    if (!t) throw new Error('找不到任務 ' + code);
    if (!canManageTasks_(me, projectByCode_(t['專案編號']))) throw new Error('只有專案負責人或主管可以刪除任務');
    const it = itemOf_(t), rowsDel = [t._row].concat(it ? it.kids.map(function (k) { return k.t._row; }) : []);
    const p = projectByCode_(t['專案編號']);
    if (p && p['基準鎖定日']) logChange_(p['編號'], code, '刪除任務', t['任務'] + (it && it.kids.length ? '（含 ' + it.kids.length + ' 個子任務）' : ''), '', '', me['姓名']);
    rowsDel.sort(function (a, b) { return b - a; }).forEach(function (r) { sheet_('T').deleteRow(r); });
    delete _ROWS['T'];
    renumberTasks_(t['專案編號']);
  });
}

/** 轉派任務（任務負責人、專案負責人或主管） */
function api_transferTask(code, to, note) {
  return webWrite_(function (me) {
    const t = rows_('T').filter(function (x) { return x['編號'] === code; })[0];
    if (!t) throw new Error('找不到任務 ' + code);
    if (isContainer_(t)) throw new Error('主任務請轉派底下的子任務');
    if (!canToggleTask_(me, projectByCode_(t['專案編號']), t)) throw new Error('只有任務負責人、專案負責人或主管可以轉派這個任務');
    to = cleanText_(to, 20);
    if (!to || !memberByName_(to)) throw new Error('請選擇成員表裡的人');
    if (to === t['負責人']) throw new Error('負責人本來就是 ' + to);
    transferTask_(t, to, me['姓名'], cleanText_(note, 200));
  });
}

/** 記錄任務實際開始（任務負責人、專案負責人或主管） */
function api_startTask(code) {
  return webWrite_(function (me) {
    ensureHead_('T');
    const t = rows_('T').filter(function (x) { return x['編號'] === code; })[0];
    if (!t) throw new Error('找不到任務 ' + code);
    if (isContainer_(t)) throw new Error('主任務會依子任務自動計算');
    if (!canToggleTask_(me, projectByCode_(t['專案編號']), t)) throw new Error('只有任務負責人、專案負責人或主管可以操作這個任務');
    if (t['狀態'] === '已完成') throw new Error('這個任務已經完成了');
    startTask_(t);
  });
}
/** 回報任務完成度（0～100；100＝完成） */
function api_setProgress(code, pct) {
  return webWrite_(function (me) {
    ensureHead_('T');
    const t = rows_('T').filter(function (x) { return x['編號'] === code; })[0];
    if (!t) throw new Error('找不到任務 ' + code);
    if (isContainer_(t)) throw new Error('主任務會依子任務自動計算');
    if (!canToggleTask_(me, projectByCode_(t['專案編號']), t)) throw new Error('只有任務負責人、專案負責人或主管可以回報這個任務');
    const n = Number(pct);
    if (isNaN(n) || n < 0 || n > 100) throw new Error('完成度請填 0～100');
    saveProgress_(t, n);
  });
}
/** 鎖定基準計畫（主管）：把目前的預定日期存成基準；之後改預定日期要填原因並留紀錄 */
function api_lockBaseline(code, reason) {
  return webWrite_(function (me) {
    if (!isAdmin_(me)) throw new Error('只有主管可以鎖定基準計畫');
    ensureHead_('P'); ensureHead_('T');
    const p = projectByCode_(code);
    if (!p) throw new Error('找不到專案 ' + code);
    if (!p['截止日']) throw new Error('請先設定預定結案日再鎖定基準');
    const relock = !!p['基準鎖定日'];
    reason = cleanText_(reason, 200);
    if (relock && !reason) throw new Error('重新鎖定基準請填寫原因');
    const items = tree_().byP[p['編號']] || [], want = {};
    items.forEach(function (it) { if (!it.kids.length) want[it.t._row] = [it.ps, it.pe]; });
    setColumn_('T', '基準開始日', function (r) { return want[r._row] ? want[r._row][0] : undefined; });
    setColumn_('T', '基準完成日', function (r) { return want[r._row] ? want[r._row][1] : undefined; });
    setCells_('P', p._row, { '基準開始日': p['開始日'], '基準結案日': p['截止日'], '基準鎖定日': todayStr_(), '基準鎖定人': me['姓名'] });
    logChange_(p['編號'], '', relock ? '重新鎖定基準' : '鎖定基準',
      relock ? (p['基準開始日'] || '') + '～' + (p['基準結案日'] || '') : '', (p['開始日'] || '') + '～' + p['截止日'] + '（任務 ' + Object.keys(want).length + ' 項）', reason, me['姓名']);
  });
}
function logChange_(pid, tcode, item, oldV, newV, reason, by) {
  append_('C', { '時間': nowStr_(), '專案編號': pid, '任務編號': tcode || '', '項目': item, '原值': oldV || '', '新值': newV || '', '原因': reason || '', '修改人': by || '' });
}

/** 調整任務順序與層級 */
function api_moveTask(code, op) {
  let msg = '';
  const data = webWrite_(function (me) {
    if (['up', 'down', 'indent', 'outdent'].indexOf(op) < 0) throw new Error('不支援的操作');
    const t = rows_('T').filter(function (x) { return x['編號'] === code; })[0];
    if (!t) throw new Error('找不到任務 ' + code);
    if (!canManageTasks_(me, projectByCode_(t['專案編號']))) throw new Error('只有專案負責人或主管可以調整任務');
    msg = moveTask_(t, op);
  });
  if (msg) throw new Error(msg);
  return data;
}

/** 刪除專案（主管）：連同任務、每週更新、試驗單與檔案紀錄；雲端資料夾裡的檔案保留 */
function api_deleteProject(code) {
  return webWrite_(function (me) {
    const p = projectByCode_(code);
    if (!p) throw new Error('找不到專案 ' + code);
    if (!isAdmin_(me) && !(isPending_(p) && p['申請人'] === me['姓名'])) throw new Error('只有主管可以刪除專案（成員可以刪除自己還沒核准的申請）');
    ['T', 'U', 'E', 'F', 'C'].forEach(function (k) {
      rows_(k).filter(function (r) { return r['專案編號'] === p['編號']; }).map(function (r) { return r._row; })
        .sort(function (a, b) { return b - a; }).forEach(function (r) { sheet_(k).deleteRow(r); });
      delete _ROWS[k];
    });
    deleteRow_('P', p._row);
  });
}
function cleanWeight_(v) { const n = Number(v); return String(isNaN(n) || n < 0 || String(v).trim() === '' ? 1 : Math.min(100, Math.round(n * 10) / 10)); }
/** 權重（%）平均分配：專案所有子任務合計 100%，到小數一位，尾數補在最後一項 */
function api_equalWeights(pid) {
  return webWrite_(function (me) {
    const p = projectByCode_(pid);
    if (!p) throw new Error('找不到專案 ' + pid);
    if (!canManageTasks_(me, p)) throw new Error('只有專案負責人或主管可以調整權重');
    const leaves = (tree_().byP[p['編號']] || []).filter(function (it) { return !it.kids.length; });
    if (!leaves.length) throw new Error('這個專案還沒有任務');
    const each = Math.floor(1000 / leaves.length) / 10, want = {};
    leaves.forEach(function (it, i) { want[it.t._row] = String(i === leaves.length - 1 ? Math.round((100 - each * (leaves.length - 1)) * 10) / 10 : each); });
    setColumn_('T', '權重', function (r) { return want[r._row]; });
  });
}

function api_addUpdate(f) {
  return webWrite_(function (me) {
    const p = projectByCode_(f.pid);
    if (!p) throw new Error('找不到專案 ' + f.pid);
    if (!canUpdate_(me, p)) throw new Error('只有專案負責人、參與成員或主管可以更新這個專案');
    const by = me['姓名'];
    const d = { done: cleanText_(f.done, 800), next: cleanText_(f.next, 800), blocker: cleanText_(f.blocker, 800) };
    if (!d.done && !d.next && !d.blocker) throw new Error('請至少填寫一項：本週完成、下週計畫或卡關');
    const status = metrics_(p).light;
    const stage = !hasHier_(p) && stagesOf_(p).indexOf(f.stage) >= 0 ? f.stage : curStage_(p);
    append_('U', {
      '時間': nowStr_(), '專案編號': p['編號'], '填寫人': by, '燈號': status, '階段': stage,
      '本週完成': d.done, '下週計畫': d.next, '卡關事項': d.blocker
    });
    setCells_('P', p._row, Object.assign({ '燈號': status, '階段': stage, '卡關事項': d.blocker, '最近更新': nowStr_() }, autoDates_(p, stage)));
  });
}

/** 新增或修改研究試驗單（f.code 有值就是修改） */
function api_saveTest(f) {
  return webWrite_(function (me) {
    const p = projectByCode_(f.pid);
    if (!p) throw new Error('找不到專案 ' + f.pid);
    if (!canUpdate_(me, p)) throw new Error('只有專案負責人、參與成員或主管可以填寫研究試驗單');
    ensureHead_('E');
    const name = cleanText_(f.name, 80);
    if (!name) throw new Error('請輸入試驗名稱');
    const data = {
      '試驗名稱': name, '試驗日期': cleanDate_(f.date) || todayStr_(), '試驗人員': cleanText_(f.tester, 40) || me['姓名'],
      '試驗目的': cleanText_(f.purpose, 800), '試驗條件與參數': cleanText_(f.param, 1500), '試驗結果': cleanText_(f.result, 1500),
      '判定': TEST_RESULTS.indexOf(f.judge) >= 0 ? f.judge : '待判定'
    };
    if (f.code) {
      const e = rows_('E').filter(function (x) { return x['試驗單編號'] === f.code; })[0];
      if (!e || e['專案編號'] !== p['編號']) throw new Error('找不到試驗單 ' + f.code);
      setCells_('E', e._row, data);
    } else {
      data['試驗單編號'] = nextTestCode_(p['編號']); data['專案編號'] = p['編號'];
      data['附件'] = ''; data['建立人'] = me['姓名']; data['建立時間'] = nowStr_();
      append_('E', data);
    }
  });
}
function api_deleteTest(code) {
  return webWrite_(function (me) {
    const e = rows_('E').filter(function (x) { return x['試驗單編號'] === code; })[0];
    if (!e) throw new Error('找不到試驗單 ' + code);
    if (!canManageTasks_(me, projectByCode_(e['專案編號']))) throw new Error('只有專案負責人或主管可以刪除試驗單');
    deleteRow_('E', e._row);
  });
}

// ----- 單位管理（只有管理員） -----
function unitUsage_() {
  const n = {};
  rows_('P').forEach(function (p) { const d = p['部門'] || deptOfCode_(p['編號']); if (d) n[d] = (n[d] || 0) + 1; });
  return n;
}
function unitsForAdmin_() {
  depts_();
  const used = unitUsage_();
  return rows_('D').filter(function (d) { return d['代碼']; }).map(function (d) {
    const c = normCode_(d['代碼']);
    return { code: c, name: d['單位名稱'], parent: d['上層部門'], order: d['排序'], active: d['啟用'] !== '否', manager: d['主管'] || '', used: used[c] || 0 };
  }).sort(function (a, b) { return (Number(a.order) || 999) - (Number(b.order) || 999); });
}
/** 整份單位表一次存回；用過的代碼不能刪除或改代碼（可以停用、改名稱） */
function api_saveUnits(list) {
  return webWrite_(function (me) {
    if (!isOwner_(me)) throw new Error('只有管理員可以修改單位');
    if (!Array.isArray(list) || !list.length) throw new Error('單位表不能是空的');
    const old = {}, used = unitUsage_();
    rows_('D').forEach(function (d) { old[normCode_(d['代碼'])] = d['單位名稱']; });
    const seen = {}, names = {};
    const rows = list.map(function (u, i) {
      const code = normCode_(u.code), name = cleanText_(u.name, 30);
      if (!/^[A-Z][A-Z0-9]{1,3}$/.test(code)) throw new Error('代碼「' + (u.code || '') + '」格式不對：請用 2～4 個英文或數字，第一個字是英文');
      if (seen[code]) throw new Error('代碼 ' + code + ' 重複了');
      if (!name) throw new Error('代碼 ' + code + ' 沒有填單位名稱');
      if (names[name]) throw new Error('單位名稱「' + name + '」重複了');
      seen[code] = 1; names[name] = 1;
      const od = String(u.order == null ? '' : u.order).replace(/\D/g, '').slice(-3);
      const mgr = cleanText_(u.manager, 20);
      if (mgr && !memberByName_(mgr)) throw new Error(name + ' 的主管「' + mgr + '」不在成員表裡');
      return { code: code, name: name, parent: cleanText_(u.parent, 30), order: od ? od.padStart(3, '0') : String((i + 1) * 10).padStart(3, '0'), active: u.active === false ? '否' : '是', manager: mgr };
    });
    Object.keys(used).forEach(function (c) { if (old[c] !== undefined && !seen[c]) throw new Error('單位 ' + c + '（' + old[c] + '）已經有 ' + used[c] + ' 個案件，不能刪除；不再使用請改成停用'); });
    // 部門改名時，底下單位的「上層部門」一起改
    const renamed = {};
    rows.forEach(function (r) { if (old[r.code] && old[r.code] !== r.name) renamed[old[r.code]] = r.name; });
    rows.forEach(function (r) {
      if (renamed[r.parent]) r.parent = renamed[r.parent];
      if (r.parent && (!names[r.parent] || r.parent === r.name)) throw new Error(r.name + ' 的上層部門「' + r.parent + '」不在單位表裡');
    });
    ensureHead_('D');
    const sh = sheet_('D'), last = sh.getLastRow();
    if (last > 1) sh.getRange(2, 1, last - 1, 6).clearContent();
    sh.getRange(2, 1, rows.length, 6).setValues(rows.map(function (r) { return [r.code, r.name, r.parent, r.order, r.active, r.manager]; }));
    delete _ROWS['D']; _DEPTS = null;
  });
}

// ===== 成員管理（管理員）：姓名、角色、公司信箱、接收提醒；改名時連同所有資料一起改 =====
const ROLES = ['成員', '主管', '管理員'];
function memberUsage_() {
  const u = {};
  function add(n) { n = String(n || '').trim(); if (n) u[n] = (u[n] || 0) + 1; }
  rows_('P').forEach(function (p) { add(p['負責人']); splitNames_(p['參與成員']).forEach(add); });
  rows_('T').forEach(function (t) { if (t['狀態'] !== '已完成') add(t['負責人']); });
  return u;
}
function membersForAdmin_() {
  ensureHead_('M');
  const used = memberUsage_();
  return rows_('M').filter(function (m) { return m['姓名']; }).map(function (m) {
    return { key: m['姓名'], name: m['姓名'], role: ROLES.indexOf(m['角色']) >= 0 ? m['角色'] : '成員', email: m['公司信箱'] || '',
      remind: m['接收提醒'] !== '否', bound: !!m['LINE userId'], used: used[m['姓名']] || 0 };
  });
}
/** 成員改名：所有用到名字的地方一起改 */
function renameMember_(old, nu) {
  function same(v) { return v === old ? nu : undefined; }
  [['P', '負責人'], ['P', '基準鎖定人'], ['P', '申請人'], ['P', '核准人'], ['T', '負責人'], ['T', '建立人'], ['U', '填寫人'], ['F', '上傳人'], ['E', '試驗人員'], ['E', '建立人'],
   ['R', '提出人'], ['R', '處理人'], ['C', '修改人'], ['D', '主管']].forEach(function (x) {
    try { setColumn_(x[0], x[1], function (r) { return same(r[x[1]]); }); } catch (e) { console.error('改名略過', x, e); }
  });
  setColumn_('P', '參與成員', function (p) { const a = splitNames_(p['參與成員']); return a.indexOf(old) >= 0 ? a.map(function (n) { return n === old ? nu : n; }).join('、') : undefined; });
  try { setColumn_('C', '原值', function (c) { return c['項目'] === '轉派負責人' ? same(c['原值']) : undefined; }); setColumn_('C', '新值', function (c) { return c['項目'] === '轉派負責人' ? same(c['新值']) : undefined; }); } catch (e) {}
}
function api_saveMembers(list) {
  return webWrite_(function (me) {
    if (!isOwner_(me)) throw new Error('只有管理員可以修改成員');
    ensureHead_('M');
    if (!Array.isArray(list)) throw new Error('資料格式不對');
    const cur = {}; rows_('M').forEach(function (m) { if (m['姓名']) cur[m['姓名']] = m; });
    const used = memberUsage_(), seen = {}, keep = {};
    const items = list.map(function (x) {
      const name = cleanText_(x.name, 20).replace(/\s+/g, ' ');
      if (!name) throw new Error('有一列沒有填姓名');
      if (/[、,，\/]/.test(name)) throw new Error('姓名「' + name + '」不能含有頓號、逗號或斜線');
      if (seen[name]) throw new Error('姓名「' + name + '」重複了');
      seen[name] = 1;
      const email = cleanText_(x.email, 80).toLowerCase();
      if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new Error(name + ' 的公司信箱格式不對');
      if (x.key && !cur[x.key]) throw new Error('找不到成員「' + x.key + '」，請重新整理頁面');
      if (x.key) keep[x.key] = 1;
      return { key: x.key || '', name: name, role: ROLES.indexOf(x.role) >= 0 ? x.role : '成員', email: email, remind: x.remind === false ? '否' : '是' };
    });
    if (!items.some(function (x) { return x.role === '管理員'; })) throw new Error('至少要保留一位管理員');
    Object.keys(cur).forEach(function (n) {
      if (keep[n]) return;
      if (cur[n]['LINE userId']) throw new Error(n + ' 已經綁定 LINE，不能從這裡刪除');
      if (used[n]) throw new Error(n + ' 還有 ' + used[n] + ' 筆專案或任務，不能刪除');
    });
    items.forEach(function (x) { if (x.key && x.key !== x.name && cur[x.name] && keep[x.name]) throw new Error('「' + x.name + '」已經是另一位成員的名字'); });
    // 先改名（連同各表資料），再寫回成員表
    items.forEach(function (x) { if (x.key && x.key !== x.name) renameMember_(x.key, x.name); });
    const rows = rows_('M');
    items.forEach(function (x) {
      const r = x.key ? rows.filter(function (m) { return m._row === cur[x.key]._row; })[0] : null;
      const data = { '姓名': x.name, '角色': x.role, '公司信箱': x.email, '接收提醒': x.remind };
      if (r) setCells_('M', r._row, data); else append_('M', Object.assign({ 'LINE userId': '', '綁定時間': '' }, data));
    });
    Object.keys(cur).filter(function (n) { return !keep[n]; }).map(function (n) { return cur[n]._row; })
      .sort(function (a, b) { return b - a; }).forEach(function (r) { sheet_('M').deleteRow(r); });
    delete _ROWS['M'];
  });
}

/** 主管在儀表板按「重新檢查」：測試 LINE 金鑰，正常就清除警告 */
function api_checkLine() {
  const u = webUser_();
  if (!isAdmin_(u.member)) throw new Error('只有主管可以檢查 LINE 連線');
  const res = UrlFetchApp.fetch('https://api.line.me/v2/bot/info', { headers: { Authorization: 'Bearer ' + token_() }, muteHttpExceptions: true });
  noteAuth_(res.getResponseCode());
  if (res.getResponseCode() !== 200) throw new Error('LINE 金鑰仍然無效（' + res.getResponseCode() + '），請確認指令碼屬性 LINE_TOKEN 已更新並儲存');
  return dashboardData_(webUser_());
}

/** 網頁送出意見回饋（尚未登記在成員表的人也可以送，用信箱當提出人） */
// ===== 專案資料（網頁上傳：客戶需求、圖面…） =====
/** 專案資料夾底下的分類子資料夾 */
function projectSubFolder_(p, cat) {
  const folder = projectFolder_(p), it = folder.getFoldersByName(cat);
  return it.hasNext() ? it.next() : folder.createFolder(cat);
}
/** 讓專案相關的人（負責人、參與成員、主管）可以檢視專案資料夾（用成員表的公司信箱） */
function shareProjectFolder_(p, folder) {
  const names = uniq_([p['負責人']].concat(splitNames_(p['參與成員'])));
  const cur = {};
  try { folder.getViewers().concat(folder.getEditors()).forEach(function (u) { cur[String(u.getEmail()).toLowerCase()] = 1; }); } catch (e) {}
  rows_('M').filter(function (m) { return m['公司信箱'] && (isAdmin_(m) || names.indexOf(m['姓名']) >= 0); }).forEach(function (m) {
    const em = String(m['公司信箱']).toLowerCase();
    if (cur[em]) return;
    try { folder.addViewer(em); } catch (e) { console.error('分享資料夾失敗', em, e); }
  });
}
/** 上傳一個檔案（base64）到專案資料夾；一次一個檔案 */
function api_uploadFile(pid, f) {
  return webWrite_(function (me) {
    const p = projectByCode_(pid);
    if (!p) throw new Error('找不到專案 ' + pid);
    if (!canUpdate_(me, p)) throw new Error('只有專案負責人、參與成員或主管可以上傳專案資料');
    const name = cleanText_(f.name, 150).replace(/[\\/:*?"<>|]/g, '_');
    if (!name || !f.b64) throw new Error('沒有收到檔案');
    const bytes = Utilities.base64Decode(f.b64);
    if (bytes.length > FILE_MAX_MB * 1024 * 1024) throw new Error('檔案超過 ' + FILE_MAX_MB + ' MB：' + name);
    const cat = FILE_CATS.indexOf(f.cat) >= 0 ? f.cat : '其他';
    ensureHead_('F');
    const file = projectSubFolder_(p, cat).createFile(Utilities.newBlob(bytes, cleanText_(f.mime, 100) || 'application/octet-stream', name));
    append_('F', { '時間': nowStr_(), '專案編號': p['編號'], '上傳人': me['姓名'], '檔案連結': file.getUrl(), '檔名': name, '分類': cat, '說明': cleanText_(f.note, 200) });
    shareProjectFolder_(p, projectFolder_(p));
  });
}
/** 修改檔案的分類或說明（上傳人、專案負責人或主管） */
function api_updateFile(url, f) {
  return webWrite_(function (me) {
    ensureHead_('F');
    const r = rows_('F').filter(function (x) { return x['檔案連結'] === url; })[0];
    if (!r) throw new Error('找不到這個檔案');
    const p = projectByCode_(r['專案編號']);
    if (!(r['上傳人'] === me['姓名'] || canManageTasks_(me, p))) throw new Error('只有上傳的人、專案負責人或主管可以修改');
    setCells_('F', r._row, { '分類': FILE_CATS.indexOf(f.cat) >= 0 ? f.cat : (r['分類'] || '其他'), '說明': cleanText_(f.note, 200) });
  });
}
/** 刪除檔案：雲端硬碟裡的檔案移到垃圾桶（30 天內可復原），並移除紀錄 */
function api_deleteFile(url) {
  return webWrite_(function (me) {
    const r = rows_('F').filter(function (x) { return x['檔案連結'] === url; })[0];
    if (!r) throw new Error('找不到這個檔案');
    const p = projectByCode_(r['專案編號']);
    if (!(r['上傳人'] === me['姓名'] || canManageTasks_(me, p))) throw new Error('只有上傳的人、專案負責人或主管可以刪除');
    const id = (String(url).match(/[-\w]{25,}/) || [])[0];
    if (id) { try { DriveApp.getFileById(id).setTrashed(true); } catch (e) { console.error('移到垃圾桶失敗', e); } }
    deleteRow_('F', r._row);
  });
}
/** 專案雲端資料夾網址（點「開啟雲端資料夾」時才查，並確保相關成員可以檢視） */
function api_projectFolderUrl(pid) {
  const u = webUser_(), p = projectByCode_(pid);
  if (!p) throw new Error('找不到專案 ' + pid);
  if (!u.member) throw new Error('你的帳號還沒登記在成員表');
  const folder = projectFolder_(p);
  if (canUpdate_(u.member, p)) shareProjectFolder_(p, folder);
  return folder.getUrl();
}

function api_addFeedback(f) {
  const u = webUser_();
  const type = FB_TYPES.indexOf(f.type) >= 0 ? f.type : '建議';
  const content = cleanText_(f.content, 1500);
  if (!content) throw new Error('請填寫內容');
  saveFeedback_({ type: type, content: content, files: [] }, u.member ? u.member['姓名'] : u.email, '網頁');
  flushAfter_();
  return dashboardData_(webUser_());
}

/** 主管更新處理狀態與回覆；有變動時用 LINE 通知提出人 */
function api_updateFeedback(code, f) {
  return webWrite_(function (me) {
    if (!isAdmin_(me)) throw new Error('只有主管可以處理意見回饋');
    ensureHead_('R');
    const r = rows_('R').filter(function (x) { return x['編號'] === code; })[0];
    if (!r) throw new Error('找不到 ' + code);
    const status = FB_STATUS.indexOf(f.status) >= 0 ? f.status : (r['狀態'] || '待處理');
    const replyTxt = cleanText_(f.reply, 800);
    if (status === r['狀態'] && replyTxt === r['處理回覆']) return;
    setCells_('R', r._row, { '狀態': status, '處理回覆': replyTxt, '處理人': me['姓名'], '處理時間': nowStr_() });
    const who = memberByName_(r['提出人']);
    if (who && who['姓名'] !== me['姓名'] && who['LINE userId']) {
      pushLater_(who['LINE userId'], txt_('💬 你的' + (r['類型'] === '錯誤' ? '錯誤回報' : '建議') + ' ' + code + ' 有新進度\n狀態：' + status +
        (replyTxt ? '\n' + me['姓名'] + ' 回覆：' + replyTxt : '') + '\n\n原內容：' + cut_(r['內容'], 100), [qPost_('我的回饋', 'cmd:我的回饋', '我的回饋')]));
    }
  });
}

// =====================================================================
// 十、權限規則（LINE 與網頁共用）
// =====================================================================
function isAdmin_(m) { return !!m && (m['角色'] === '管理員' || m['角色'] === '主管'); }
/** 系統管理員（成員表角色＝管理員）：可以修改單位表 */
function isOwner_(m) { return !!m && m['角色'] === '管理員'; }
function canManageTasks_(m, p) { if (isPending_(p)) return false; return isAdmin_(m) || (!!m && !!p && p['負責人'] === m['姓名']); }
function canUpdate_(m, p) { if (isPending_(p)) return false; return canManageTasks_(m, p) || (!!m && !!p && splitNames_(p['參與成員']).indexOf(m['姓名']) >= 0); }
function canToggleTask_(m, p, t) { if (isPending_(p)) return false; return canManageTasks_(m, p) || (!!m && !!t && t['負責人'] === m['姓名']); }

// ----- 專案核准：成員開的專案由提案單位的主管核准（待核准、退回的專案還不能新增任務、更新、上傳） -----
function isPending_(p) { return !!p && (p['核准狀態'] === '待核准' || p['核准狀態'] === '退回'); }
/** 核准人：提案單位「主管」欄 → 沒填（或就是申請人自己）就往上層部門找 → 都沒有就由管理員核准 */
function approversFor_(p) {
  const rows = rows_('D'), code = normCode_(p['部門'] || deptOfCode_(p['編號'])), applicant = p['申請人'] || '';
  let row = rows.filter(function (d) { return normCode_(d['代碼']) === code; })[0], guard = 0;
  while (row && guard++ < 6) {
    const mg = splitNames_(row['主管']).filter(function (n) { return n !== applicant && memberByName_(n); });
    if (mg.length) return mg;
    const par = row['上層部門'];
    row = par ? rows.filter(function (d) { return d['單位名稱'] === par; })[0] : null;
  }
  return rows_('M').filter(function (m) { return isOwner_(m) && m['姓名'] !== applicant; }).map(function (m) { return m['姓名']; });
}
function canApprove_(m, p) { return !!m && isPending_(p) && (isOwner_(m) || approversFor_(p).indexOf(m['姓名']) >= 0); }
/** 待核准／退回的專案：只有申請人、負責人、核准人、管理員看得到 */
function canSeeProject_(m, p) {
  if (!isPending_(p)) return true;
  return !!m && (isOwner_(m) || p['申請人'] === m['姓名'] || p['負責人'] === m['姓名'] || approversFor_(p).indexOf(m['姓名']) >= 0);
}
function notifyApprovers_(p, resubmit) {
  const names = approversFor_(p);
  const msg = '📝 ' + (p['申請人'] || '') + (resubmit ? ' 修改後重新送出專案申請' : ' 申請開立新專案') + '，請你核准\n\n' + p['編號'] + ' ' + p['專案名稱'] +
    '\n提案單位：' + (depts_()[p['部門']] || p['部門'] || '未指定') + '\n類型：' + (p['類型'] || '開發') + '\n負責人：' + (p['負責人'] || '未指定') +
    (p['參與成員'] ? '\n成員：' + p['參與成員'] : '') + (p['截止日'] ? '\n預定結案：' + p['截止日'] : '') +
    (p['目的與預期成果'] ? '\n目的：' + cut_(p['目的與預期成果'], 200) : '') + '\n\n也可以到網頁儀表板查看後核准。';
  names.forEach(function (n) {
    const m = memberByName_(n);
    if (m && m['LINE userId'] && m['接收提醒'] !== '否')
      pushLater_(m['LINE userId'], txt_(msg, [qPost_('✅ 核准', 'pa:' + p['編號'], '核准 ' + p['編號']), qPost_('↩ 退回', 'pr:' + p['編號'], '退回 ' + p['編號'])]));
  });
  return names;
}
function approveProject_(p, me) {
  const old = p['核准狀態'] || '';
  setCells_('P', p._row, { '核准狀態': '已核准', '核准人': me['姓名'], '核准時間': nowStr_(), '退回原因': '' });
  logChange_(p['編號'], '', '專案核准', old, '已核准', '', me['姓名']);
  const head = p['編號'] + ' ' + p['專案名稱'];
  uniq_([p['申請人'], p['負責人']].concat(splitNames_(p['參與成員']))).forEach(function (n) {
    const m = memberByName_(n);
    if (!m || n === me['姓名'] || !m['LINE userId'] || m['接收提醒'] === '否') return;
    pushLater_(m['LINE userId'], txt_('✅ ' + me['姓名'] + ' 已核准專案\n' + head + (n === p['負責人'] ? '\n\n你是專案負責人，可以開始新增任務了。' : '\n\n你是這個專案的成員。'),
      [qPost_('新增任務', 'cmd:新增任務', '新增任務'), qPost_('專案總覽', 'cmd:專案總覽', '專案總覽')]));
  });
}
function rejectProject_(p, me, reason) {
  setCells_('P', p._row, { '核准狀態': '退回', '核准人': me['姓名'], '核准時間': nowStr_(), '退回原因': reason });
  logChange_(p['編號'], '', '專案退回', '待核准', '退回', reason, me['姓名']);
  const m = memberByName_(p['申請人']);
  if (m && m['姓名'] !== me['姓名'] && m['LINE userId'] && m['接收提醒'] !== '否')
    pushLater_(m['LINE userId'], txt_('↩ ' + me['姓名'] + ' 退回了你的專案申請\n' + p['編號'] + ' ' + p['專案名稱'] + (reason ? '\n原因：' + reason : '') + '\n\n可以到網頁儀表板修改後重新送出，或刪除這個申請。'));
}
/** LINE：核准人按「核准／退回」 */
function approveLine_(uid, rt, me, act, code) {
  const p = projectByCode_(code);
  if (!p) return reply_(rt, menu_('找不到專案 ' + code + '，可能已經被刪除了。'));
  if (p['核准狀態'] !== '待核准') return reply_(rt, menu_(code + ' 目前不是待核准狀態（' + (p['核准狀態'] || '已成立') + '）。'));
  if (!canApprove_(me, p)) return reply_(rt, menu_('你不是 ' + code + ' 的核准人。'));
  if (act === 'pa') {
    let msg = '';
    withLock_(function () {
      const f = projectByCode_(code);
      if (!f || f['核准狀態'] !== '待核准') { msg = code + ' 已經處理過了。'; return; }
      approveProject_(f, me);
      msg = '✅ 已核准 ' + code + ' ' + f['專案名稱'] + '\n已通知申請人與專案成員。';
    });
    return reply_(rt, menu_(msg));
  }
  setState_(uid, { flow: 'prej', step: 'reason', d: { code: code } });
  return reply_(rt, txt_('↩ 退回 ' + code + ' ' + p['專案名稱'] + '\n請輸入退回原因（申請人會看到）：', [qMsg_('取消', '取消')]));
}
function canFlow_(flow, m, p) { return canUpdate_(m, p); }   // 新增任務：專案負責人、參與成員、主管都可以
