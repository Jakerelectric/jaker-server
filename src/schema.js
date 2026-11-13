'use strict';
/**
 * 資料表欄位定義：表頭（中文）→ 欄位名稱（英文）＋型別。
 * 中文表頭會寫在欄位註解（COMMENT），phpMyAdmin 看得到。
 * 沒列在這裡的表頭：欄位名稱用 col_N、型別 VARCHAR(255)。
 * 型別只是起點：遇到放不下的資料（例如日期欄填了文字、文字超過長度），
 * 系統會自動把欄位放寬一級並記錄在 server.log，不會截斷或遺失資料。
 */

/** 工作表 → 資料表名稱 */
const TABLE_NAMES = {
  '專案': 'pm_projects', '任務': 'pm_tasks', '每週更新': 'pm_updates', '照片': 'pm_files', '成員': 'pm_members',
  '意見回饋': 'pm_feedback', '研究試驗單': 'pm_tests', '單位': 'pm_units', '變更紀錄': 'pm_changes'
};

const V = n => 'VARCHAR(' + n + ')';
const NAME = V(50), CODE = V(40), SHORT = V(20), YESNO = V(4);

/** 各表共用的表頭定義：[欄位名稱, 型別, 建索引] */
const COMMON = {
  '編號': ['code', CODE, 1],
  '專案編號': ['project_code', CODE, 1],
  '負責人': ['owner', NAME, 1],
  '狀態': ['status', SHORT, 1],
  '階段': ['stage', SHORT],
  '燈號': ['light', V(10)],
  '類型': ['type', SHORT],
  '開始日': ['start_date', 'DATE'],
  '截止日': ['due_date', 'DATE'],
  '卡關事項': ['blockers', 'TEXT'],
  '建立時間': ['created_at', 'DATETIME'],
  '建立人': ['created_by', NAME],
  '時間': ['created_at', 'DATETIME', 1],
  '附件': ['attachment', V(1000)],
  '說明': ['note', 'TEXT'],
  '內容': ['content', 'TEXT'],
  '原因': ['reason', 'TEXT'],
  '排序': ['sort_order', 'INT']
};

/** 各表自己的表頭（同名時優先於 COMMON） */
const TABLES = {
  pm_projects: {
    '專案名稱': ['name', V(200)], '目的與預期成果': ['purpose', 'TEXT'], '參與成員': ['members', V(500)],
    '最近更新': ['last_update', 'DATETIME'], '部門': ['dept', SHORT, 1], '產品規格': ['spec', 'TEXT'],
    '實際開案日': ['actual_open_date', 'DATE'], '實際結案日': ['actual_close_date', 'DATE'],
    '基準開始日': ['baseline_start', 'DATE'], '基準結案日': ['baseline_end', 'DATE'],
    '基準鎖定日': ['baseline_locked_date', 'DATE'], '基準鎖定人': ['baseline_locked_by', NAME],
    '核准狀態': ['approval_status', SHORT, 1], '申請人': ['applicant', NAME], '核准人': ['approver', NAME],
    '核准時間': ['approved_at', 'DATETIME'], '退回原因': ['reject_reason', 'TEXT']
  },
  pm_tasks: {
    '任務': ['title', V(200)], '完成日': ['end_date', 'DATE', 1], '完成時間': ['done_at', 'DATETIME'],
    '實際開始日': ['actual_start', 'DATE'], '層級': ['level', 'TINYINT'], '權重': ['weight', 'DOUBLE'],
    '完成度': ['progress', 'DOUBLE'], '進度回報日': ['progress_date', 'DATE'], '提醒延後至': ['snooze_until', 'DATE'],
    '基準開始日': ['baseline_start', 'DATE'], '基準完成日': ['baseline_end', 'DATE'],
    '申請完成日': ['done_request_date', 'DATE'], '確認人': ['confirmed_by', NAME]
  },
  pm_updates: { '填寫人': ['author', NAME, 1], '本週完成': ['done_this_week', 'TEXT'], '下週計畫': ['plan_next_week', 'TEXT'] },
  pm_files: { '上傳人': ['uploader', NAME, 1], '檔案連結': ['file_url', V(500)], '檔名': ['file_name', V(255)], '分類': ['category', SHORT] },
  pm_members: {
    '姓名': ['name', NAME, 1], 'LINE userId': ['line_user_id', V(64), 1], '角色': ['role', SHORT],
    '綁定時間': ['bound_at', 'DATETIME'], '接收提醒': ['notify', YESNO], '公司信箱': ['email', V(100), 1]
  },
  pm_feedback: {
    '提出人': ['reporter', NAME, 1], '來源': ['source', SHORT], '處理回覆': ['reply', 'TEXT'],
    '處理人': ['handler', NAME], '處理時間': ['handled_at', 'DATETIME']
  },
  pm_units: { '代碼': ['code', SHORT, 1], '單位名稱': ['name', NAME], '上層部門': ['parent', NAME], '啟用': ['enabled', YESNO], '主管': ['manager', NAME] },
  pm_changes: { '任務編號': ['task_code', CODE, 1], '項目': ['field', NAME], '原值': ['old_value', 'TEXT'], '新值': ['new_value', 'TEXT'], '修改人': ['changed_by', NAME] },
  pm_tests: {
    '試驗單編號': ['code', CODE, 1], '試驗名稱': ['title', V(200)], '試驗日期': ['test_date', 'DATE'], '試驗人員': ['tester', V(100)],
    '試驗目的': ['purpose', 'TEXT'], '試驗條件與參數': ['conditions', 'TEXT'], '試驗結果': ['result', 'TEXT'], '判定': ['verdict', SHORT]
  }
};

function defFor(tbl, header) {
  const h = String(header == null ? '' : header).trim();
  const d = (TABLES[tbl] && TABLES[tbl][h]) || COMMON[h];
  return d ? { col: d[0], type: d[1], index: !!d[2] } : null;
}

// ---------- 型別：檢查、轉換、放寬 ----------
const pad = n => (n < 10 ? '0' : '') + n;
function parseDate(s) {
  const m = /^(\d{4})[-\/.](\d{1,2})[-\/.](\d{1,2})$/.exec(s);
  if (!m) return null;
  const y = +m[1], mo = +m[2], d = +m[3];
  const t = new Date(Date.UTC(y, mo - 1, d));
  if (t.getUTCFullYear() !== y || t.getUTCMonth() !== mo - 1 || t.getUTCDate() !== d || y < 1000) return null;
  return y + '-' + pad(mo) + '-' + pad(d);
}
function parseDateTime(s) {
  const m = /^(\d{4}[-\/.]\d{1,2}[-\/.]\d{1,2})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?$/.exec(s);
  if (!m) return null;
  const d = parseDate(m[1]);
  if (!d) return null;
  const h = m[2] == null ? 0 : +m[2], mi = m[3] == null ? 0 : +m[3], se = m[4] == null ? 0 : +m[4];
  if (h > 23 || mi > 59 || se > 59) return null;
  return { mem: d + ' ' + pad(h) + ':' + pad(mi) + (se ? ':' + pad(se) : ''), db: d + ' ' + pad(h) + ':' + pad(mi) + ':' + pad(se) };
}
const NUM_RE = /^-?(\d+(\.\d*)?|\.\d+)([eE][-+]?\d+)?$/;
const chars = s => [...s].length;

/**
 * 字串 → 這個型別在資料庫要存的值，以及記憶體裡的標準寫法。放不下就回傳 null。
 * 空字串一律存成 NULL。
 */
function convert(type, s) {
  if (s === '') return { db: null, mem: '' };
  const t = type.toUpperCase();
  if (t === 'DATE') { const d = parseDate(s); return d ? { db: d, mem: d } : null; }
  if (t === 'DATETIME') return parseDateTime(s);
  if (t === 'TINYINT' || t === 'INT') {
    if (!/^-?\d+$/.test(s)) return null;
    const n = Number(s), lim = t === 'TINYINT' ? 127 : 2147483647;
    return n >= -lim - 1 && n <= lim ? { db: n, mem: String(n) } : null;
  }
  if (t === 'DOUBLE') {
    if (!NUM_RE.test(s)) return null;
    const n = Number(s);
    return isFinite(n) && String(n) === s ? { db: n, mem: s } : null;   // 寫法不同（例如 1.50）就改用文字，保留原樣
  }
  const m = /^VARCHAR\((\d+)\)$/.exec(t);
  if (m) return chars(s) <= +m[1] ? { db: s, mem: s } : null;
  const bytes = Buffer.byteLength(s);
  if (t === 'TEXT') return bytes <= 65535 ? { db: s, mem: s } : null;
  if (t === 'MEDIUMTEXT') return bytes <= 16777215 ? { db: s, mem: s } : null;
  return { db: s, mem: s };   // LONGTEXT
}

/** 資料庫讀回來的值 → 記憶體裡的字串 */
function fromDb(type, v) {
  if (v == null) return '';
  const t = type.toUpperCase();
  if (t === 'DATETIME') { const s = String(v); const p = parseDateTime(s.slice(0, 19)); return p ? p.mem : s; }
  if (t === 'DATE') return String(v).slice(0, 10);
  return String(v);
}

/** 放不下時，依序放寬的型別 */
function widerTypes(type) {
  const t = type.toUpperCase();
  const tail = ['TEXT', 'MEDIUMTEXT', 'LONGTEXT'];
  const str = ['VARCHAR(255)', 'VARCHAR(1000)'].concat(tail);
  if (t === 'DATE') return ['DATETIME'].concat(str);
  if (t === 'DATETIME') return str;
  if (t === 'TINYINT') return ['INT', 'DOUBLE'].concat(str);
  if (t === 'INT') return ['DOUBLE'].concat(str);
  if (t === 'DOUBLE') return str;
  const m = /^VARCHAR\((\d+)\)$/.exec(t);
  if (m) return ['VARCHAR(255)', 'VARCHAR(1000)'].filter(x => +/\d+/.exec(x)[0] > +m[1]).concat(tail);
  return tail.slice(tail.indexOf(t) + 1);
}

/** 欄位上建索引的寫法（太長的文字只取前 64 字） */
function indexExpr(col, type) {
  const t = type.toUpperCase();
  const m = /^VARCHAR\((\d+)\)$/.exec(t);
  const q = '`' + col + '`';
  if (/TEXT$/.test(t) || (m && +m[1] > 191)) return q + '(64)';
  return q;
}

module.exports = { TABLE_NAMES, defFor, convert, fromDb, widerTypes, indexExpr };
