'use strict';
/**
 * 進銷存系統的資料表定義：直接讀 apps/erp/Code.gs 裡的 F（欄位）與 TAB（工作表名稱），
 * 不用另外維護一份對照表——Code.gs 加了欄位，資料表會自動補上。
 *   工作表「品號」→ 資料表 erp_items；表頭「品號」→ 欄位 code
 *   欄位型別：程式裡標 'n' 的是數字 DOUBLE，'d' 是日期 DATE，其他是文字 VARCHAR(255)
 *   （放不下會自動放寬，例如日期欄有時間就改 DATETIME，長文字改 TEXT，並寫進 server.log）
 */
const vm = require('vm');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const snake = s => String(s).replace(/([a-z0-9])([A-Z])/g, '$1_$2').replace(/[^A-Za-z0-9_]/g, '_').toLowerCase();
// 常用來查詢、對照的欄位建索引
const INDEXED = new Set(['id', 'code', 'no', 'item_code', 'item_id', 'wh_id', 'wh_code', 'order_no', 'wo_no', 'sale_no', 'quote_no',
  'lot_no', 'plt_no', 'date', 'status', 'customer', 'ref', 'type_label', 'month']);

function loadErpSchema(appDir) {
  const ctx = {};
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(appDir, 'Code.gs'), 'utf8'), ctx, { filename: 'erp/Code.gs' });
  const F = vm.runInContext('F', ctx), TAB = vm.runInContext('TAB', ctx);
  const bySheet = {}, defs = {};
  Object.keys(TAB).forEach(k => {
    const tbl = ('erp_' + snake(k)).slice(0, 64);
    bySheet[TAB[k]] = tbl;
    const d = defs[tbl] = {};
    (F[k] || []).forEach(f => {
      const col = snake(f[0]).slice(0, 60) || 'col';
      const type = f[2] === 'n' ? 'DOUBLE' : f[2] === 'd' ? 'DATE' : 'VARCHAR(255)';
      d[String(f[1]).trim()] = { col, type, index: INDEXED.has(col) };
    });
  });
  return {
    F, TAB,
    tableName: sheet => bySheet[sheet] || ('erp_sheet_' + crypto.createHash('md5').update(String(sheet)).digest('hex').slice(0, 10)),
    defFor: (tbl, header) => (defs[tbl] && defs[tbl][String(header == null ? '' : header).trim()]) || null,
    sheetNames: Object.values(TAB)
  };
}

module.exports = { loadErpSchema };
