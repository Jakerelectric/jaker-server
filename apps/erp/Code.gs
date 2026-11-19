/**
 * 傑克電機進銷存系統 — Google Apps Script 後端
 * 資料存在本試算表的各分頁；網頁(Index.html)透過 api() 呼叫。
 * 部署：部署 > 新增部署作業 > 網頁應用程式；執行身分「我」；存取權「jaker.com.tw 網域內的任何人」。
 */

// ---------- 分頁與欄位定義（key, 標題, 型別 s=文字 n=數字 d=日期文字） ----------
const F = {
  users: [['id','員工ID','s'],['name','姓名','s'],['dept','單位','s'],['role','角色','s'],['active','啟用','s'],
          ['hash','密碼雜湊','s'],['salt','鹽','s'],['createdAt','建立時間','s'],['lastLogin','最後登入','s'],['perms','職能(業務/採購/倉庫/生管/生產)','s']],
  whs:   [['code','庫別代號','s'],['name','庫別名稱','s'],['type','類型','s']],  // 類型：倉庫 / 生產（生產地點）/ 委外（委外廠商）
  items: [['code','品號','s'],['name','品名','s'],['nameEn','英文品名','s'],['spec','規格','s'],['unit','庫存單位','s'],
          ['cat','類別','s'],['mainWh','主要庫別','s'],['safety','安全存量','n'],['cost','單位成本','n'],
          ['netWt','淨重','n'],['grossWt','毛重','n'],['note','備註','s'],['alias','舊料號/別名','s'],['specEn','英文規格','s'],['erpWh','鼎新庫別(指定)','s']],
  stock: [['itemId','品號','s'],['whId','庫別代號','s'],['qty','數量','n'],['loc','儲位','s'],['lastInAt','最後入庫','d'],['lastOutAt','最後出庫','d'],
          ['packLines','包裝明細(箱數×每箱數量)','s'],['packAt','包裝登記日','d'],['packSize','包裝/棧板尺寸','s']],
  // ---- 客戶主檔（客戶代號與鼎新 COPMA 一致，例如 A20007）----
  settings:[['key','項目','s'],['value','內容','s'],['updatedAt','更新時間','s']],
  mails: [['at','寄出時間','s'],['docNo','單號','s'],['kind','對象','s'],['to','收件人','s'],['cc','副本','s'],['subject','主旨','s'],['files','附件','s'],
          ['byId','寄件人ID','s'],['byName','寄件人','s'],['test','測試頁','s']],
  // ---- 製程主檔：製程代號、名稱、所屬單位與工作站，報工與工單都從這裡挑 ----
  ops:   [['code','代號','s'],['name','名稱','s'],['dept','單位','s'],['station','工作站','s'],['note','說明','s'],['active','啟用','s'],['updatedAt','更新時間','s'],
          ['kind','類別','s'],['site','生產地點','s'],
          ['sop','有作業指導書','s'],['sopNo','作業指導書編號','s'],['sopVer','版次','s'],['sopUrl','作業指導書連結','s']],  // 類別：製程 / 工作站
  // ---- 材料單價異動紀錄：採購每次填入或修改單位成本都留一筆，依生效日查不同時間點的成本 ----
  // ---- BOM 成本估算：成本資料庫（材料、工資、委外加工的單價）＋各成品的 BOM（攤平到每 1 單位成品的用量） ----
  costItems:[['code','材料編號','s'],['name','品名','s'],['spec','規格','s'],['unit','單位','s'],['price','單價','n'],['currency','幣別','s'],['cat','類別','s'],
          ['metal','貴金屬類別','s'],['priceDate','價格更新日','d'],['note','備註','s'],['active','啟用','s'],['updatedAt','更新時間','s']],  // 類別：貴重材料 / 材料 / 生產 / 生產外包
  bom:   [['parent','成品品號','s'],['seq','項次','n'],['level','階層','n'],['virt','虛擬','s'],['code','材料編號','s'],
          ['unitQty','單位用量','n'],['useQty','使用量','n'],['base','子件基數','n'],['note','備註','s']],
  bomHeads:[['parent','成品品號','s'],['name','名稱','s'],['note','備註','s'],['updatedAt','更新時間','s'],['byName','更新人','s']],
  bomLog:[['at','修改時間','s'],['parent','成品品號','s'],['byName','修改人','s'],['summary','內容','s']],
  metalPrices:[['id','紀錄ID','s'],['date','日期','d'],['metal','金屬','s'],['lme','LME(USD/噸)','n'],['fx','匯率','n'],['quote','報價(TWD/kg)','n'],
          ['note','說明','s'],['byName','登記人','s'],['at','登記時間','s']],
  costLog:[['id','紀錄ID','s'],['itemCode','品號','s'],['effDate','生效日','d'],['oldCost','原單價','n'],['newCost','新單價','n'],['currency','幣別','s'],
          ['supplier','供應商','s'],['note','說明','s'],['byId','修改人ID','s'],['byName','修改人','s'],['at','修改時間','s']],
  customers:[['code','客戶代號','s'],['short','客戶簡稱','s'],['full','客戶全名','s'],['nameEn','英文名稱','s'],['contact','聯絡人','s'],
          ['phone','電話','s'],['email','E-mail','s'],['address','地址','s'],['shipTo','收貨資訊','s'],['currency','幣別','s'],['taxType','稅別','s'],
          ['payTerms','付款條件','s'],['tradeTerms','貿易條件','s'],['salesName','負責業務','s'],['note','備註','s'],['active','啟用','s'],['updatedAt','更新時間','s']],
  bills:[['no','結帳單號','s'],['date','結帳日','s'],['custCode','客戶代號','s'],['customer','客戶','s'],['currency','幣別','s'],['period','結帳月份','s'],
          ['sales','銷貨單(JSON)','s'],['amount','結帳金額','n'],['lang','語言','s'],['status','狀態','s'],['sentAt','寄出日','s'],['confirmedAt','客戶確認日','s'],
          ['confirmNote','確認說明','s'],['files','附件(JSON)','s'],['note','備註','s'],['byName','建立人','s'],['ts','建立時間','n'],['updatedAt','更新時間','s']],
  payments:[['id','收款編號','s'],['date','收款日','s'],['custCode','客戶代號','s'],['customer','客戶','s'],['currency','幣別','s'],['amount','收款金額','n'],
          ['fee','手續費／匯差','n'],['alloc','沖銷明細(JSON)','s'],['files','匯款憑證(JSON)','s'],['note','備註','s'],['byName','登記人','s'],['ts','建立時間','n'],['updatedAt','更新時間','s']],
  invoices:[['sc','銷貨單號','s'],['json','內容JSON','s'],['updatedAt','更新時間','s'],['byName','更新人','s']],
  pallets:[['id','棧板編號','s'],['date','日期','d'],['whId','庫別','s'],['lots','批號明細','s'],['pack','棧板尺寸','s'],['palletWt','棧板重量','n'],
          ['status','狀態','s'],['note','備註','s'],['history','調整紀錄','s'],['filler','填寫人','s'],['byId','登記帳號','s'],['ts','建立時間','n'],['loc','庫位','s']],
  repacks:[['date','日期','d'],['itemCode','品號','s'],['itemName','品名','s'],['whId','庫別','s'],['qty','當時庫存','n'],['before','原包裝','s'],
          ['after','新包裝','s'],['packSize','包裝/棧板尺寸','s'],['note','備註','s'],['filler','填寫人','s'],['byId','登記帳號','s'],['ts','建立時間','n']],
  txns:  [['id','編號','s'],['date','日期','d'],['typeLabel','類型','s'],['purpose','類別','s'],['itemCode','品號','s'],['itemName','品名','s'],
          ['spec','規格','s'],['unit','庫存單位','s'],['cat','品號類別','s'],['whCode','庫別','s'],['toWhCode','轉入庫別','s'],
          ['qty','數量','n'],['balance','結存','n'],['toBalance','轉入結存','n'],['ref','單號','s'],['party','供應商/客戶','s'],
          ['boxes','箱數','n'],['spb','每箱數量','n'],['mb','尾箱數','n'],['m','尾箱數量','n'],['pack','包裝/棧板尺寸','s'],
          ['palletWt','棧板重量','n'],['report','測試報告','s'],['fillerId','填寫人ID','s'],['filler','填寫人','s'],['dept','填寫單位','s'],
          ['note','備註','s'],['cost','單位成本','n'],['ts','建立時間','n'],['synced','已同步鼎新','s'],['byId','登記帳號','s'],['edited','修改紀錄','s'],['packLines','包裝明細(箱數×每箱數量)','s'],['orderNo','訂單單號','s'],['woNo','工單單號','s'],['lotNo','入庫批號','s'],['pltNo','同板批號','s'],['loc','庫位','s'],['merged','併入原有庫存','n']],
  counts:[['date','盤點日','d'],['whCode','庫別','s'],['cat','類別','s'],['total','盤點品號數','n'],['diffCount','差異品號數','n'],
          ['diffAmt','差異金額','n'],['filler','盤點人','s'],['lines','明細JSON','s'],['ts','建立時間','n']],
  packings:[['sc','銷貨單號','s'],['json','內容JSON','s'],['updatedAt','更新時間','s'],['byName','更新人','s']],
  consignees:[['company','公司','s'],['consignee','收件資訊','s'],['to','目的地','s'],['updatedAt','更新時間','s']],
  // ---- 報價單 / 訂單（單頭、單身分開，欄位命名接近鼎新 COPTA/COPTB、COPTC/COPTD）----
  quotes:[['no','報價單號','s'],['date','報價日期','d'],['custCode','客戶代號','s'],['customer','客戶','s'],['contact','聯絡人','s'],['currency','幣別','s'],
          ['taxType','稅別','s'],['taxRate','稅率','n'],['validUntil','有效期限','d'],['terms','交易條件','s'],['note','備註','s'],
          ['salesId','業務ID','s'],['salesName','業務','s'],['status','狀態','s'],['orderNo','轉訂單號','s'],
          ['sentAt','送資材時間','s'],['repliedAt','資材回覆時間','s'],['createdAt','建立時間','s'],['updatedAt','更新時間','s'],['erpNo','鼎新單號','s']],
  quoteLines:[['quoteNo','報價單號','s'],['lid','明細ID','s'],['seq','序號','n'],['itemCode','品號','s'],['name','品名','s'],['nameEn','英文品名','s'],
          ['spec','規格','s'],['unit','單位','s'],['qty','數量','n'],['wantDate','客戶希望交期','d'],['price','單價','n'],
          ['cost','成本','n'],['leadDate','資材確認交期','d'],['matNote','資材備註','s'],['matBy','資材回覆人','s'],['matAt','資材回覆時間','s']],
  orders:[['no','訂單單號','s'],['date','訂單日期','d'],['custCode','客戶代號','s'],['customer','客戶','s'],['contact','聯絡人','s'],['custPO','客戶訂單號','s'],
          ['currency','幣別','s'],['taxType','稅別','s'],['taxRate','稅率','n'],['quoteNo','來源報價單','s'],['terms','交易條件','s'],['note','備註','s'],
          ['salesId','業務ID','s'],['salesName','業務','s'],['status','狀態','s'],['createdAt','建立時間','s'],['updatedAt','更新時間','s'],['req','客戶額外需求','s'],['erpNo','鼎新單號','s']],
  orderLines:[['orderNo','訂單單號','s'],['lid','明細ID','s'],['seq','序號','n'],['itemCode','品號','s'],['name','品名','s'],['nameEn','英文品名','s'],
          ['spec','規格','s'],['unit','單位','s'],['qty','數量','n'],['price','單價','n'],['cost','成本','n'],['dueDate','預交日','d'],['note','備註','s']],
  // ---- 工單（接近鼎新 MOCTA 工單單頭 / MOCTB 工單用料）----
  wos:   [['no','工單單號','s'],['date','開單日期','d'],['itemCode','品號','s'],['name','品名','s'],['spec','規格','s'],['unit','單位','s'],
          ['qty','預計產量','n'],['whIn','入庫庫別','s'],['dueDate','預計完工','d'],['orderNo','來源訂單','s'],['status','狀態','s'],['note','備註','s'],
          ['createdBy','開單人','s'],['createdAt','建立時間','s'],['updatedAt','更新時間','s'],['site','生產地點','s']],
  woMats:[['woNo','工單單號','s'],['lid','明細ID','s'],['seq','序號','n'],['itemCode','品號','s'],['name','品名','s'],['spec','規格','s'],['unit','單位','s'],
          ['qty','需領用量','n'],['whOut','領料庫別','s'],['note','備註','s']],
  // ---- 銷貨單（接近鼎新 COPTG 銷貨單頭 / COPTH 銷貨單身）：業務開單，倉庫確認出貨才扣庫存 ----
  sales: [['no','銷貨單號','s'],['date','單據日期','d'],['custCode','客戶代號','s'],['customer','客戶','s'],['contact','聯絡人','s'],['orderNo','來源訂單','s'],
          ['currency','幣別','s'],['taxType','稅別','s'],['taxRate','稅率','n'],['whId','出貨庫別','s'],['shipDate','預計出貨日','d'],
          ['terms','交易條件','s'],['note','備註','s'],['salesId','業務ID','s'],['salesName','業務','s'],['status','狀態','s'],
          ['shippedAt','出貨時間','s'],['shippedBy','出貨人','s'],['createdAt','建立時間','s'],['updatedAt','更新時間','s'],['imported','舊資料匯入','s'],['exportNo','出口報單號碼','s'],['editLog','修改紀錄','s']],
  salesLines:[['saleNo','銷貨單號','s'],['lid','明細ID','s'],['seq','序號','n'],['itemCode','品號','s'],['name','品名','s'],['nameEn','英文品名','s'],
          ['spec','規格','s'],['unit','單位','s'],['qty','數量','n'],['price','單價','n'],['whId','出貨庫別','s'],['note','備註','s'],['shipQty','實出數量','n'],['orderNo','來源訂單','s'],['free','不計價','s']],  // 不計價：樣品 / 補料 / 其他
  woOps: [['woNo','工單單號','s'],['lid','製程ID','s'],['seq','順序','n'],['name','製程','s'],['note','備註','s'],['vendor','委外廠商','s']],
  // ---- 製程委外：送出 / 收回紀錄（生管填寫）----
  woOut: [['id','紀錄ID','s'],['date','日期','d'],['woNo','工單單號','s'],['opLid','製程ID','s'],['opName','製程','s'],['vendor','委外廠商','s'],['kind','動作','s'],
          ['qty','送出數量','n'],['good','收回良品','n'],['bad','收回不良','n'],['badReason','不良原因','s'],['note','備註','s'],['byId','登記帳號','s'],['byName','登記人','s'],['ts','建立時間','n']],
  woReports:[['id','報工ID','s'],['date','日期','d'],['woNo','工單單號','s'],['opLid','製程ID','s'],['opName','製程','s'],['opSeq','製程順序','n'],
          ['itemCode','品號','s'],['workerId','人員ID','s'],['worker','人員','s'],['dept','單位','s'],['hours','工時(小時)','n'],
          ['good','良品數','n'],['bad','不良數','n'],['badReason','不良原因','s'],['note','備註','s'],['byId','登記帳號','s'],['ts','建立時間','n'],
          ['opDone','本製程完工','s'],['status','審核狀態','s'],['reviewer','審核人','s'],['reviewedAt','審核時間','s'],['rejectReason','退回原因','s'],
          ['groupId','小組報工ID','s'],['teamSize','小組人數','n'],['site','生產地點','s'],
          ['finalItem','最終產品','s'],['station','工作站','s'],['opCode','製程代號','s'],['stationCode','工作站代號','s'],['prevDept','前站單位','s'],['prevOp','前站製程','s'],['nextDept','下站單位','s'],['nextOp','下站製程','s']]
};
const TAB = { users:'帳號', whs:'庫別', items:'品號', stock:'庫存', txns:'異動紀錄', counts:'盤點紀錄', packings:'PackingList', consignees:'收件人',
  quotes:'報價單', quoteLines:'報價單身', orders:'訂單', orderLines:'訂單單身', wos:'工單', woMats:'工單用料', sales:'銷貨單', salesLines:'銷貨單身', repacks:'包裝紀錄', pallets:'棧板', invoices:'Invoice', bills:'結帳單', payments:'收款', customers:'客戶', costLog:'單價紀錄', costItems:'成本資料庫', bom:'BOM', bomHeads:'BOM表頭', bomLog:'BOM修改紀錄', metalPrices:'金屬價格', ops:'製程', settings:'設定', mails:'寄信紀錄', woOps:'工單製程', woOut:'委外紀錄', woReports:'報工紀錄' };
const TYPE_LABEL = { in:'入庫', out:'出庫', xfer:'調撥', adj:'調整' };
const LABEL_TYPE = { '入庫':'in', '出庫':'out', '調撥':'xfer', '調整':'adj' };
const ROLE_RANK = { staff:0, viewer:1, user:2, admin:3 };
const TZ = 'Asia/Taipei';
const SESSION_SEC = 6 * 60 * 60;

function doGet(e) {
  // work.jaker.com.tw/erp 用 fetch 取得網頁內容，在公司網址下直接顯示（相機、下載都能用）
  if (e && e.parameter && e.parameter.shell) {
    return ContentService.createTextOutput(HtmlService.createHtmlOutputFromFile('Index').getContent()).setMimeType(ContentService.MimeType.TEXT);
  }
  return HtmlService.createTemplateFromFile('Index').evaluate()
    .setTitle('傑克電機進銷存系統')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

/** work.jaker.com.tw/erp 的資料呼叫：POST {token, action, p}，回傳和 google.script.run 一樣的結果 */
function doPost(e) {
  let r;
  try { const b = JSON.parse(e.postData.contents || '{}'); r = api(b.token || null, String(b.action || ''), b.p || {}); }
  catch (err) { r = { ok: false, error: '要求格式不正確。' }; }
  return ContentService.createTextOutput(JSON.stringify(r)).setMimeType(ContentService.MimeType.JSON);
}

/** 在編輯器手動執行一次：建立所有分頁與欄位標題（已存在的不會動） */
function setupSheets() { Object.keys(F).forEach(k => sh_(k)); fillTxnIds_(); }
/** 舊資料（例如從 Excel 匯入）沒有編號的異動紀錄，補上編號，管理員才能修改 */
function fillTxnIds_() {
  const s = sh_('txns'); const last = s.getLastRow(); if (last < 2) return 0;
  const vals = s.getRange(2, 1, last - 1, 2).getValues(); let n = 0;
  const out = vals.map((r, i) => { if (r[0] === '' && r[1] !== '') { n++; return ['R' + Date.now() + '_' + (i + 2)]; } return [r[0]]; });
  if (n) { s.getRange(2, 1, last - 1, 1).setValues(out); READ_MEMO_ = {}; }
  return n;
}

// ---------- 試算表工具 ----------
const HDR_OK = {};
function sh_(k) {
  const ss = SpreadsheetApp.getActive();
  let s = ss.getSheetByName(TAB[k]);
  if (!s) {
    s = ss.insertSheet(TAB[k]);
    s.getRange(1, 1, 1, F[k].length).setValues([F[k].map(f => f[1])]).setFontWeight('bold');
    s.setFrozenRows(1);
    F[k].forEach((f, i) => { if (f[2] !== 'n') s.getRange(2, i + 1, s.getMaxRows() - 1, 1).setNumberFormat('@'); });
  } else if (!HDR_OK[k]) {
    // 新版增加欄位時，自動補上標題（舊資料不受影響）
    const h = s.getRange(1, 1, 1, F[k].length).getValues()[0];
    if (F[k].some((f, i) => h[i] !== f[1])) s.getRange(1, 1, 1, F[k].length).setValues([F[k].map(f => f[1])]).setFontWeight('bold');
  }
  HDR_OK[k] = true;
  return s;
}
function cellOut_(v, t) {
  if (v instanceof Date) return t === 'n' ? v.getTime() : Utilities.formatDate(v, TZ, 'yyyy-MM-dd');
  if (t === 'n') { if (v === '' || v === null) return null; const n = Number(v); return isNaN(n) ? null : n; }
  return v === null || v === undefined ? '' : String(v);
}
function cellIn_(v, t) {
  if (t === 'n') return (v === '' || v === null || v === undefined || isNaN(Number(v))) ? '' : Number(v);
  return v === null || v === undefined ? '' : String(v);
}
function rowToObj_(k, r, rowNo) {
  const o = { _row: rowNo };
  F[k].forEach((f, i) => o[f[0]] = cellOut_(r[i], f[2]));
  return o;
}
function objToRow_(k, o) { return F[k].map(f => cellIn_(o[f[0]], f[2])); }
/** 同一次呼叫內讀過的分頁先暫存（只讀不寫時不用重讀試算表）；任何寫入都會清掉暫存 */
let READ_MEMO_ = {};
function readAll_(k, opt) {
  if (!opt && READ_MEMO_[k]) return READ_MEMO_[k].map(o => Object.assign({}, o));
  if (!opt) { const r = readAllRaw_(k); READ_MEMO_[k] = r.map(o => Object.assign({}, o)); return r; }
  return readAllRaw_(k, opt);
}
function readAllRaw_(k, opt) {
  const s = sh_(k); const last = s.getLastRow();
  if (last < 2) return [];
  let start = 2;
  if (opt && opt.tail) start = Math.max(2, last - opt.tail + 1);
  const vals = s.getRange(start, 1, last - start + 1, F[k].length).getValues();
  const out = [];
  vals.forEach((r, i) => { if (r.some(v => v !== '' && v !== null)) out.push(rowToObj_(k, r, start + i)); });
  return out;
}
function append_(k, objs) {
  if (!objs.length) return;
  if (k === 'txns' && objs.some(o => o.typeLabel === '入庫' && !o.lotNo)) { const mx = lotSeq_(); objs.forEach(o => { if (o.typeLabel === '入庫' && !o.lotNo) o.lotNo = nextLot_(mx, o.date); }); }
  READ_MEMO_ = {};
  const s = sh_(k);
  s.getRange(s.getLastRow() + 1, 1, objs.length, F[k].length).setValues(objs.map(o => objToRow_(k, o)));
}
function update_(k, o) { READ_MEMO_ = {}; sh_(k).getRange(o._row, 1, 1, F[k].length).setValues([objToRow_(k, o)]); }
function deleteRow_(k, o) { READ_MEMO_ = {}; sh_(k).deleteRow(o._row); }
/** 整欄取代：把分頁 k 的欄位 field 中等於 from 的值改成 to（一次讀寫，用在改代號） */
function replaceCol_(k, field, from, to) {
  const i = F[k].findIndex(f => f[0] === field); if (i < 0) return 0;
  const s = sh_(k); const last = s.getLastRow(); if (last < 2) return 0;
  const rg = s.getRange(2, i + 1, last - 1, 1); const v = rg.getValues(); let n = 0;
  v.forEach(r => { if (String(r[0]) === String(from)) { r[0] = to; n++; } });
  if (n) { rg.setValues(v); READ_MEMO_ = {}; } return n;
}
// ---------- 入庫批號：每一筆入庫一個編號，例如 IN20261103-001（入庫日＋當天流水號），Packing List 用它記住哪一批已經出了 ----------
function lotSeq_() { const mx = {}; readAll_('txns').forEach(t => { const m = /^IN(\d{8})-(\d+)$/.exec(t.lotNo || ''); if (m) mx[m[1]] = Math.max(mx[m[1]] || 0, Number(m[2])); }); return mx; }
function nextLot_(mx, date) { const d = String(date || today_()).slice(0, 10).replace(/-/g, ''); mx[d] = (mx[d] || 0) + 1; return 'IN' + d + '-' + ('00' + mx[d]).slice(-3); }
/** 舊的入庫紀錄沒有批號：依入庫日期、建立順序補上（只補一次） */
function fillLotNos_() {
  const all = readAll_('txns'); const miss = all.filter(t => t.typeLabel === '入庫' && !t.lotNo); if (!miss.length) return 0;
  const mx = lotSeq_(); miss.sort((a, b) => String(a.date).localeCompare(String(b.date)) || (Number(a.ts) || 0) - (Number(b.ts) || 0)).forEach(t => t.lotNo = nextLot_(mx, t.date));
  const col = F.txns.findIndex(f => f[0] === 'lotNo') + 1, s = sh_('txns'), last = s.getLastRow(); const rg = s.getRange(2, col, last - 1, 1); const v = rg.getValues();
  miss.forEach(t => { if (t._row >= 2 && t._row <= last) v[t._row - 2][0] = t.lotNo; }); rg.setValues(v); READ_MEMO_ = {};
  return miss.length;
}
const round_ = n => Math.round(n * 10000) / 10000;
const today_ = () => Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd');
const nowStr_ = () => Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd HH:mm');
const clean_ = o => { const c = {}; Object.keys(o).forEach(k => { if (k[0] !== '_' && k !== 'hash' && k !== 'salt') c[k] = o[k]; }); return c; };

// ---------- 帳號與登入 ----------
function hash_(pw, salt) {
  let h = salt + '|' + pw;
  for (let i = 0; i < 200; i++) {
    h = Utilities.base64Encode(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, h + salt, Utilities.Charset.UTF_8));
  }
  return h;
}
function checkPw_(pw) { if (!pw || String(pw).length < 6) throw new Error('密碼至少 6 個字元。'); }
function userById_(id) { return readAll_('users').find(u => u.id.toLowerCase() === String(id || '').trim().toLowerCase()); }
function session_(token) {
  if (!token) throw new Error('AUTH');
  const cache = CacheService.getScriptCache();
  const id = cache.get('tk_' + token);
  if (!id) throw new Error('AUTH');
  const u = userById_(id);
  if (!u || u.active !== '是') { cache.remove('tk_' + token); throw new Error('AUTH'); }
  cache.put('tk_' + token, id, SESSION_SEC);
  return u;
}
function need_(u, role) { if ((ROLE_RANK[u.role] || 0) < ROLE_RANK[role]) throw new Error('你的帳號沒有這個操作的權限。'); }
function newToken_(u) {
  const token = Utilities.getUuid();
  CacheService.getScriptCache().put('tk_' + token, u.id, SESSION_SEC);
  return token;
}

// ---------- 對外唯一入口 ----------
function api(token, action, p) {
  COSTLOG_CACHE_ = null; BOMC_CACHE_ = null; READ_MEMO_ = {};  // 每次呼叫重新讀單價紀錄、BOM
  p = p || {};
  try {
    if (action === 'status') return ok_({ hasUsers: readAll_('users').length > 0 });
    if (action === 'setup') return ok_(setup_(p));
    if (action === 'login') return ok_(login_(p));
    if (action === 'logout') {
      const c = CacheService.getScriptCache(); const id = token ? c.get('tk_' + token) : null;
      c.remove('tk_' + token); if (id) c.remove('pr_' + id);
      return ok_(true);
    }
    const u = session_(token);
    const H = HANDLERS[action];
    if (!H) throw new Error('未知的操作：' + action);
    need_(u, H[0]);
    if (H[2]) {
      const lock = LockService.getScriptLock();
      if (!lock.tryLock(20000)) throw new Error('系統忙碌中，請稍候再試。');
      try {
        const r = H[1](u, p);
        CacheService.getScriptCache().put('dataVer', String(Date.now()), 21600);  // 讓其他人的畫面知道資料有更新
        return ok_(r);
      } finally { lock.releaseLock(); }
    }
    return ok_(H[1](u, p));
  } catch (e) {
    return { ok: false, error: String(e && e.message || e) };
  }
}
function ok_(data) { return { ok: true, data: data }; }

// [最低角色, 函式, 是否需要鎖]
// ======================= 寄信（訂單確認給客戶、生管） =======================
function setting_(k) { const r = readAll_('settings').find(x => x.key === k); return r ? r.value : ''; }
function setSetting_(k, v) { const r = readAll_('settings').find(x => x.key === k);
  if (r) { r.value = v; r.updatedAt = nowStr_(); update_('settings', r); } else append_('settings', [{ key: k, value: v, updatedAt: nowStr_() }]); }
function mailPrep_(u) { needSales_(u); return { prodTo: setting_('mail.prodTo'), prodCc: setting_('mail.prodCc'), custCc: setting_('mail.custCc'), sign: setting_('mail.sign.' + u.id) }; }
const EMAIL_RE_ = /^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+$/;
const emails_ = (v, need, label) => { const L = String(v || '').split(/[,;，；\s]+/).map(x => x.trim()).filter(Boolean);
  if (need && !L.length) throw new Error(label + '的收件人不能空白。'); L.forEach(e => { if (!EMAIL_RE_.test(e)) throw new Error(label + '的 Email 格式不正確：' + e); }); return L.join(','); };
function sendMail_(u, p) {
  needSales_(u); const mails = p.mails || []; if (!mails.length) throw new Error('請至少勾選一個收件對象。');
  const test = typeof MailApp === 'undefined';  // 測試頁沒有寄信功能，只留紀錄
  const prepared = mails.map(m => ({ m, to: emails_(m.to, true, m.label || ''), cc: emails_(m.cc, false, (m.label || '') + '副本') }));
  if (!test && MailApp.getRemainingDailyQuota() < prepared.length) throw new Error('今天的寄信額度已用完，請明天再寄。');
  const log = [];
  prepared.forEach(x => {
    if (!String(x.m.subject || '').trim()) throw new Error(x.m.label + '的主旨不能空白。');
    if (!test) {
      const att = (x.m.files || []).map(f => Utilities.newBlob(Utilities.base64Decode(f.b64), 'application/pdf', f.name));
      MailApp.sendEmail({ to: x.to, cc: x.cc || undefined, subject: x.m.subject, body: x.m.body, name: 'Jaker Electric Co., Ltd. - ' + u.name, attachments: att });
    }
    log.push({ at: nowStr_(), docNo: String(p.docNo || ''), kind: x.m.kind, to: x.to, cc: x.cc, subject: x.m.subject, files: (x.m.files || []).map(f => f.name).join(', '), byId: u.id, byName: u.name, test: test ? '是' : '' });
  });
  append_('mails', log);
  const sv = p.save || {};
  if (sv.prodTo != null) setSetting_('mail.prodTo', String(sv.prodTo)); if (sv.prodCc != null) setSetting_('mail.prodCc', String(sv.prodCc));
  if (sv.custCc != null) setSetting_('mail.custCc', String(sv.custCc)); if (sv.sign != null) setSetting_('mail.sign.' + u.id, String(sv.sign));
  return { sent: log.length, test: test };
}
// ======================= 英文版翻譯（備註、交易條件、客戶需求等） =======================
function trLoad_(u) { const m = {}; readAll_('settings').forEach(r => { if (String(r.key).indexOf('tr:') === 0) m[String(r.key).slice(3)] = r.value; }); return m; }
function trSave_(u, p) {
  needSales_(u); const all = readAll_('settings'); const add = [];
  Object.keys(p.map || {}).forEach(k => { const v = String(p.map[k] || '').trim(); if (!k || !v) return; const key = 'tr:' + k; const r = all.find(x => x.key === key);
    if (r) { if (r.value !== v) { r.value = v; r.updatedAt = nowStr_(); update_('settings', r); } } else add.push({ key: key, value: v, updatedAt: nowStr_() }); });
  append_('settings', add); return { saved: Object.keys(p.map || {}).length };
}
function translate_(u, p) {
  if (typeof LanguageApp === 'undefined') throw new Error('這裡沒有自動翻譯功能，請手動填寫英文。');
  return (p.texts || []).slice(0, 60).map(t => { try { return LanguageApp.translate(String(t), 'zh-TW', 'en'); } catch (e) { return ''; } });
}
const HANDLERS = {
  load:        ['viewer', load_],
  ping:        ['viewer', ping_],
  changePw:    ['viewer', changePw_, true],
  move:        ['user', whOnly_(move_), true],
  moveBatch:   ['user', whOnly_(moveBatch_), true],
  stocktake:   ['user', whOnly_(stocktake_), true],
  saveLoc:     ['user', whOnly_(saveLoc_), true],
  repack:      ['user', whOnly_(repack_), true],
  palletsLoad: ['viewer', palletsLoad_, false],
  savePallet:  ['user', whOnly_(savePallet_), true],
  getInvoice:  ['user', getInvoice_],
  saveInvoice: ['user', saveInvoice_, true],
  saveCustomer:['user', saveCustomer_, true],
  syncCustNames:['user', syncCustNames_, true],
  mailPrep:    ['user', mailPrep_],
  saveBom:     ['user', saveBom_, true],
  deleteBom:   ['user', deleteBom_, true],
  importBoms:  ['user', importBoms_, true],
  costLoad:    ['viewer', costLoad_],
  saveCostCalc:['user', saveCostCalc_, true],
  saveCostItem:['user', saveCostItem_, true],
  deleteCostItem:['user', deleteCostItem_, true],
  importCostItems:['user', importCostItems_, true],
  saveMetal:   ['user', saveMetal_, true],
  deleteMetal: ['user', deleteMetal_, true],
  syncCostItems:['user', syncCostItemsH_, true],
  saveModules: ['admin', saveModules_, true],
  setCost:     ['user', setCost_, true],
  costLog:     ['viewer', costLog_],
  setSaleExport:['user', setSaleExport_, true],
  saleAdjust:  ['user', saleAdjust_, true],
  saveOps:     ['user', saveOps_, true],
  saveCodeRules:['admin', saveCodeRules_, true],
  deleteOp:    ['user', deleteOp_, true],
  woOutsource: ['user', woOutsource_, true],
  delWoOut:    ['user', delWoOut_, true],
  trLoad:      ['viewer', trLoad_],
  trSave:      ['user', trSave_, true],
  translate:   ['user', translate_],
  sendMail:    ['user', sendMail_, true],
  importCustomers:['user', importCustomers_, true],
  deleteCustomer:['user', deleteCustomer_, true],
  saveWO:      ['user', saveWO_, true],
  woStatus:    ['user', woStatus_, true],
  woMove:      ['user', woMove_, true],
  woReport:    ['user', woReport_, true],
  delReport:   ['user', delReport_, true],
  reviewReports:['user', reviewReports_, true],
  txnsQuery:   ['viewer', txnsQuery_],
  getPacking:  ['viewer', getPacking_],
  savePacking: ['user', savePacking_, true],
  setItemWeights: ['user', setItemWeights_, true],
  saveItem:    ['admin', saveItem_, true],
  deleteItem:  ['admin', deleteItem_, true],
  saveWh:      ['user', saveWh_, true],
  renameWh:    ['user', renameWh_, true],
  deleteWh:    ['admin', deleteWh_, true],
  importItems: ['admin', importItems_, true],
  importStock: ['admin', importStock_, true],
  listUsers:   ['admin', listUsers_],
  saveUser:    ['admin', saveUser_, true],
  deleteUser:  ['admin', deleteUser_, true],
  updateTxn:   ['admin', updateTxn_, true],
  setSafety:   ['admin', setSafety_, true],
  mergeItem:   ['admin', mergeItem_, true],
  renameItems: ['admin', renameItems_, true],
  saveEnglish: ['admin', saveEnglish_, true],
  salesLoad:   ['viewer', salesLoad_],
  billSave:    ['user', billSave_, true],
  billStatus:  ['user', billStatus_, true],
  billDelete:  ['user', billDelete_, true],
  paySave:     ['user', paySave_, true],
  payDelete:   ['user', payDelete_, true],
  saveQuote:   ['user', saveQuote_, true],
  quoteStatus: ['user', quoteStatus_, true],
  setErpNo:    ['user', setErpNo_, true],
  matReply:    ['user', matReply_, true],
  quoteToOrder:['user', quoteToOrder_, true],
  saveOrder:   ['user', saveOrder_, true],
  orderStatus: ['user', orderStatus_, true],
  deleteDoc:   ['user', deleteDoc_, true],
  saveSale:    ['user', saveSale_, true],
  saleStatus:  ['user', saleStatus_, true],
  renameSale:  ['user', renameSale_, true],
  renameDoc:   ['user', renameDoc_, true],
  orderToSale: ['user', orderToSale_, true],
  shipSale:    ['user', shipSale_, true],
  unshipSale:  ['admin', unshipSale_, true],
  deleteTxn:   ['admin', deleteTxn_, true]
};

function setup_(p) {
  const lock = LockService.getScriptLock(); lock.waitLock(20000);
  try {
    if (readAll_('users').length) throw new Error('已經有帳號，請用管理員帳號登入。');
    const id = String(p.id || '').trim(); if (!id) throw new Error('請輸入員工ID。');
    if (!String(p.name || '').trim()) throw new Error('請輸入姓名。');
    checkPw_(p.pw);
    const salt = Utilities.getUuid();
    append_('users', [{ id, name: String(p.name).trim(), dept: String(p.dept || '').trim(), role: 'admin', active: '是', hash: hash_(p.pw, salt), salt, createdAt: nowStr_(), lastLogin: nowStr_() }]);
  } finally { lock.releaseLock(); }
  return login_(p);
}
function login_(p) {
  const id = String(p.id || '').trim();
  const cache = CacheService.getScriptCache(); const fk = 'fail_' + id.toLowerCase();
  const fails = Number(cache.get(fk) || 0);
  if (fails >= 5) throw new Error('密碼錯誤次數過多，請 10 分鐘後再試，或請管理員重設密碼。');
  const u = userById_(id);
  if (!u || !u.hash || u.hash !== hash_(String(p.pw || ''), u.salt)) { cache.put(fk, String(fails + 1), 600); throw new Error('員工ID或密碼不正確。'); }
  if (u.active !== '是') throw new Error('這個帳號已停用，請洽管理員。');
  if (u.role === 'staff') throw new Error('這個員工ID只能刷卡登記，不能登入系統。');
  cache.remove(fk);
  u.lastLogin = nowStr_(); update_('users', u);
  return { token: newToken_(u), user: clean_(u) };
}
/** 公司主機版：員工編號＋密碼已由行政服務確認過，直接依員工編號發登入代碼（權限照這套系統的帳號設定）。
 *  只有伺服器自己會呼叫，不在 api() 的操作清單裡。 */
function loginByAdmin_(id) {
  const u = userById_(id);
  if (!u) throw new Error('你的員工編號還沒有進銷存系統的帳號，請管理員到「帳號管理」新增後再登入。');
  if (u.active !== '是') throw new Error('這個帳號已停用，請洽管理員。');
  if (u.role === 'staff') throw new Error('這個員工ID只能刷卡登記，不能登入系統。');
  u.lastLogin = nowStr_(); update_('users', u);
  return { token: newToken_(u), user: clean_(u) };
}
function changePw_(u, p) {
  if (u.hash !== hash_(String(p.old || ''), u.salt)) throw new Error('目前的密碼不正確。');
  checkPw_(p.pw);
  u.salt = Utilities.getUuid(); u.hash = hash_(p.pw, u.salt); update_('users', u);
  return true;
}
function listUsers_() { return readAll_('users').map(clean_); }
function saveUser_(u, p) {
  const id = String(p.id || '').trim(); if (!id) throw new Error('請輸入員工ID。');
  if (!['admin', 'user', 'viewer', 'staff'].includes(p.role)) throw new Error('角色不正確。');
  const ex = userById_(id);
  if (p.isNew && ex) throw new Error('員工ID ' + id + ' 已存在。');
  if (!p.isNew && !ex) throw new Error('找不到這個帳號。');
  if (ex && ex.id === u.id && (p.role !== 'admin' || p.active !== '是')) throw new Error('不能停用自己，或取消自己的管理員身分。');
  const rec = ex || { id, createdAt: nowStr_(), lastLogin: '' };
  rec.name = String(p.name || '').trim(); rec.dept = String(p.dept || '').trim(); rec.role = p.role; rec.active = p.active === '否' ? '否' : '是';
  const pin = String(p.perms || '').replace(/資材/g, '採購');  // 舊名稱「資材」改叫「採購」
  rec.perms = ['業務', '採購', '倉庫', '生管', '生產主管', '生產'].filter(x => (x === '生產' ? pin.replace(/生產主管/g, '') : pin).indexOf(x) >= 0).join(',');
  if (!rec.name) throw new Error('請輸入姓名。');
  if (p.pw) { checkPw_(p.pw); rec.salt = Utilities.getUuid(); rec.hash = hash_(p.pw, rec.salt); }
  else if (p.role !== 'staff' && !rec.hash) throw new Error('可以登入的帳號要設定密碼（至少 6 個字元）。');
  if (ex) update_('users', rec); else append_('users', [rec]);
  return listUsers_();
}
function deleteUser_(u, p) {
  const ex = userById_(p.id); if (!ex) throw new Error('找不到這個帳號。');
  if (ex.id === u.id) throw new Error('不能刪除自己的帳號。');
  deleteRow_('users', ex);
  return listUsers_();
}

// ---------- 讀取 ----------
function txnOut_(t) {
  t.type = LABEL_TYPE[t.typeLabel] || 'in';
  t.itemId = t.itemCode; t.whId = t.whCode; t.toWhId = t.toWhCode;
  t.month = String(t.date || '').slice(0, 7);
  delete t._row; return t;
}
function load_(u) {
  const pm = perms_(u);
  const ciSet = {}; readAll_('costItems').forEach(x => ciSet[x.code] = 1);
  const items = readAll_('items').map(i => { i.id = i.code; delete i._row; if (!pm.cost) delete i.cost; if (ciSet[i.code]) i.cx = 1; return i; });
  const whs = readAll_('whs').map(w => { w.id = w.code; delete w._row; return w; });
  const stock = readAll_('stock').map(s => { s.id = s.itemId + '__' + s.whId; delete s._row; return s; });
  let txns = readAll_('txns', { tail: 800 });
  if (txns.some(t => !t.id)) {  // 第一次載入舊資料時自動補編號
    const lock = LockService.getScriptLock();
    if (lock.tryLock(5000)) { try { fillTxnIds_(); } finally { lock.releaseLock(); } txns = readAll_('txns', { tail: 800 }); }
  }
  txns = txns.map(txnOut_).sort((a, b) => b.ts - a.ts);
  const counts = readAll_('counts', { tail: 50 }).map(c => { delete c._row; delete c.lines; return c; }).sort((a, b) => b.ts - a.ts);
  // 刷員工證用：只給姓名與單位，不含密碼資料
  const people = ROLE_RANK[u.role] >= ROLE_RANK.user ? readAll_('users').filter(x => x.active === '是').map(x => ({ id: x.id, name: x.name, dept: x.dept })) : [];
  if (!pm.cost) { txns.forEach(t => delete t.cost); counts.forEach(c => delete c.diffAmt); }
  const me = clean_(u); me.perm = pm;
  const repacks = readAll_('repacks', { tail: 200 }).map(r => { delete r._row; return r; }).sort((a, b) => b.ts - a.ts);
  return { user: me, items, whs, stock, txns, counts, people, repacks, modsOff: modsOff_(), ver: CacheService.getScriptCache().get('dataVer') || '' };
}
/** 線上狀態：每個人約 30 秒回報一次所在分頁；75 秒內有回報的算在線上 */
function ping_(u, p) {
  const c = CacheService.getScriptCache(); const now = Date.now();
  c.put('pr_' + u.id, JSON.stringify({ id: u.id, name: u.name, dept: u.dept, tab: String(p.tab || ''), ctx: String(p.ctx || ''), sid: String(p.sid || ''), ts: now }), 120);
  const keys = readAll_('users').map(x => 'pr_' + x.id);
  const got = keys.length ? c.getAll(keys) : {};
  const online = Object.keys(got).map(k => { try { return JSON.parse(got[k]); } catch (e) { return null; } })
    .filter(x => x && now - x.ts < 75000);
  return { online, ver: c.get('dataVer') || '' };
}
function txnsQuery_(u, p) {
  let ts = readAll_('txns').map(txnOut_);
  if (p.month) ts = ts.filter(t => t.month === p.month);
  if (p.from) ts = ts.filter(t => t.date >= p.from);
  if (p.to) ts = ts.filter(t => t.date <= p.to);
  if (p.ref) ts = ts.filter(t => t.ref === p.ref);
  return ts.sort((a, b) => String(a.date).localeCompare(String(b.date)) || a.ts - b.ts);
}

// ---------- 庫存異動 ----------
function stockCtx_() {
  const rows = readAll_('stock'); const map = {};
  rows.forEach(r => map[r.itemId + '__' + r.whId] = r);
  return { map, dirty: [], added: [] };
}
function adjust_(ctx, item, whId, delta, opt) {
  opt = opt || {};
  const key = item.code + '__' + whId;
  let r = ctx.map[key];
  if (!r) { r = { itemId: item.code, whId, qty: 0, loc: '', lastInAt: '', lastOutAt: '' }; ctx.map[key] = r; ctx.added.push(r); }
  else if (r._row && ctx.dirty.indexOf(r) < 0) ctx.dirty.push(r);
  const cur = Number(r.qty) || 0;
  const next = round_(opt.setTo != null ? opt.setTo : cur + delta);
  if (!opt.allowNeg && next < 0) throw new Error(item.code + ' 在 ' + whId + ' 庫存不足：目前 ' + cur + '，無法扣 ' + (-delta) + '。如果實物確實在，代表帳面不準，請先盤點。');
  r.qty = next;
  if (next > cur && opt.date) r.lastInAt = opt.date;
  if (next < cur && opt.setTo == null && opt.date) r.lastOutAt = opt.date;
  return { before: cur, after: next };
}
function flushStock_(ctx) { ctx.dirty.forEach(r => update_('stock', r)); append_('stock', ctx.added); }
/** 某日的單位成本：單價紀錄裡生效日 ≤ 該日的最後一筆；沒有紀錄就用品號上的目前成本（同一次執行只讀一次紀錄） */
let COSTLOG_CACHE_ = null;
function costOn_(item, date) {
  if (!COSTLOG_CACHE_) { COSTLOG_CACHE_ = {}; readAll_('costLog').forEach(x => (COSTLOG_CACHE_[x.itemCode] = COSTLOG_CACHE_[x.itemCode] || []).push(x)); }
  const d = String(date || today_()).slice(0, 10);
  const L = (COSTLOG_CACHE_[item.code] || []).filter(x => String(x.effDate) <= d).sort((a, b) => String(a.effDate).localeCompare(String(b.effDate)) || String(a.at).localeCompare(String(b.at)));
  if (bomParents_()[item.code]) return round_(bomCostOn_(item.code, d));  // 有 BOM 的成品：用當天的 BOM 估算成本
  return L.length ? Number(L[L.length - 1].newCost) : (item.cost || '');
}
function txnRec_(u, item, t) {
  return Object.assign({
    id: 'T' + Date.now() + Math.floor(Math.random() * 1000), itemCode: item.code, itemName: item.name, spec: item.spec || '', unit: item.unit,
    cat: item.cat, cost: costOn_(item, t.date), ts: Date.now(), fillerId: u.id, filler: u.name, dept: u.dept, synced: '否', byId: u.id,
    ref: '', party: '', note: '', toWhCode: '', toBalance: ''
  }, t, { typeLabel: TYPE_LABEL[t.type] });
}
// ---------- 新舊料號：品號之外可以有多個舊料號/別名，輸入或刷條碼任一個都找得到 ----------
function aliasList_(v) { return String(v || '').split(/[,，;；、\s]+/).map(x => x.trim()).filter(Boolean); }
function itemByAny_(items, code) {
  const c = String(code || '').trim(); if (!c) return null; const lc = c.toLowerCase();
  return items.find(i => i.code === c) || items.find(i => i.code.toLowerCase() === lc) ||
    items.find(i => aliasList_(i.alias).some(a => a.toLowerCase() === lc)) || null;
}
function itemOf_(code) { const it = readAll_('items').find(i => i.code === code); if (!it) throw new Error('找不到品號 ' + code + '。'); return it; }
function whOf_(code) { const w = readAll_('whs').find(x => x.code === code); if (!w) throw new Error('找不到庫別 ' + code + '。'); return w; }

function move_(u, p) {
  const ctx = stockCtx_(); const rec = [];
  const res = moveOne_(u, p, ctx, rec, readAll_('items'), readAll_('whs'));
  flushStock_(ctx); append_('txns', rec);
  const inRec = rec.find(r => r.typeLabel === '入庫'); if (inRec) res.lotNo = inRec.lotNo;   // 入庫批號（印批號標籤用）
  return res;
}
/** 刷條碼批次登記：全部檢查通過才寫入，任何一筆庫存不足就整批不寫 */
function moveBatch_(u, p) {
  const list = (p.moves || []).slice(); if (!list.length) throw new Error('沒有要登記的品項。');
  const ctx = stockCtx_(); const rec = []; const items = readAll_('items'), whs = readAll_('whs');
  const mg = mergeList_(p, list); let newQty = 0;
  if (mg) { newQty = Number(list[0].qty); list[0] = Object.assign({}, list[0], { qty: round_(newQty + mg.add) }); }
  const results = list.map(m => moveOne_(u, m, ctx, rec, items, whs));
  if (mg) mergeApply_(u, list[0], rec[0], mg, newQty, ctx, rec, items, whs);
  if (p.samePallet) samePallet_(rec);
  flushStock_(ctx); append_('txns', rec);
  return { count: results.length, results, lots: rec.filter(r => r.typeLabel === '入庫').map(r => r.lotNo) };
}
/** 生產入庫時，把其他庫別（例如廠務區）原本就有的同品號庫存跟新完成的一起包裝入庫：
 *  整批記成一筆生產入庫（一個批號、一份包裝資料，品管檢驗對這個批號），另外從來源庫別各記一筆「併入包裝」出庫；
 *  merged 欄記原有庫存的數量，工單完工量只算新完成的（qty − merged）。 */
function mergeList_(p, list) {
  const L = (p.merge || []).map(x => ({ whId: String(x.whId || '').trim(), qty: round_(Number(x.qty)) })).filter(x => x.whId && x.qty > 0);
  if (!L.length) return null;
  if (list.length !== 1 || list[0].type !== 'in') throw new Error('併入原有庫存只能用在單一品項的入庫（不能跟混裝板一起用）。');
  if (!(Number(list[0].qty) > 0)) throw new Error('新完成的數量要大於 0。');
  L.forEach(x => { if (x.whId === list[0].whId) throw new Error('原有庫存的來源庫別不能跟入庫庫別相同。'); });
  return { list: L, add: round_(L.reduce((s, x) => s + x.qty, 0)) };
}
function mergeApply_(u, m, r, mg, newQty, ctx, rec, items, whs) {
  r.merged = mg.add; if (!r.lotNo) r.lotNo = nextLot_(lotSeq_(), r.date);
  r.note = (r.note ? r.note + '；' : '') + '新完成 ' + newQty + '，併入原有庫存 ' + mg.list.map(x => x.whId + ' ' + x.qty).join('、') + '，一起包裝';
  mg.list.forEach(x => moveOne_(u, { type: 'out', purpose: '併入包裝', itemId: m.itemId, whId: x.whId, qty: x.qty, date: r.date, filler: m.filler, dept: m.dept, fillerId: m.fillerId,
    ref: r.lotNo, woNo: m.woNo || '', note: '跟新完成的一起包裝，併入批號 ' + r.lotNo + ' 入庫' }, ctx, rec, items, whs));
}
/** 混裝板：同一個棧板上的多個品項一起入庫。每個品項還是各自一筆入庫、各自一個批號（先進先出照算），
 *  用「同板批號」記住它們在同一板（= 第一筆的批號）；棧板尺寸、棧板重只記在第一筆，Packing List 才不會重複算棧板和毛重。 */
function samePallet_(rec) {
  if (rec.length < 2) return;
  if (rec.some(r => r.type !== 'in')) throw new Error('混裝板只能用在入庫。');
  if (rec.some(r => r.whCode !== rec[0].whCode)) throw new Error('同一個棧板的品項要入同一個庫別。');
  const mx = lotSeq_(); rec.forEach(r => { r.lotNo = nextLot_(mx, r.date); });
  const head = rec[0], codes = rec.map(r => r.itemCode).join('、');
  rec.forEach((r, i) => {
    r.pltNo = head.lotNo; r.ts = head.ts + i;
    if (i > 0) { r.pack = '併板'; r.palletWt = ''; }
    r.note = (r.note ? r.note + '；' : '') + (i === 0 ? '混裝板：' + codes : '混裝板，與 ' + head.lotNo + ' 同板');
  });
}
function moveOne_(u, p, ctx, rec, items, whs) {
  const item = itemByAny_(items, p.itemId); if (!item) throw new Error('找不到品號 ' + p.itemId + '。');
  if (!whs.some(w => w.code === p.whId)) throw new Error('找不到庫別 ' + p.whId + '。');
  const qty = Number(p.qty); if (!(qty > 0)) throw new Error('數量要大於 0。');
  const type = p.type; if (!['in', 'out', 'xfer'].includes(type)) throw new Error('類型不正確。');
  if (type === 'xfer') { if (!whs.some(w => w.code === p.toWhId)) throw new Error('找不到庫別 ' + p.toWhId + '。'); if (p.toWhId === p.whId) throw new Error('轉出和轉入庫別不能相同。'); }
  const date = p.date || today_();
  const f = { type, qty, date, whCode: p.whId, purpose: p.purpose || '', ref: p.ref || '', party: p.party || '', note: p.note || '' };
  ['boxes', 'spb', 'mb', 'm', 'pack', 'palletWt', 'report'].forEach(k => { if (p[k] !== undefined && p[k] !== null && p[k] !== '') f[k] = p[k]; });
  if (p.orderNo) f.orderNo = String(p.orderNo).trim();
  if (p.woNo) f.woNo = String(p.woNo).trim();
  if (p.loc) f.loc = locNorm_(p.loc);
  if (type === 'out' && p.lotNo) {   // 出庫指定批號：在庫批號就會扣這一批（沒指定的出庫照舊依先進先出推算）
    const ln = String(p.lotNo).trim().toUpperCase();
    const src = readAll_('txns').find(t => t.typeLabel === '入庫' && String(t.lotNo || '').toUpperCase() === ln);
    if (!src) throw new Error('找不到批號 ' + ln + '。');
    if (src.itemCode !== item.code) throw new Error('批號 ' + ln + ' 是 ' + src.itemCode + '，不是 ' + item.code + '。');
    f.lotNo = src.lotNo;
  }
  if (p.packLines) { const pk = packNorm_(p.packLines); if (pk.text) { f.packLines = pk.text; f.boxes = pk.boxes; delete f.spb; delete f.mb; delete f.m; } }
  if (p.filler) f.filler = String(p.filler).trim();
  if (p.dept) f.dept = String(p.dept).trim();
  if (f.filler && f.filler !== u.name && !p.fillerId) f.fillerId = '';
  if (p.fillerId) {  // 刷員工證：以系統內的人員資料為準
    const per = (ctx.people || (ctx.people = readAll_('users'))).find(x => x.id.toLowerCase() === String(p.fillerId).trim().toLowerCase());
    if (!per || per.active !== '是') throw new Error('找不到員工ID ' + p.fillerId + '，或已停用。');
    f.fillerId = per.id; f.filler = per.name; f.dept = per.dept;
  }
  let res;
  if (type === 'in') { res = adjust_(ctx, item, p.whId, qty, { date }); f.balance = res.after; }
  else if (type === 'out') { res = adjust_(ctx, item, p.whId, -qty, { date }); f.balance = res.after; }
  else {
    const a = adjust_(ctx, item, p.whId, -qty, { date }); const b = adjust_(ctx, item, p.toWhId, qty, { date });
    f.toWhCode = p.toWhId; f.balance = a.after; f.toBalance = b.after; res = { after: a.after, toAfter: b.after };
  }
  if (p.scan) f.note = (f.note ? f.note + '；' : '') + '刷條碼';
  rec.push(txnRec_(u, item, f));
  res.itemId = item.code;
  return res;
}
// ---------- 包裝明細：文字格式「5×10 + 2×12 + 1×14」（箱數×每箱數量），可任意多種 ----------
function packNorm_(v) {
  const lines = []; const re = /(\d+(?:\.\d+)?)\s*[x×*X]\s*(\d+(?:\.\d+)?)/g; let m;
  while ((m = re.exec(String(v || '')))) { const b = Number(m[1]), n = Number(m[2]); if (b > 0 && n > 0) lines.push([b, n]); }
  return { text: lines.map(l => l[0] + '×' + l[1]).join(' + '), boxes: lines.reduce((s, l) => s + l[0], 0) };
}

// ---------- 管理員修改 / 刪除異動紀錄 ----------
const TXN_EDITABLE = ['itemCode', 'whCode', 'toWhCode', 'date', 'purpose', 'qty', 'ref', 'party', 'orderNo', 'woNo', 'packLines', 'pack', 'palletWt', 'report', 'filler', 'dept', 'note', 'pltNo', 'loc', 'lotNo'];
function txnById_(id) { const t = readAll_('txns').find(x => x.id === id); if (!t) throw new Error('找不到這筆異動紀錄（可能已被刪除），請重新整理。'); return t; }
/** 依類型把「數量變化 d」套到庫存；d>0 代表這筆的數量變多 */
function applyTxnDelta_(ctx, item, t, d, date) {
  if (!d) return;
  const type = LABEL_TYPE[t.typeLabel];
  if (type === 'in' || type === 'adj') adjust_(ctx, item, t.whCode, d, { date });
  else if (type === 'out') adjust_(ctx, item, t.whCode, -d, { date });
  else if (type === 'xfer') { adjust_(ctx, item, t.whCode, -d, { date }); adjust_(ctx, item, t.toWhCode, d, { date }); }
}
function itemForTxn_(t) {
  return readAll_('items').find(i => i.code === t.itemCode) || { code: t.itemCode };
}
/** 一筆異動對各「品號__庫別」的庫存影響 */
function txnEffect_(t, sign, acc) {
  const type = LABEL_TYPE[t.typeLabel]; const q = Number(t.qty) * sign;
  const add = (wh, d) => { const k = t.itemCode + '__' + wh; acc[k] = round_((acc[k] || 0) + d); };
  if (type === 'in' || type === 'adj') add(t.whCode, q);
  else if (type === 'out') add(t.whCode, -q);
  else if (type === 'xfer') { add(t.whCode, -q); add(t.toWhCode, q); }
  return acc;
}
/** 這筆紀錄之後，相關「品號×庫別」是否已經盤點（或整批匯入庫存）過 → 回傳說明文字 */
function countedAfter_(t, keys) {
  const after = x => (t.ts && x.ts) ? Number(x.ts) > Number(t.ts) : String(x.date || '') >= String(t.date || '');
  const hits = [];
  readAll_('counts').forEach(c => {
    if (!after(c)) return; let lines = []; try { lines = JSON.parse(c.lines || '[]'); } catch (e) {}
    lines.forEach(l => { if (keys.indexOf(l.code + '__' + c.whCode) >= 0) hits.push(l.code + ' 在 ' + c.whCode + ' 已於 ' + c.date + ' 盤點'); });
  });
  readAll_('txns').forEach(x => {
    if (x.typeLabel !== '調整' || x.ref !== '匯入' || !after(x)) return;
    if (keys.indexOf(x.itemCode + '__' + x.whCode) >= 0) hits.push(x.itemCode + ' 在 ' + x.whCode + ' 已於 ' + x.date + ' 整批匯入庫存');
  });
  return hits.filter((h, i) => hits.indexOf(h) === i);
}
function txnKeys_(t) {
  const type = LABEL_TYPE[t.typeLabel]; const k = [t.itemCode + '__' + t.whCode];
  if (type === 'xfer' && t.toWhCode) k.push(t.itemCode + '__' + t.toWhCode);
  return k;
}
function updateTxn_(u, p) {
  const t = txnById_(p.id); const ch = p.changes || {}; const log = [];
  if (ch.packLines !== undefined) ch.packLines = packNorm_(ch.packLines).text;
  const type = LABEL_TYPE[t.typeLabel];
  const pick = k => ch[k] !== undefined ? String(ch[k]).trim() : t[k];
  const nq = ch.qty !== undefined ? Number(ch.qty) : Number(t.qty);
  if (ch.itemCode !== undefined) { const ni = itemByAny_(readAll_('items'), ch.itemCode); if (ni) ch.itemCode = ni.code; }
  const nItem = pick('itemCode'), nWh = pick('whCode'), nTo = pick('toWhCode');
  const stockChanged = nq !== Number(t.qty) || nItem !== t.itemCode || nWh !== t.whCode || (type === 'xfer' && nTo !== t.toWhCode);
  let newItem = null;
  if (stockChanged) {
    if (type === 'adj') throw new Error('盤點/匯入調整的品號、庫別、數量不能直接改，請重新盤點。');
    if (!(nq > 0)) throw new Error('數量要大於 0。');
    newItem = itemByAny_(readAll_('items'), nItem); if (!newItem) throw new Error('找不到品號 ' + nItem + '。');
    const whs = readAll_('whs');
    [nWh].concat(type === 'xfer' ? [nTo] : []).forEach(w => { if (!whs.some(x => x.code === w)) throw new Error('找不到庫別 ' + w + '。'); });
    if (type === 'xfer' && nWh === nTo) throw new Error('轉出和轉入庫別不能相同。');
    if (!p.force) {
      const keys = txnKeys_(t).concat(txnKeys_({ typeLabel: t.typeLabel, itemCode: nItem, whCode: nWh, toWhCode: nTo }));
      const hits = countedAfter_(t, keys);
      if (hits.length) throw new Error('COUNTED:' + hits.join('；'));
    }
    // 先算淨變化（舊的還原 + 新的套用），再一次調整庫存，避免中途誤判庫存不足
    const acc = txnEffect_(t, -1, {});
    txnEffect_({ typeLabel: t.typeLabel, itemCode: nItem, whCode: nWh, toWhCode: nTo, qty: nq }, 1, acc);
    const ctx = stockCtx_(); const items = readAll_('items');
    Object.keys(acc).forEach(k => { if (!acc[k]) return; const [ic, wh] = k.split('__'); adjust_(ctx, items.find(i => i.code === ic) || { code: ic }, wh, acc[k], {}); });
    flushStock_(ctx);
  }
  if (ch.lotNo !== undefined) {   // 批號：入庫的批號不能改（品管檢驗跟著它）；出庫可以補上／改成實際出貨的批號
    if (t.typeLabel !== '出庫') delete ch.lotNo;
    else if (String(ch.lotNo).trim()) {
      const ln = String(ch.lotNo).trim().toUpperCase();
      const src = readAll_('txns').find(x => x.typeLabel === '入庫' && String(x.lotNo || '').toUpperCase() === ln);
      if (!src) throw new Error('找不到批號 ' + ln + '。');
      if (src.itemCode !== pick('itemCode')) throw new Error('批號 ' + ln + ' 是 ' + src.itemCode + '，不是 ' + pick('itemCode') + '。');
      ch.lotNo = src.lotNo;
    }
  }
  TXN_EDITABLE.forEach(k => {
    if (ch[k] === undefined) return;
    const nv = F.txns.find(f => f[0] === k)[2] === 'n' ? (ch[k] === '' || ch[k] === null ? null : Number(ch[k])) : String(ch[k]).trim();
    const ov = t[k] === '' ? null : t[k];
    if (String(nv ?? '') === String(ov ?? '')) return;
    const label = F.txns.find(f => f[0] === k)[1];
    log.push(label + ' ' + (ov ?? '空白') + '→' + (nv ?? '空白'));
    t[k] = nv;
  });
  if (ch.packLines !== undefined && log.some(x => x.indexOf('包裝明細') === 0)) {
    t.boxes = packNorm_(t.packLines).boxes || null; t.spb = null; t.mb = null; t.m = null;
  }
  if (!log.length) return { changed: 0 };
  if (newItem) { t.itemName = newItem.name; t.spec = newItem.spec || ''; t.unit = newItem.unit; t.cat = newItem.cat; }
  if (!t.date) throw new Error('日期不能空白。');
  const line = nowStr_() + ' ' + u.name + '：' + log.join('、');
  t.edited = t.edited ? t.edited + '\n' + line : line;
  update_('txns', t);
  return { changed: log.length };
}
function deleteTxn_(u, p) {
  const t = txnById_(p.id);
  if (!p.force && LABEL_TYPE[t.typeLabel] !== 'adj') {
    const hits = countedAfter_(t, txnKeys_(t));
    if (hits.length) throw new Error('COUNTED:' + hits.join('；'));
  }
  const ctx = stockCtx_();
  applyTxnDelta_(ctx, itemForTxn_(t), t, -Number(t.qty), '');  // 把這筆對庫存的影響還原
  flushStock_(ctx);
  deleteRow_('txns', t);
  return true;
}

function stocktake_(u, p) {
  whOf_(p.whId); const date = p.date || today_(); const ctx = stockCtx_();
  const items = {}; readAll_('items').forEach(i => items[i.code] = i);
  const lines = [], recs = [];
  (p.entries || []).forEach(e => {
    const item = items[e.itemId]; if (!item) return;
    const n = Number(e.n); if (!(n >= 0)) throw new Error(item.code + ' 的實盤數量不正確。');
    const r = adjust_(ctx, item, p.whId, 0, { setTo: n, allowNeg: true, date });
    const diff = round_(r.after - r.before);
    let pk = null;
    if (e.packLines !== undefined) {  // 盤點時登記的包裝方式，存成這個庫別目前的包裝狀態
      pk = packNorm_(e.packLines); const st = ctx.map[item.code + '__' + p.whId];
      st.packLines = pk.text; st.packAt = pk.text ? date : '';
    }
    if (diff !== 0) {
      const t = { type: 'adj', whCode: p.whId, qty: diff, date, ref: '盤點', purpose: '盤點調整', note: e.note || '', balance: r.after };
      if (pk && pk.text) { t.packLines = pk.text; t.boxes = pk.boxes; }
      recs.push(txnRec_(u, item, t));
    }
    lines.push({ code: item.code, name: item.name, book: r.before, counted: n, diff, cost: item.cost || 0, note: e.note || '', pack: pk ? pk.text : undefined });
  });
  flushStock_(ctx); append_('txns', recs);
  const dl = lines.filter(l => l.diff !== 0);
  append_('counts', [{ date, whCode: p.whId, cat: p.cat || '全部', total: lines.length, diffCount: dl.length, diffAmt: dl.reduce((s, l) => s + l.diff * l.cost, 0), filler: u.name, lines: JSON.stringify(lines), ts: Date.now() }]);
  return { total: lines.length, diffCount: dl.length };
}
function saveLoc_(u, p) {
  const r = readAll_('stock').find(s => s.itemId === p.itemId && s.whId === p.whId);
  if (!r) throw new Error('找不到這筆庫存。');
  r.loc = String(p.loc || '').trim(); update_('stock', r); return true;
}

// ---------- 品號 / 庫別（管理員） ----------
function saveItem_(u, p) {
  const it = p.item || {}; const code = String(it.code || '').trim();
  if (!code || !String(it.name || '').trim()) throw new Error('品號和品名必填。');
  const all = readAll_('items');
  const oldCode = p.isNew ? code : String(p.oldCode || code).trim();
  const ex = all.find(i => i.code === oldCode);
  if (!p.isNew && !ex) throw new Error('找不到品號 ' + oldCode + '。');
  const dup = all.find(i => i !== ex && i.code.toLowerCase() === code.toLowerCase());
  if (dup) throw new Error('品號 ' + dup.code + ' 已經存在。');
  const before = ex ? { code: ex.code, name: ex.name, spec: ex.spec, unit: ex.unit } : null;
  const others = all.filter(i => i !== ex);
  const aliases = aliasList_(it.alias).filter((a, k, arr) => a.toLowerCase() !== code.toLowerCase() && arr.findIndex(b => b.toLowerCase() === a.toLowerCase()) === k);
  aliases.forEach(a => {
    const o = others.find(i => i.code.toLowerCase() === a.toLowerCase());
    if (o) throw new Error('舊料號 ' + a + ' 目前是一個獨立的品號，請用「合併」把它併進來。');
    const o2 = others.find(i => aliasList_(i.alias).some(x => x.toLowerCase() === a.toLowerCase()));
    if (o2) throw new Error('舊料號 ' + a + ' 已經是品號 ' + o2.code + ' 的別名。');
  });
  const o3 = others.find(i => aliasList_(i.alias).some(x => x.toLowerCase() === code.toLowerCase()));
  if (o3) throw new Error(code + ' 已經是品號 ' + o3.code + ' 的舊料號/別名。');
  const rec = Object.assign(ex || {}, {
    code, name: String(it.name).trim(), nameEn: it.nameEn || '', spec: it.spec || '', unit: it.unit || 'PCS', cat: it.cat || '成品/半成品',
    mainWh: it.mainWh || '', safety: Number(it.safety) || 0, cost: ex ? (Number(ex.cost) || 0) : (Number(it.cost) || 0),  // 單價只能由採購在「材料單價」修改（留紀錄）
    netWt: it.netWt === '' || it.netWt == null ? '' : Number(it.netWt), grossWt: it.grossWt === '' || it.grossWt == null ? '' : Number(it.grossWt), note: it.note || '',
    alias: aliases.join(', '), specEn: it.specEn !== undefined ? String(it.specEn || '').trim() : (ex ? ex.specEn || '' : ''),
    erpWh: it.erpWh !== undefined ? String(it.erpWh || '').trim() : (ex ? ex.erpWh || '' : '')
  });
  if (ex) update_('items', rec); else append_('items', [rec]);
  if (before && (before.code !== rec.code || before.name !== rec.name || before.spec !== rec.spec || before.unit !== rec.unit)) syncItemRefs_(before.code, rec);
  costItemFromItem_(before ? before.code : rec.code, rec);
  const init = Number(p.init) || 0;
  if (p.isNew && init > 0) {
    if (!rec.mainWh) throw new Error('品號已建立，但要登錄期初數量需先選擇主要庫別。');
    const ctx = stockCtx_(); const r = adjust_(ctx, rec, rec.mainWh, init, { date: today_() }); flushStock_(ctx);
    append_('txns', [txnRec_(u, rec, { type: 'in', whCode: rec.mainWh, qty: init, date: today_(), purpose: '期初', note: '建立品號時登錄', balance: r.after })]);
  }
  if (bomParents_()[code]) syncBomCosts_();
  return true;
}
/** 品號修改後，成本資料庫的品名、規格、單位跟著改；改編號時 BOM、單價紀錄一起換 */
function costItemFromItem_(oldCode, it) {
  const ci = readAll_('costItems').find(x => x.code === oldCode || x.code.toLowerCase() === String(it.code).toLowerCase());
  if (oldCode !== it.code) { replaceCol_('bom', 'code', oldCode, it.code); replaceCol_('bom', 'parent', oldCode, it.code); replaceCol_('bomHeads', 'parent', oldCode, it.code);
    replaceCol_('bomLog', 'parent', oldCode, it.code); replaceCol_('costLog', 'itemCode', oldCode, it.code); COSTLOG_CACHE_ = null; BOMC_CACHE_ = null; }
  if (!ci) return;
  if (ci.code !== it.code || ci.name !== it.name || String(ci.spec || '') !== String(it.spec || '') || ci.unit !== it.unit) {
    ci.code = it.code; ci.name = it.name; ci.spec = it.spec || ''; ci.unit = it.unit; ci.updatedAt = nowStr_(); update_('costItems', ci); }
}
/** 品號或品名修改後，同步更新庫存、異動紀錄與 Packing List 裡的資料 */
function syncItemRefs_(oldCode, it) {
  const col = k => F.txns.findIndex(f => f[0] === k);
  if (oldCode !== it.code) {
    readAll_('stock').filter(r => r.itemId === oldCode).forEach(r => { r.itemId = it.code; update_('stock', r); });
  }
  const s = sh_('txns'); const last = s.getLastRow();
  if (last >= 2) {
    const rg = s.getRange(2, 1, last - 1, F.txns.length); const v = rg.getValues(); let n = 0;
    const ci = col('itemCode'), cn = col('itemName'), cs = col('spec'), cu = col('unit');
    v.forEach(r => { if (String(r[ci]) === oldCode) { r[ci] = it.code; r[cn] = it.name; r[cs] = it.spec || ''; r[cu] = it.unit || ''; n++; } });
    if (n) { rg.setValues(v); READ_MEMO_ = {}; }
  }
  if (oldCode !== it.code) {
    const walk = o => { if (Array.isArray(o)) return o.map(walk); if (o && typeof o === 'object') { Object.keys(o).forEach(k => o[k] = walk(o[k])); return o; } return o === oldCode ? it.code : o; };
    readAll_('packings').forEach(pk => { const j = pk.json || ''; if (j.indexOf(JSON.stringify(oldCode)) < 0) return; pk.json = JSON.stringify(walk(JSON.parse(j))); update_('packings', pk); });
  }
}
/** 合併品號：把 from（例如舊料號）的庫存、異動紀錄、Packing List 併到 into，from 變成 into 的舊料號後刪除 */
function mergeItem_(u, p) {
  const items = readAll_('items');
  const from = items.find(i => i.code === p.from), into = items.find(i => i.code === p.into);
  if (!from || !into) throw new Error('找不到要合併的品號。');
  if (from === into) throw new Error('不能和自己合併。');
  // 1. 庫存：同庫別相加，其他庫別直接改掛
  const stock = readAll_('stock'); const del = [];
  stock.filter(r => r.itemId === from.code).forEach(r => {
    const t = stock.find(x => x.itemId === into.code && x.whId === r.whId);
    if (t) {
      t.qty = round_((Number(t.qty) || 0) + (Number(r.qty) || 0)); if (!t.loc && r.loc) t.loc = r.loc;
      ['lastInAt', 'lastOutAt'].forEach(k => { if (String(r[k] || '') > String(t[k] || '')) t[k] = r[k]; });
      update_('stock', t); del.push(r);
    } else { r.itemId = into.code; update_('stock', r); }
  });
  del.sort((a, b) => b._row - a._row).forEach(r => deleteRow_('stock', r));
  // 2. 異動紀錄與 Packing List 改掛新品號
  syncItemRefs_(from.code, into);
  // 3. 舊品號變成別名，並刪除舊品號
  const al = aliasList_(into.alias).concat([from.code], aliasList_(from.alias));
  into.alias = al.filter((a, k) => al.findIndex(b => b.toLowerCase() === a.toLowerCase()) === k && a.toLowerCase() !== into.code.toLowerCase()).join(', ');
  if (!Number(into.safety) && Number(from.safety)) into.safety = from.safety;
  ['nameEn', 'spec', 'netWt', 'grossWt', 'mainWh'].forEach(k => { if ((into[k] === '' || into[k] == null) && from[k] !== '' && from[k] != null) into[k] = from[k]; });
  update_('items', into);
  deleteRow_('items', readAll_('items').find(i => i.code === from.code));
  // BOM、單價紀錄改用合併後的品號；成本資料庫若兩個都有，留下合併後的那筆
  ['code', 'parent'].forEach(f => replaceCol_('bom', f, from.code, into.code)); replaceCol_('bomHeads', 'parent', from.code, into.code); replaceCol_('costLog', 'itemCode', from.code, into.code);
  const cis = readAll_('costItems'); const cf = cis.find(x => x.code === from.code);
  if (cf) { if (cis.some(x => x.code === into.code)) deleteRow_('costItems', cf); else { cf.code = into.code; update_('costItems', cf); } }
  syncCostItems_(); BOMC_CACHE_ = null; syncBomCosts_();
  return { into: into.code, alias: into.alias };
}
/** 料號對照整批換號：rows = [{ old, new }]。新料號不存在 → 改號並把舊料號放進別名；新料號已是另一個品號 → 合併 */
function renameItems_(u, p) {
  const rows = (p.rows || []).map(r => ({ o: String(r.old || '').trim(), n: String(r.new || '').trim() })).filter(r => r.o && r.n);
  let items = readAll_('items'); const res = { renamed: 0, merged: 0, skipped: [] };
  const plan = {}; const merges = [];
  rows.forEach(r => {
    const from = itemByAny_(items, r.o);
    if (!from) { res.skipped.push(r.o + '（找不到）'); return; }
    if (from.code.toLowerCase() === r.n.toLowerCase()) { res.skipped.push(r.o + '（已經是 ' + from.code + '）'); return; }
    const target = itemByAny_(items, r.n);
    if (target && target !== from) { merges.push([from.code, target.code]); return; }
    if (Object.values(plan).some(x => x.toLowerCase() === r.n.toLowerCase())) { res.skipped.push(r.o + '（新料號 ' + r.n + ' 重複）'); return; }
    plan[from.code] = r.n;
  });
  // 1. 改號（一次處理，避免重複讀寫整張表）
  const olds = Object.keys(plan);
  if (olds.length) {
    items.forEach(it => {
      const nw = plan[it.code]; if (!nw) return;
      const al = [it.code].concat(aliasList_(it.alias)).filter((a, k, arr) => a.toLowerCase() !== nw.toLowerCase() && arr.findIndex(b => b.toLowerCase() === a.toLowerCase()) === k);
      it.code = nw; it.alias = al.join(', '); update_('items', it); res.renamed++;
    });
    readAll_('stock').forEach(r => { if (plan[r.itemId]) { r.itemId = plan[r.itemId]; update_('stock', r); } });
    const sh = sh_('txns'); const last = sh.getLastRow();
    if (last >= 2) {
      const ci = F.txns.findIndex(f => f[0] === 'itemCode');
      const rg = sh.getRange(2, ci + 1, last - 1, 1); const v = rg.getValues(); let n = 0;
      v.forEach(r => { const nw = plan[String(r[0])]; if (nw) { r[0] = nw; n++; } });
      if (n) { rg.setValues(v); READ_MEMO_ = {}; }
    }
    const walk = o => { if (Array.isArray(o)) return o.map(walk); if (o && typeof o === 'object') { Object.keys(o).forEach(k => o[k] = walk(o[k])); return o; } return (typeof o === 'string' && plan[o]) ? plan[o] : o; };
    readAll_('packings').forEach(pk => { if (!olds.some(c => (pk.json || '').indexOf(JSON.stringify(c)) >= 0)) return; pk.json = JSON.stringify(walk(JSON.parse(pk.json))); update_('packings', pk); });
  }
  // 2. 合併（新料號已經是另一個品號）
  merges.forEach(m => { const into = plan[m[1]] || m[1]; mergeItem_(u, { from: plan[m[0]] || m[0], into }); res.merged++; });
  return res;
}
/** 客戶庫存表：整批補英文品名 / 英文規格。list = [{ code, nameEn?, specEn? }] */
function saveEnglish_(u, p) {
  const items = readAll_('items'); let n = 0;
  (p.list || []).forEach(x => {
    const it = items.find(i => i.code === x.code); if (!it) return; let ch = false;
    ['nameEn', 'specEn'].forEach(k => { if (x[k] !== undefined && String(x[k]).trim() !== String(it[k] || '')) { it[k] = String(x[k]).trim(); ch = true; } });
    if (ch) { update_('items', it); n++; }
  });
  return { changed: n };
}
/** 批次設定安全存量：list = [{ code, safety }] */
function setSafety_(u, p) {
  const list = p.list || []; const items = readAll_('items'); let n = 0;
  list.forEach(x => {
    const it = items.find(i => i.code === x.code); if (!it) return;
    const v = Number(x.safety); if (!(v >= 0)) throw new Error(x.code + ' 的安全存量要是 0 以上的數字。');
    if (Number(it.safety || 0) === v) return;
    it.safety = v; update_('items', it); n++;
  });
  return { changed: n };
}
function deleteItem_(u, p) {
  const ex = readAll_('items').find(i => i.code === p.id); if (!ex) throw new Error('找不到品號。');
  const usedIn = [...new Set(readAll_('bom').filter(b => b.code === ex.code || b.parent === ex.code).map(b => b.parent))];
  if (usedIn.length) throw new Error(ex.code + ' 還在 BOM 裡使用（' + usedIn.slice(0, 8).join('、') + (usedIn.length > 8 ? ' 等' : '') + '），請先從 BOM 移除。');
  const ci = readAll_('costItems').find(x => x.code === ex.code); if (ci) deleteRow_('costItems', ci);
  readAll_('stock').filter(s => s.itemId === p.id).sort((a, b) => b._row - a._row).forEach(s => deleteRow_('stock', s));
  deleteRow_('items', readAll_('items').find(i => i.code === p.id));
  return true;
}
function saveWh_(u, p) {
  const code = String(p.code || '').trim(); if (!code) throw new Error('請輸入庫別代號。');
  const ex = readAll_('whs').find(w => w.code === code);
  const pm = perms_(u);  // 管理員可改所有庫別；生管、生產主管只能新增／修改「生產地點」和「委外廠商」
  if (!pm.admin) { const okT = t => t === '生產' || t === '委外';
    if (!(pm.plan || pm.prodLead) || !okT(p.type || (ex && ex.type)) || (ex && !okT(ex.type))) throw new Error('倉庫庫別只有管理員可以修改；生管、生產主管可以新增生產地點和委外廠商。'); }
  if (p.isNew && ex) throw new Error('庫別 ' + code + ' 已存在。');
  const type = ['倉庫', '生產', '委外'].indexOf(p.type) >= 0 ? p.type : (ex && ex.type) || '倉庫';
  if (ex) { if (p.name != null) ex.name = String(p.name || '').trim(); ex.type = type; update_('whs', ex); }
  else append_('whs', [{ code, name: String(p.name || '').trim(), type }]);
  return true;
}
/** 庫別（倉庫、生產地點、委外廠商）改代號：庫存、異動紀錄、品號、工單、銷貨、報工等用到的地方全部一起換 */
const WH_REFS_ = [['stock', 'whId'], ['txns', 'whCode'], ['txns', 'toWhCode'], ['counts', 'whCode'], ['items', 'mainWh'], ['wos', 'whIn'], ['wos', 'site'], ['woMats', 'whOut'],
  ['woOps', 'vendor'], ['woOut', 'vendor'], ['woReports', 'site'], ['sales', 'whId'], ['salesLines', 'whId'], ['ops', 'site']];
function renameWh_(u, p) {
  const from = String(p.from || '').trim(), to = String(p.to || '').trim();
  if (!from || !to) throw new Error('請填新的代號。'); if (from === to) return { count: 0 };
  const whs = readAll_('whs'); const w = whs.find(x => x.code === from); if (!w) throw new Error('找不到庫別 ' + from + '。');
  if (whs.some(x => x.code === to)) throw new Error('代號 ' + to + ' 已經存在。');
  const pm = perms_(u); const t = w.type || '倉庫';
  if (!pm.admin && !((pm.plan || pm.prodLead) && (t === '生產' || t === '委外'))) throw new Error('倉庫庫別只有管理員可以改代號。');
  let n = 0; WH_REFS_.forEach(([k, f]) => { n += replaceCol_(k, f, from, to); });
  w.code = to; update_('whs', w);
  return { count: n };
}
function deleteWh_(u, p) {
  const ex = readAll_('whs').find(w => w.code === p.code); if (!ex) throw new Error('找不到庫別。');
  if (readAll_('stock').some(s => s.whId === p.code && Number(s.qty))) throw new Error('這個庫別還有庫存，不能刪除。');
  deleteRow_('whs', ex); return true;
}
function ensureWh_(code, name) {
  code = String(code || '').trim(); if (!code) return '';
  if (!readAll_('whs').some(w => w.code === code)) append_('whs', [{ code, name: name || '' }]);
  return code;
}
function importItems_(u, p) {
  let made = 0, upd = 0; const all = readAll_('items'); const map = {}; all.forEach(i => map[i.code] = i);
  const add = [], costLogs = [];
  (p.rows || []).forEach(r => {
    const code = String(r.code || '').trim(); if (!code || !r.name) return;
    const wh = r.wh ? ensureWh_(r.wh, r.whName) : '';
    const ex = map[code];
    const rec = Object.assign(ex || { safety: 0, cost: 0 }, { code, name: r.name });
    ['nameEn', 'spec', 'specEn', 'unit', 'cat', 'alias'].forEach(k => { if (r[k]) rec[k] = r[k]; });
    if (wh) rec.mainWh = wh;
    const oldCost = ex ? Number(ex.cost) || 0 : 0;
    ['safety', 'cost', 'netWt', 'grossWt'].forEach(k => { if (r[k] !== undefined && r[k] !== '' && !isNaN(Number(r[k]))) rec[k] = Number(r[k]); });
    if (Number(rec.cost) !== oldCost && Number(rec.cost)) costLogs.push({ id: 'C' + Date.now() + '_' + costLogs.length, itemCode: code, effDate: today_(), oldCost: ex ? oldCost : '', newCost: Number(rec.cost),
      currency: 'TWD', supplier: '', note: '品號匯入', byId: u.id, byName: u.name, at: nowStr_() });
    if (!rec.unit) rec.unit = 'PCS'; if (!rec.cat) rec.cat = '成品/半成品';
    if (ex) { update_('items', rec); upd++; } else { add.push(rec); map[code] = rec; made++; }
  });
  append_('items', add); append_('costLog', costLogs); COSTLOG_CACHE_ = null; syncCostItems_(); syncBomCosts_();
  return { made, upd };
}
function importStock_(u, p) {
  const items = {}; const allItems = readAll_('items'); allItems.forEach(i => items[i.code] = i);
  const ctx = stockCtx_(); const recs = []; const date = today_(); let changed = 0;
  (p.rows || []).forEach(r => {
    const item = items[String(r.code || '').trim()] || itemByAny_(allItems, r.code); if (!item) return;
    const wh = ensureWh_(r.wh, r.whName);
    const res = adjust_(ctx, item, wh, 0, { setTo: Number(r.qty) || 0, allowNeg: true });
    if (r.loc) ctx.map[item.code + '__' + wh].loc = r.loc;
    const diff = round_(res.after - res.before);
    if (diff !== 0) { recs.push(txnRec_(u, item, { type: 'adj', whCode: wh, qty: diff, date, ref: '匯入', purpose: res.before === 0 ? '期初' : '匯入調整', note: 'Excel 匯入', balance: res.after })); changed++; }
  });
  flushStock_(ctx); append_('txns', recs);
  return { changed };
}

// ---------- Packing List ----------
function getPacking_(u, p) {
  const sc = String(p.sc || '').trim();
  const saved = readAll_('packings').find(x => x.sc === sc);
  let txns = txnsQuery_(u, { ref: sc }); let fromSale = false;
  // 沒有出庫紀錄（例如從鼎新匯入、或倉庫還沒確認出貨）：改用銷貨單明細，包裝方式依這個品號最近一次的每箱數量推算
  if (!txns.some(t => t.type === 'out')) {
    const s = readAll_('sales').find(x => x.no === sc);
    if (s) {
      fromSale = true; const all = readAll_('txns');
      const spbOf = code => { for (let i = all.length - 1; i >= 0; i--) { const t = all[i]; if (t.itemCode !== code) continue;
        const m = String(t.packLines || '').match(/(\d+(?:\.\d+)?)\s*[x×*X]\s*(\d+(?:\.\d+)?)/); if (m && Number(m[2]) > 0) return Number(m[2]); if (Number(t.spb) > 0) return Number(t.spb); } return 0; };
      txns = readAll_('salesLines').filter(l => l.saleNo === sc).map((l, i) => {
        const q = Number(l.shipQty || l.qty || 0), spb = spbOf(l.itemCode); let pl = '';
        if (spb && q) { const f = Math.floor(q / spb), r = round_(q - f * spb); pl = [f ? f + '×' + spb : '', r ? '1×' + r : ''].filter(Boolean).join(' + '); }
        return { type: 'out', typeLabel: '出庫', itemId: l.itemCode, itemCode: l.itemCode, itemName: l.name, qty: q, packLines: pl, ref: sc, party: s.customer,
          date: String(s.shippedAt || s.date || '').slice(0, 10), ts: i, palletWt: '', pack: '' };
      }).filter(t => t.qty > 0);
    }
  }
  const party = (txns.find(t => t.type === 'out' && t.party) || {}).party || '';
  let cons = party ? readAll_('consignees').find(c => c.company === party) : null;
  // 還沒存過收件資訊：用客戶主檔的英文名稱、聯絡人、電話、地址先帶
  if (!cons) { const s0 = readAll_('sales').find(x => x.no === sc); const cu = readAll_('customers').find(c => (s0 && c.code === s0.custCode) || (party && (c.short === party || c.full === party)));
    if (cu) { const nm = cu.nameEn || cu.full || party; cons = { company: nm, to: '', consignee: [[cu.contact, cu.phone ? 'Tel: ' + cu.phone : ''].filter(Boolean).join(' '), nm ? 'Company: ' + nm : '', cu.shipTo || cu.address || ''].filter(Boolean).join('\n') }; } }
  // 還沒真的出庫時，列出這些品號「已入庫、還沒出庫」的棧板（含尺寸、棧板重），讓業務勾選要出哪些
  let lots = null;
  if (fromSale || p.allLots) {
    const codes = {}; txns.forEach(t => { if (t.type === 'out') codes[t.itemCode] = 1; });
    lots = stockLots_(p.allLots ? null : codes, sc);
  }
  return { saved: saved ? { data: JSON.parse(saved.json || '{}'), updatedAt: saved.updatedAt, byName: saved.byName } : null, txns, fromSale, lots, consignee: cons ? clean_(cons) : null };
}
/** 還沒出庫的入庫批：
 *  1. 已存在其他 Packing List 的勾選（picks）先扣掉 → 那一批下次就選不到
 *  2. 再用目前庫存當上限（扣掉其他單已勾選、但倉庫還沒登記出庫的數量），由最新的入庫往回分配；分不到的舊批視為已出庫
 *  這張單自己勾過的批號一定列出來，並帶回當時勾的數量（own） */
function lotUse_(sc, inclReserved) {
  const outRefs = {}; readAll_('txns').forEach(t => { if (t.typeLabel === '出庫' && t.ref) outRefs[t.ref] = 1; });
  const used = {}, reserved = {}, own = {}, ownK = {};
  // 出入庫登記時指定批號的出庫：直接算這一批用掉了
  const lotId = {}; readAll_('txns').forEach(t => { if (t.typeLabel === '入庫' && t.lotNo) lotId[t.lotNo] = t.id; });
  readAll_('txns').forEach(t => { if (t.typeLabel === '出庫' && t.lotNo && lotId[t.lotNo]) used[lotId[t.lotNo]] = (used[lotId[t.lotNo]] || 0) + (Number(t.qty) || 0); });
  readAll_('packings').forEach(pk => { let d; try { d = JSON.parse(pk.json || '{}'); } catch (e) { return; }
    (d.picks || []).forEach(p => { const q = Number(p.qty) || 0; if (!(q > 0) || !p.lotId) return; const k = p.itemCode + '__' + p.whId;
      if (inclReserved && pk.sc !== sc && !outRefs[pk.sc]) return;   // 棧板調整：還沒出貨的 Packing List 勾的貨也列出來
      if (pk.sc === sc) { own[p.lotId] = (own[p.lotId] || 0) + q; ownK[k] = (ownK[k] || 0) + q; }
      else { used[p.lotId] = (used[p.lotId] || 0) + q; if (!outRefs[pk.sc]) reserved[k] = (reserved[k] || 0) + q; } }); });
  return { used, reserved, own, ownK, scOut: !!outRefs[sc] };
}
function stockLots_(codes, sc, opt) {
  fillLotNos_();
  const U = lotUse_(sc, !!(opt && opt.inclReserved));
  const skip = {}; readAll_('whs').forEach(w => { if (w.type === '委外') skip[w.code] = 1; });
  const cap = {}; const want = k => { const c = k.split('__')[0], w = k.split('__')[1]; return !skip[w] && (!codes || codes[c]); };
  readAll_('stock').forEach(s => { const k = s.itemId + '__' + s.whId; if (want(k)) cap[k] = Number(s.qty) || 0; });
  Object.keys(U.reserved).forEach(k => { if (want(k)) cap[k] = (cap[k] || 0) - U.reserved[k]; });
  if (U.scOut) Object.keys(U.ownK).forEach(k => { if (want(k)) cap[k] = (cap[k] || 0) + U.ownK[k]; });
  const names = {}; readAll_('items').forEach(i => names[i.code] = i.name);
  const ins = readAll_('txns').map(txnOut_).filter(t => (t.type === 'in' && cap[t.itemCode + '__' + t.whCode] > 0) || (t.type === 'xfer' && cap[t.itemCode + '__' + t.toWhCode] > 0))
    .sort((a, b) => (U.own[b.id] ? 1 : 0) - (U.own[a.id] ? 1 : 0) || String(b.date).localeCompare(String(a.date)) || (Number(b.ts) || 0) - (Number(a.ts) || 0));
  const out = [];
  ins.forEach(t => {
    const wh = t.type === 'xfer' ? t.toWhCode : t.whCode, k = t.itemCode + '__' + wh, rest = cap[k] || 0, q0 = Number(t.qty) || 0;
    const avail = round_(q0 - (U.used[t.id] || 0)); if (!(rest > 0) || !(avail > 0)) return;
    const q = round_(Math.min(rest, avail)); cap[k] = round_(rest - q);
    out.push({ lotId: t.id || '', lotNo: t.lotNo || '', date: String(t.date || '').slice(0, 10), itemCode: t.itemCode, itemName: t.itemName || names[t.itemCode] || '', whId: wh,
      qty: q, qtyIn: q0, partial: q < q0, own: U.own[t.id] || 0, packLines: t.packLines || '', boxes: t.boxes || '', spb: t.spb || '', mb: t.mb || '', m: t.m || '',
      pack: t.pack || '', palletWt: Number(t.palletWt) || 0, ref: t.ref || '', woNo: t.woNo || '', xfer: t.type === 'xfer', ts: Number(t.ts) || 0, pltNo: t.pltNo || '',
      pltHead: !!t.pltNo && t.pltNo === t.lotNo, loc: t.loc || '' });
  });
  // 棧板調整（併板／改包裝）：入庫紀錄不動，用最新的棧板資料蓋過包裝資訊
  const PO = palletOverlay_();
  out.forEach(o => { const x = o.lotNo && PO[o.lotNo]; if (!x) return;
    o.pltNo = x.id; o.pltHead = x.head; o.adjusted = x.id; if (x.packLines) o.packLines = x.packLines; if (x.loc) o.loc = x.loc;
    if (x.head) { o.pack = x.pack || ''; o.palletWt = Number(x.palletWt) || 0; } else { o.pack = '併板'; o.palletWt = 0; } });
  Object.keys(cap).forEach(k => { if (cap[k] > 0) { const c = k.split('__')[0], w = k.split('__')[1];
    out.push({ lotId: '', lotNo: '', date: '', itemCode: c, itemName: names[c] || '', whId: w, qty: round_(cap[k]), qtyIn: 0, noLot: true, packLines: '', pack: '', palletWt: 0, ref: '', ts: 0 }); } });
  // 混裝板的幾個品項排在一起（排在該板第一個品項的位置），Packing List 才會算成同一板
  const head = {}; out.forEach(o => { if (o.pltNo && (!head[o.pltNo] || o.pltHead)) head[o.pltNo] = o; });
  const gk = o => { const h = o.pltNo && head[o.pltNo] || o; return [h.itemCode, String(h.date || '9'), h.ts]; };
  return out.sort((a, b) => { const x = gk(a), y = gk(b); return x[0].localeCompare(y[0]) || x[1].localeCompare(y[1]) || x[2] - y[2] ||
    (a.pltNo && a.pltNo === b.pltNo ? ((b.pltHead ? 1 : 0) - (a.pltHead ? 1 : 0)) || a.ts - b.ts : 0); }).slice(0, 1500);
}
/** Packing List 上修正品號的單位淨重／毛重，存回品號主檔 */
function setItemWeights_(u, p) {
  const pm = perms_(u); if (!(pm.sales || pm.wh || u.role === 'admin')) throw new Error('只有業務、倉庫或管理員可以修改品號重量。');
  const items = readAll_('items'); let n = 0;
  (p.list || []).forEach(x => { const it = items.find(i => i.code === x.code); if (!it) return;
    const nw = Number(x.netWt), gw = Number(x.grossWt); if (!(nw > 0) || !(gw > 0)) throw new Error(x.code + ' 的淨重、毛重都要大於 0。');
    if (gw < nw) throw new Error(x.code + ' 的毛重不能小於淨重。');
    if (Number(it.netWt) === nw && Number(it.grossWt) === gw) return;
    it.netWt = nw; it.grossWt = gw; update_('items', it); n++; });
  return { count: n };
}
function savePacking_(u, p) {
  const d = p.data || {}; const sc = String(d.sc || '').trim(); if (!sc) throw new Error('缺少銷貨單號。');
  // 勾選的入庫批不能超過可出數量（避免兩張 Packing List 用到同一批）
  const picks = (d.picks || []).filter(x => x.lotId && Number(x.qty) > 0);
  if (picks.length) {
    const codes = {}; picks.forEach(x => codes[x.itemCode] = 1); const L = {}; stockLots_(codes, sc).forEach(l => { if (l.lotId) L[l.lotId] = l; });
    const sum = {}; picks.forEach(x => sum[x.lotId] = round_((sum[x.lotId] || 0) + Number(x.qty)));
    Object.keys(sum).forEach(id => { const l = L[id], x = picks.find(y => y.lotId === id);
      if (!l || sum[id] > l.qty) throw new Error('入庫批號 ' + (x.lotNo || id) + '（' + x.itemCode + '）目前只剩 ' + (l ? l.qty : 0) + ' 可出，可能已被其他 Packing List 用掉，請按「重新帶出」再勾選。'); });
  }
  const ex = readAll_('packings').find(x => x.sc === sc);
  const rec = Object.assign(ex || {}, { sc, json: JSON.stringify(d), updatedAt: nowStr_(), byName: u.name });
  if (ex) update_('packings', rec); else append_('packings', [rec]);
  if (d.company) {
    const c = readAll_('consignees').find(x => x.company === d.company);
    const cr = Object.assign(c || {}, { company: d.company, consignee: d.consignee || '', to: d.to || '', updatedAt: nowStr_() });
    if (c) update_('consignees', cr); else append_('consignees', [cr]);
  }
  return { updatedAt: rec.updatedAt, byName: u.name };
}


// ======================= 報價單 / 訂單 =======================
/** 職能權限：業務看得到單價、能建立報價單和訂單；資材填成本與交期；成本業務也看得到；管理員全部 */
function perms_(u) {
  const p = String(u.perms || ''); const admin = u.role === 'admin';
  const sales = admin || p.indexOf('業務') >= 0, mat = admin || p.indexOf('採購') >= 0 || p.indexOf('資材') >= 0;  // 採購（舊名稱「資材」）：報價回覆、材料單價
  const prod = admin || p.indexOf('生產') >= 0;   // 「生產主管」也包含「生產」
  const prodLead = admin || p.indexOf('生產主管') >= 0;
  const wh = admin || p.indexOf('倉庫') >= 0 || (u.role === 'user' && !p.trim());  // 沒勾任何職能的一般帳號視為倉庫
  const plan = admin || p.indexOf('生管') >= 0;  // 生管：開工單、決定生產地點與委外、登記委外送出/收回
  return { sales, mat, buy: mat, wh, prod, prodLead, plan, price: sales, cost: sales || mat, admin };
}
/** 出入庫、盤點只限倉庫或生產人員 */
function whOnly_(fn) { return function (u, p) { const pm = perms_(u); if (!(pm.wh || pm.prod)) throw new Error('只有倉庫或生產人員可以登記出入庫與盤點。'); return fn(u, p); }; }
function needSales_(u) { if (!perms_(u).sales) throw new Error('只有業務人員可以建立或修改報價單、訂單。'); }
function strip_(o, pm) { if (!pm.price) { delete o.price; } if (!pm.cost) { delete o.cost; } delete o._row; return o; }
function nextNo_(prefix, date, list) {
  const d = String(date || today_()).replace(/-/g, ''); const head = prefix + d;
  let n = 0; list.forEach(x => { const m = String(x).match(new RegExp('^' + head + '(\\d{3,})$')); if (m) n = Math.max(n, Number(m[1])); });
  return head + ('00' + (n + 1)).slice(-3);
}
const TAX_ = { '應稅5%': 0.05, '零稅率': 0, '免稅': 0, '應稅內含': 0.05 };
/** 出入庫紀錄的訂單單號有時少了前面的單別（例如填 20260923001，實際是 2204-20260923001）：
 *  依「單號結尾相同、而且訂單有這個品號」找出唯一的訂單；找不到或不只一張就照原樣。只影響計算，不改紀錄。 */
function orderNoResolver_() {
  const nos = readAll_('orders').map(o => o.no), set = new Set(nos), has = {};
  readAll_('orderLines').forEach(l => { has[l.orderNo + '__' + l.itemCode] = 1; });
  const memo = {};
  return (no, itemCode) => {
    no = String(no || '').trim(); if (!no || set.has(no)) return no;
    const k = no + '__' + itemCode; if (memo[k] !== undefined) return memo[k];
    const c = nos.filter(x => x.endsWith('-' + no) && has[x + '__' + itemCode]);
    return (memo[k] = c.length === 1 ? c[0] : no);
  };
}
/** 從舊 Excel 匯入、已出貨的銷貨單：當時的出庫已經在異動紀錄裡，不另外扣庫存，只計入訂單的已出貨數量 */
function importedShipped_(onlyOrder) {
  // 這張銷貨單後來在出入庫登記有填訂單單號的出庫（單號對得上），出貨量已經從出庫紀錄算過，不再重複算
  // 依「單號＋品號」判斷：同一張單只有部分品項補登了出庫時，其他品項仍照匯入的銷貨單算
  const counted = new Set(); readAll_('txns').forEach(t => { if (t.typeLabel === '出庫' && t.orderNo && t.ref) { counted.add(String(t.ref).trim() + '__' + t.itemCode); } });
  const out = {}; const sales = readAll_('sales').filter(x => x.imported === '是' && x.status === '已出貨'); if (!sales.length) return out;
  const by = {}; sales.forEach(x => by[x.no] = x);
  readAll_('salesLines').forEach(l => { const x = by[l.saleNo]; if (!x) return; const o = l.orderNo || x.orderNo; if (!o || (onlyOrder && o !== onlyOrder)) return;
    if (counted.has(x.no + '__' + l.itemCode) || counted.has(String(x.no).split('-').pop() + '__' + l.itemCode)) return;
    const k = o + '__' + l.itemCode; out[k] = round_((out[k] || 0) + Number(l.shipQty !== '' && l.shipQty != null ? l.shipQty : l.qty || 0)); });
  return out;
}
function salesLoad_(u) {
  const pm = perms_(u);
  const quotes = readAll_('quotes').map(q => strip_(q, pm));
  const qLines = readAll_('quoteLines').map(l => strip_(l, pm));
  const orders = readAll_('orders').map(o => strip_(o, pm));
  const oLines = readAll_('orderLines').map(l => strip_(l, pm));
  // 出貨進度：出庫（且有填訂單單號）加總，客戶退回扣回
  const shipped = {}; const ono = orderNoResolver_();
  readAll_('txns').forEach(t => {
    if (!t.orderNo || String(t.purpose || '').indexOf('生產') === 0) return; const k = ono(t.orderNo, t.itemCode) + '__' + t.itemCode;  // 工單領料／耗用不算出貨
    if (t.typeLabel === '出庫') shipped[k] = round_((shipped[k] || 0) + Number(t.qty || 0));
    else if (t.typeLabel === '入庫' && t.purpose === '客戶退回') shipped[k] = round_((shipped[k] || 0) - Number(t.qty || 0));
  });
  const imp = importedShipped_(); Object.keys(imp).forEach(k => shipped[k] = round_((shipped[k] || 0) + imp[k]));
  // 工單：完工入庫量、各用料已領量（領料扣、退料加回）
  const wos = readAll_('wos').map(w => strip_(w, pm)), woMats = readAll_('woMats').map(m => strip_(m, pm));
  const woDone = {}, woIssued = {}, woUsed = {};
  readAll_('txns').forEach(t => {
    if (!t.woNo) return;
    if (t.typeLabel === '入庫' && t.purpose === '生產入庫') woDone[t.woNo] = round_((woDone[t.woNo] || 0) + Number(t.qty || 0) - Number(t.merged || 0));
    const k = t.woNo + '__' + t.itemCode;
    if (t.purpose === '生產領料') woIssued[k] = round_((woIssued[k] || 0) + Number(t.qty || 0));   // 直接出庫或轉到產線都算已領
    if (t.purpose === '生產退料') woIssued[k] = round_((woIssued[k] || 0) - Number(t.qty || 0));
    if (t.purpose === '生產耗用') woUsed[k] = round_((woUsed[k] || 0) + Number(t.qty || 0));
  });
  const woOps = readAll_('woOps').map(o => strip_(o, pm));
  const woReports = (pm.prod || pm.wh || pm.plan) ? readAll_('woReports').map(r => strip_(r, pm)) : [];
  // 各製程累計（所有人都看得到進度數字，工時明細只給生產/倉庫）
  // 只有「已核准」的報工算進進度；待審核另外累計
  const opSum = {};
  readAll_('woReports').forEach(r => {
    const st = r.status || '已核准'; if (st === '退回') return;
    const k = r.woNo + '__' + r.opLid; const o = opSum[k] || (opSum[k] = { good: 0, bad: 0, hours: 0, pend: 0, done: false, last: '' });
    if (st === '待審核') { o.pend++; return; }
    o.good = round_(o.good + Number(r.good || 0)); o.bad = round_(o.bad + Number(r.bad || 0)); o.hours = round_(o.hours + Number(r.hours || 0));
    if (r.opDone === '是') o.done = true; if (String(r.date) > o.last) o.last = String(r.date);
  });
  // 委外製程：收回的良品／不良算進該製程進度；另外統計送出、收回數量
  const woOut = readAll_('woOut').map(x => { delete x._row; return x; });
  woOut.forEach(x => { const k = x.woNo + '__' + x.opLid; const o = opSum[k] || (opSum[k] = { good: 0, bad: 0, hours: 0, pend: 0, done: false, last: '' });
    o.sent = round_((o.sent || 0) + (x.kind === '送出' ? Number(x.qty || 0) : 0));
    if (x.kind === '收回') { o.good = round_(o.good + Number(x.good || 0)); o.bad = round_(o.bad + Number(x.bad || 0)); o.back = round_((o.back || 0) + Number(x.good || 0) + Number(x.bad || 0)); }
    if (String(x.date) > o.last) o.last = String(x.date); });
  const sales = (pm.sales || pm.wh) ? readAll_('sales').map(x => strip_(x, pm)) : [];
  const sLines = (pm.sales || pm.wh) ? readAll_('salesLines').map(x => strip_(x, pm)) : [];
  const customers = pm.sales ? readAll_('customers').map(c => { delete c._row; return c; }) : [];
  // 業務人員清單：有勾「業務」職能（或管理員）且啟用中的帳號，給客戶主檔選「負責業務」
  const salesPeople = pm.sales ? readAll_('users').filter(x => x.active !== '否' && x.role !== 'staff' && perms_(x).sales)
    .map(x => ({ id: x.id, name: x.name, dept: x.dept })) : [];
  const mails = pm.sales ? readAll_('mails').slice(-300) : [];
  const ops = readAll_('ops').map(o => { delete o._row; return o; });
  let codeRules = null; try { codeRules = JSON.parse(setting_('codeRules') || 'null'); } catch (e) {}
  const bills = pm.price ? readAll_('bills').map(x => { delete x._row; return x; }) : [];
  const payments = pm.price ? readAll_('payments').map(x => { delete x._row; return x; }) : [];
  return { perm: pm, quotes, qLines, orders, oLines, shipped, wos, woMats, woDone, woIssued, woUsed, woOut, woOps, woReports, opSum, sales, sLines, customers, salesPeople, mails, ops, codeRules, bills, payments };
}
function cleanLines_(lines, keepFrom, pm, isQuote) {
  const items = readAll_('items');
  return (lines || []).filter(l => String(l.itemCode || l.name || '').trim()).map((l, i) => {
    const old = keepFrom.find(x => x.lid && x.lid === l.lid) || {};
    const it = l.itemCode ? itemByAny_(items, l.itemCode) : null;
    const qty = Number(l.qty); if (!(qty > 0)) throw new Error('第 ' + (i + 1) + ' 行的數量要大於 0。');
    const r = { lid: l.lid || Utilities.getUuid().slice(0, 8), seq: i + 1, itemCode: it ? it.code : String(l.itemCode || '').trim(),
      name: String(l.name || (it && it.name) || '').trim(), nameEn: String(l.nameEn || (it && it.nameEn) || '').trim(),
      spec: String(l.spec || (it && it.spec) || '').trim(), unit: String(l.unit || (it && it.unit) || '').trim(), qty };
    r.price = pm.price ? (l.price === '' || l.price == null ? '' : Number(l.price)) : old.price;  // 沒有單價權限的人改不到單價
    r.cost = old.cost;  // 成本只能由資材回覆
    if (isQuote) { r.wantDate = l.wantDate || ''; ['leadDate', 'matNote', 'matBy', 'matAt'].forEach(k => r[k] = old[k] || ''); }
    else { r.dueDate = l.dueDate || ''; r.note = String(l.note || '').trim(); if (old.cost !== undefined) r.cost = old.cost; else if (l._cost !== undefined) r.cost = l._cost; }
    return r;
  });
}
/** 單身整批改寫：刪掉這張單原本的明細，再寫入新的 */
function replaceLines_(k, key, no, lines) {
  readAll_(k).filter(l => l[key] === no).sort((a, b) => b._row - a._row).forEach(l => deleteRow_(k, l));
  append_(k, lines.map(l => Object.assign({}, l, { [key]: no })));
}
function docHead_(p) {
  const h = {}; ['date', 'custCode', 'customer', 'contact', 'currency', 'taxType', 'terms', 'note'].forEach(k => h[k] = String(p[k] || '').trim());
  if (h.custCode) {  // 有客戶代號就以客戶主檔為準
    const c = readAll_('customers').find(x => x.code.toLowerCase() === h.custCode.toLowerCase());
    if (!c) throw new Error('找不到客戶代號 ' + h.custCode + '，請先到「客戶」建立。');
    h.custCode = c.code; if (!h.customer) h.customer = c.short || c.full;
  }
  if (!h.customer) throw new Error('請填寫客戶。');
  h.date = h.date || today_(); h.currency = h.currency || 'TWD'; h.taxType = h.taxType || (h.currency === 'TWD' ? '應稅5%' : '零稅率');
  h.taxRate = TAX_[h.taxType] != null ? TAX_[h.taxType] : 0;
  return h;
}
function saveQuote_(u, p) {
  needSales_(u); const pm = perms_(u); const d = p.doc || {};
  const all = readAll_('quotes'); let q = d.no ? all.find(x => x.no === d.no && !d.isNew) : null;
  if (d.isNew && d.no && all.some(x => x.no === d.no)) throw new Error('報價單號 ' + d.no + ' 已經存在。');
  if (q && q.status === '已轉訂單') throw new Error('已轉訂單的報價單不能再修改。');
  const h = docHead_(d); h.validUntil = d.validUntil || '';
  const oldLines = q ? readAll_('quoteLines').filter(l => l.quoteNo === q.no) : [];
  const lines = cleanLines_(d.lines, oldLines, pm, true); if (!lines.length) throw new Error('請至少填一個品項。');
  if (!q) {
    const no = String(d.no || '').trim() || nextNo_('QT', h.date, all.map(x => x.no));
    q = Object.assign({ no, salesId: u.id, salesName: u.name, status: '草稿', createdAt: nowStr_() }, h);
    q.updatedAt = nowStr_(); append_('quotes', [q]);
  } else { Object.assign(q, h, { updatedAt: nowStr_() }); update_('quotes', q); }
  replaceLines_('quoteLines', 'quoteNo', q.no, lines);
  return { no: q.no };
}
function quoteStatus_(u, p) {
  const q = readAll_('quotes').find(x => x.no === p.no); if (!q) throw new Error('找不到報價單。');
  const pm = perms_(u); const to = p.status;
  if (to === '待資材確認') {
    needSales_(u); q.status = to; q.sentAt = nowStr_();
  } else if (['草稿', '已報價', '失效'].indexOf(to) >= 0) { needSales_(u); if (q.status === '已轉訂單') throw new Error('已轉訂單，不能改狀態。'); q.status = to; }
  else throw new Error('狀態不正確。');
  q.updatedAt = nowStr_(); update_('quotes', q); return true;
}
function matReply_(u, p) {
  if (!perms_(u).mat) throw new Error('只有採購人員可以回覆成本與交期。');
  const q = readAll_('quotes').find(x => x.no === p.no); if (!q) throw new Error('找不到報價單。');
  const lines = readAll_('quoteLines').filter(l => l.quoteNo === q.no);
  (p.lines || []).forEach(x => {
    const l = lines.find(y => y.lid === x.lid); if (!l) return;
    if (x.cost !== undefined) l.cost = x.cost === '' || x.cost == null ? '' : Number(x.cost);
    if (x.leadDate !== undefined) l.leadDate = x.leadDate || '';
    if (x.matNote !== undefined) l.matNote = String(x.matNote || '').trim();
    l.matBy = u.name; l.matAt = nowStr_(); update_('quoteLines', l);
  });
  if (p.done) {
    const miss = lines.filter(l => !l.leadDate);
    if (miss.length) throw new Error('已儲存填好的部分。還有 ' + miss.length + ' 項沒有填確認交期，填完再按「回覆業務」。');
    q.status = '資材已回覆'; q.repliedAt = nowStr_(); q.updatedAt = nowStr_(); update_('quotes', q);
  }
  return true;
}
function quoteToOrder_(u, p) {
  needSales_(u);
  const q = readAll_('quotes').find(x => x.no === p.no); if (!q) throw new Error('找不到報價單。');
  if (q.orderNo) throw new Error('這張報價單已轉成訂單 ' + q.orderNo + '。');
  const lines = readAll_('quoteLines').filter(l => l.quoteNo === q.no).sort((a, b) => a.seq - b.seq);
  const date = p.date || today_(); const all = readAll_('orders');
  const no = String(p.orderNo || '').trim() || nextNo_('SO', date, all.map(x => x.no));
  if (all.some(x => x.no === no)) throw new Error('訂單單號 ' + no + ' 已經存在。');
  const o = { no, date, custCode: q.custCode || '', customer: q.customer, contact: q.contact, custPO: String(p.custPO || '').trim(), currency: q.currency, taxType: q.taxType, taxRate: q.taxRate,
    quoteNo: q.no, terms: q.terms, note: q.note, salesId: u.id, salesName: u.name, status: '進行中', createdAt: nowStr_(), updatedAt: nowStr_(),
    erpNo: String(p.orderNo || '').trim() };   // 轉訂單時自己填的單號（通常是鼎新單號）同時記成鼎新單號
  append_('orders', [o]);
  append_('orderLines', lines.map((l, i) => ({ orderNo: no, lid: Utilities.getUuid().slice(0, 8), seq: i + 1, itemCode: l.itemCode, name: l.name, nameEn: l.nameEn, spec: l.spec, unit: l.unit,
    qty: l.qty, price: l.price, cost: l.cost, dueDate: l.leadDate || l.wantDate || '', note: l.matNote || '' })));
  q.status = '已轉訂單'; q.orderNo = no; q.updatedAt = nowStr_(); update_('quotes', q);
  return { no };
}
/** 記下鼎新的正式單號（報價單草稿在鼎新正式輸入後、訂單在鼎新建立後），之後同步鼎新資料時用來對應 */
function setErpNo_(u, p) {
  needSales_(u); const k = p.kind === 'order' ? 'orders' : 'quotes';
  const d = readAll_(k).find(x => x.no === p.no); if (!d) throw new Error('找不到單據。');
  const v = String(p.erpNo || '').trim();
  if (v && readAll_(k).some(x => x !== d && String(x.erpNo || '').trim() === v)) throw new Error('鼎新單號 ' + v + ' 已經對應到另一張單據。');
  d.erpNo = v; d.updatedAt = nowStr_(); update_(k, d); return true;
}
function saveOrder_(u, p) {
  needSales_(u); const pm = perms_(u); const d = p.doc || {};
  const all = readAll_('orders'); let o = d.no && !d.isNew ? all.find(x => x.no === d.no) : null;
  if (d.isNew && d.no && all.some(x => x.no === d.no)) throw new Error('訂單單號 ' + d.no + ' 已經存在。');
  const h = docHead_(d); h.custPO = String(d.custPO || '').trim(); h.req = String(d.req || '').trim();
  const oldLines = o ? readAll_('orderLines').filter(l => l.orderNo === o.no) : [];
  const lines = cleanLines_(d.lines, oldLines, pm, false); if (!lines.length) throw new Error('請至少填一個品項。');
  if (!o) {
    const no = String(d.no || '').trim() || nextNo_('SO', h.date, all.map(x => x.no));
    o = Object.assign({ no, salesId: u.id, salesName: u.name, status: '進行中', quoteNo: '', createdAt: nowStr_() }, h);
    o.updatedAt = nowStr_(); append_('orders', [o]);
  } else { Object.assign(o, h, { updatedAt: nowStr_() }); update_('orders', o); }
  replaceLines_('orderLines', 'orderNo', o.no, lines);
  return { no: o.no };
}
function orderStatus_(u, p) {
  needSales_(u);
  const o = readAll_('orders').find(x => x.no === p.no); if (!o) throw new Error('找不到訂單。');
  if (['進行中', '已結案', '已取消'].indexOf(p.status) < 0) throw new Error('狀態不正確。');
  o.status = p.status; o.updatedAt = nowStr_(); update_('orders', o); return true;
}
function deleteDoc_(u, p) {
  needSales_(u);
  if (p.kind === 'quote') {
    const q = readAll_('quotes').find(x => x.no === p.no); if (!q) throw new Error('找不到報價單。');
    if (q.orderNo) throw new Error('已轉訂單的報價單不能刪除。');
    replaceLines_('quoteLines', 'quoteNo', q.no, []); deleteRow_('quotes', readAll_('quotes').find(x => x.no === p.no));
  } else {
    const o = readAll_('orders').find(x => x.no === p.no); if (!o) throw new Error('找不到訂單。');
    if (readAll_('txns').some(t => t.orderNo === o.no) || readAll_('sales').some(x => x.orderNo === o.no && x.status !== '作廢') || readAll_('salesLines').some(l => l.orderNo === o.no)) throw new Error('這張訂單已經有銷貨或出貨紀錄，不能刪除；請改成「已取消」或「已結案」。');
    replaceLines_('orderLines', 'orderNo', o.no, []); deleteRow_('orders', readAll_('orders').find(x => x.no === p.no));
    readAll_('quotes').filter(q => q.orderNo === o.no).forEach(q => { q.orderNo = ''; q.status = '已報價'; update_('quotes', q); });
  }
  return true;
}


// ======================= 工單 =======================
function needProd_(u) { const pm = perms_(u); if (!(pm.prod || pm.plan)) throw new Error('只有生產或生管人員可以開立或修改工單。'); }
const whType_ = (whs, code) => { const w = whs.find(x => x.code === code); return w ? (w.type || '倉庫') : ''; };
function saveWO_(u, p) {
  needProd_(u); const d = p.doc || {};
  const items = readAll_('items'), whs = readAll_('whs');
  const it = itemByAny_(items, d.itemCode); if (!it) throw new Error('找不到品號 ' + (d.itemCode || '') + '。');
  const qty = Number(d.qty); if (!(qty > 0)) throw new Error('預計產量要大於 0。');
  if (!whs.some(w => w.code === d.whIn)) throw new Error('請選擇入庫庫別。');
  const all = readAll_('wos'); let w = d.no && !d.isNew ? all.find(x => x.no === d.no) : null;
  if (d.isNew && d.no && all.some(x => x.no === d.no)) throw new Error('工單單號 ' + d.no + ' 已經存在。');
  if (w && (w.status === '已結案' || w.status === '作廢')) throw new Error('已結案或作廢的工單不能修改。');
  const mats = (d.mats || []).filter(m => String(m.itemCode || '').trim()).map((m, i) => {
    const mi = itemByAny_(items, m.itemCode); if (!mi) throw new Error('用料第 ' + (i + 1) + ' 行找不到品號 ' + m.itemCode + '。');
    const q = Number(m.qty); if (!(q > 0)) throw new Error('用料 ' + mi.code + ' 的需領用量要大於 0。');
    if (m.whOut && !whs.some(x => x.code === m.whOut)) throw new Error('找不到庫別 ' + m.whOut + '。');
    return { lid: m.lid || Utilities.getUuid().slice(0, 8), seq: i + 1, itemCode: mi.code, name: mi.name, spec: mi.spec || '', unit: mi.unit, qty: q, whOut: m.whOut || mi.mainWh || '', note: String(m.note || '').trim() };
  });
  const site = String(d.site || '').trim(); const pm = perms_(u);
  if (site && ['生產', '委外'].indexOf(whType_(whs, site)) < 0) throw new Error('生產地點要選「生產」或「委外」類型的庫別。');
  const oldOps = w ? readAll_('woOps').filter(o => o.woNo === w.no) : [];
  const vendorChanged = (d.ops || []).some(o => String(o.vendor || '') !== String((oldOps.find(x => x.lid && x.lid === o.lid) || {}).vendor || ''));
  if (!pm.plan && ((site !== String((w && w.site) || '') && (whType_(whs, site) === '委外' || whType_(whs, (w && w.site) || '') === '委外')) || vendorChanged))
    throw new Error('委外加工只能由生管設定。');
  const h = { date: d.date || today_(), itemCode: it.code, name: it.name, spec: it.spec || '', unit: it.unit, qty, whIn: d.whIn, dueDate: d.dueDate || '',
    orderNo: String(d.orderNo || '').trim(), note: String(d.note || '').trim(), site };
  if (!w) {
    const no = String(d.no || '').trim() || nextNo_('MO', h.date, all.map(x => x.no));
    w = Object.assign({ no, status: '未開工', createdBy: u.name, createdAt: nowStr_() }, h); w.updatedAt = nowStr_(); append_('wos', [w]);
  } else { Object.assign(w, h, { updatedAt: nowStr_() }); update_('wos', w); }
  replaceLines_('woMats', 'woNo', w.no, mats);
  if (d.ops) {
    const ops = d.ops.map(o => { const v = String(o.vendor || '').trim(); if (v && whType_(whs, v) !== '委外') throw new Error('委外廠商要選「委外」類型的庫別：' + v);
      return { lid: o.lid || Utilities.getUuid().slice(0, 8), name: String(o.name || '').trim(), note: String(o.note || '').trim(), vendor: v }; })
      .filter(o => o.name).map((o, i) => Object.assign(o, { seq: i + 1 }));
    replaceLines_('woOps', 'woNo', w.no, ops);
  }
  return { no: w.no };
}
function woStatus_(u, p) {
  needProd_(u);
  const w = readAll_('wos').find(x => x.no === p.no); if (!w) throw new Error('找不到工單。');
  if (['已結案', '作廢', '生產中', '未開工'].indexOf(p.status) < 0) throw new Error('狀態不正確。');
  const used = readAll_('txns').some(t => t.woNo === w.no);
  if (p.status === '作廢' && used) throw new Error('這張工單已經有領料或入庫紀錄，不能作廢；請改成「結案」。');
  if (p.status === '未開工' || p.status === '生產中') p.status = used ? '生產中' : '未開工';  // 重新開啟
  w.status = p.status; w.updatedAt = nowStr_(); update_('wos', w); return true;
}
/** 工單領料 / 退料 / 完工入庫：一次送出多筆，全部檢查通過才寫入 */
function woMove_(u, p) {
  const pm = perms_(u); if (!(pm.wh || pm.prod || pm.plan)) throw new Error('只有倉庫、生產或生管人員可以領料或入庫。');
  const w = readAll_('wos').find(x => x.no === p.no); if (!w) throw new Error('找不到工單。');
  if (w.status === '已結案' || w.status === '作廢') throw new Error('已結案或作廢的工單不能再領料或入庫。');
  const kind = p.kind; const date = p.date || today_();
  const base = { date, ref: w.no, woNo: w.no, orderNo: w.orderNo || '', note: String(p.note || '').trim(), filler: p.filler, dept: p.dept, fillerId: p.fillerId };
  let moves; const site = w.site || ''; const short = [];
  const ctx = stockCtx_(); const rec = []; const items = readAll_('items'), whs = readAll_('whs');
  if (kind === 'receive') {
    const q = Number(p.qty); if (!(q > 0)) throw new Error('完工數量要大於 0。');
    moves = [Object.assign({}, base, { type: 'in', purpose: '生產入庫', itemId: w.itemCode, whId: p.whId || w.whIn, qty: q, packLines: p.packLines || '' })];
    // 有生產地點（產線或委外廠商）：完工時依用料比例，把產線上的料扣掉（生產耗用）
    if (site) {
      const txs = readAll_('txns').filter(t => t.woNo === w.no); const net = {};
      txs.forEach(t => { const k = t.itemCode; if (t.purpose === '生產領料' && t.toWhCode === site) net[k] = (net[k] || 0) + Number(t.qty || 0);
        if (t.purpose === '生產退料' && t.whCode === site) net[k] = (net[k] || 0) - Number(t.qty || 0); if (t.purpose === '生產耗用') net[k] = (net[k] || 0) - Number(t.qty || 0); });
      readAll_('woMats').filter(m => m.woNo === w.no).forEach(m => {
        const want = round_(Number(m.qty) / Number(w.qty) * q); const have = round_(Math.max(0, net[m.itemCode] || 0)); const take = Math.min(want, have);
        if (take > 0) { moves.push(Object.assign({}, base, { type: 'out', purpose: '生產耗用', itemId: m.itemCode, whId: site, qty: take })); net[m.itemCode] = have - take; }
        if (take < want) short.push(m.itemCode + ' 少 ' + round_(want - take));
      });
    }
  } else if (kind === 'issue' || kind === 'return') {
    // 有生產地點：領料＝從倉庫轉到產線（或委外廠商），退料＝從產線轉回倉庫；沒有生產地點：直接出庫 / 入庫
    moves = (p.lines || []).filter(l => Number(l.qty) > 0).map(l => Object.assign({}, base, site
      ? (kind === 'issue' ? { type: 'xfer', purpose: '生產領料', itemId: l.itemCode, whId: l.whId, toWhId: site, qty: Number(l.qty) }
                          : { type: 'xfer', purpose: '生產退料', itemId: l.itemCode, whId: site, toWhId: l.whId, qty: Number(l.qty) })
      : { type: kind === 'issue' ? 'out' : 'in', purpose: kind === 'issue' ? '生產領料' : '生產退料', itemId: l.itemCode, whId: l.whId, qty: Number(l.qty) }));
    if (!moves.length) throw new Error('請填入' + (kind === 'issue' ? '領料' : '退料') + '數量。');
  } else throw new Error('動作不正確。');
  const results = moves.map(m => moveOne_(u, m, ctx, rec, items, whs));
  flushStock_(ctx); append_('txns', rec);
  // 狀態：有動作就是生產中；完工量達預計產量 → 已完工
  if (w.status === '未開工') w.status = '生產中';
  if (kind === 'receive') {
    const done = readAll_('txns').filter(t => t.woNo === w.no && t.typeLabel === '入庫' && t.purpose === '生產入庫').reduce((s, t) => s + Number(t.qty || 0) - Number(t.merged || 0), 0);
    if (done >= Number(w.qty)) w.status = '已完工';
  }
  w.updatedAt = nowStr_(); update_('wos', w);
  return { count: results.length, results, short };
}

// ======================= 製程委外（生管登記送出 / 收回） =======================
function woOutsource_(u, p) {
  if (!perms_(u).plan) throw new Error('委外送出／收回只能由生管登記。');
  const w = readAll_('wos').find(x => x.no === p.woNo); if (!w) throw new Error('找不到工單。');
  if (w.status === '已結案' || w.status === '作廢') throw new Error('工單已' + w.status + '。');
  const op = readAll_('woOps').find(o => o.woNo === w.no && o.lid === p.opLid); if (!op) throw new Error('找不到製程。');
  if (!op.vendor) throw new Error('這道製程沒有設定委外廠商，請先在工單裡指定。');
  const kind = p.kind === '收回' ? '收回' : '送出';
  const qty = Number(p.qty || 0), good = Number(p.good || 0), bad = Number(p.bad || 0);
  if ([qty, good, bad].some(x => isNaN(x) || x < 0)) throw new Error('數量要是 0 以上的數字。');
  if (kind === '送出' && !(qty > 0)) throw new Error('請填送出數量。');
  if (kind === '收回' && !(good > 0 || bad > 0)) throw new Error('請填收回的良品或不良數。');
  if (bad > 0 && !String(p.badReason || '').trim()) throw new Error('有不良數時請填不良原因。');
  const ts = Date.now();
  const r = { id: 'O' + ts + Math.floor(Math.random() * 100), date: p.date || today_(), woNo: w.no, opLid: op.lid, opName: op.name, vendor: op.vendor, kind,
    qty: kind === '送出' ? qty : '', good: kind === '收回' ? good : '', bad: kind === '收回' ? bad : '', badReason: String(p.badReason || '').trim(),
    note: String(p.note || '').trim(), byId: u.id, byName: u.name, ts };
  append_('woOut', [r]);
  if (w.status === '未開工') { w.status = '生產中'; w.updatedAt = nowStr_(); update_('wos', w); }
  return { id: r.id };
}
function delWoOut_(u, p) {
  if (!perms_(u).plan) throw new Error('只有生管可以刪除委外紀錄。');
  const r = readAll_('woOut').find(x => x.id === p.id); if (!r) throw new Error('找不到這筆紀錄。'); deleteRow_('woOut', r); return true;
}

// ======================= 製程主檔 =======================
function needOpEdit_(u) { const pm = perms_(u); if (!(pm.prodLead || pm.plan || pm.admin)) throw new Error('製程主檔只有生產主管、生管或管理員可以修改。'); }
function saveOps_(u, p) {
  needOpEdit_(u); const all = readAll_('ops'); const add = []; let n = 0;
  (p.list || []).forEach(o => {
    const code = String(o.code || '').trim().toUpperCase(), name = String(o.name || '').trim();
    if (!code || !name) throw new Error('代號和名稱都要填。');
    if (!/^[A-Z0-9_.-]{1,20}$/.test(code)) throw new Error('代號只能用英文、數字和 - _ .（例如 P110、M1-PR03）：' + code);
    const old = o.oldCode ? all.find(x => x.code === String(o.oldCode).toUpperCase()) : null;
    const dup = all.find(x => x.code === code && x !== old); if (dup) throw new Error('代號 ' + code + ' 已經用在「' + dup.name + '」。');
    const kind = o.kind === '工作站' ? '工作站' : '製程';
    const rec = { code, name, dept: String(o.dept || '').trim(), station: String(o.station || '').trim(), note: String(o.note || '').trim(), active: o.active === '否' ? '否' : '是', updatedAt: nowStr_(), kind, site: String(o.site || '').trim(),
      sop: o.sop === '是' ? '是' : '', sopNo: String(o.sopNo || '').trim(), sopVer: String(o.sopVer || '').trim(), sopUrl: String(o.sopUrl || '').trim() };
    if (rec.sopUrl && !/^https?:\/\//i.test(rec.sopUrl)) throw new Error('作業指導書連結要是網址（https:// 開頭）。');
    if (old && old.code !== code) replaceCol_('woReports', kind === '工作站' ? 'stationCode' : 'opCode', old.code, code);  // 改代號：報工紀錄一起換
    if (old) { Object.assign(old, rec); update_('ops', old); } else { add.push(rec); all.push(rec); }
    n++;
  });
  append_('ops', add); return { count: n };
}
// ======================= 功能開關（管理員） =======================
/* 這套系統是鼎新 ERP 的輔助：庫存、訂單、銷貨等以鼎新為準，預設關閉，需要時管理員再打開 */
const MODS_DEFAULT_OFF_ = ['dash', 'report', 'wo', 'wr', 'pov', 'ops', 'codes'];
function modsOff_() { const v = setting_('modulesOff'); if (v === '') return MODS_DEFAULT_OFF_; try { return JSON.parse(v) || []; } catch (e) { return MODS_DEFAULT_OFF_; } }
function saveModules_(u, p) { const off = (p.off || []).map(String).filter(x => /^[a-z]+$/.test(x) && ['mods', 'users'].indexOf(x) < 0); setSetting_('modulesOff', JSON.stringify(off)); return off; }
/** 編碼原則（管理員在設定裡修改），存成 JSON */
function saveCodeRules_(u, p) {
  const r = p.rules || {}; if (!Array.isArray(r.units) || !Array.isArray(r.stages) || !Array.isArray(r.machines)) throw new Error('編碼原則格式不正確。');
  setSetting_('codeRules', JSON.stringify(r)); return true;
}
// ======================= 材料單價（採購） =======================
const CURS_ = ['TWD', 'USD', 'EUR', 'JPY', 'CNY'];
/** 品號目前的單價幣別：最後一筆已生效的單價紀錄，沒有就是台幣 */
function curOf_(code, d) { const L = readAll_('costLog').filter(x => x.itemCode === code && String(x.effDate) <= d).sort((a, b) => String(a.effDate).localeCompare(String(b.effDate)) || String(a.at).localeCompare(String(b.at)));
  return L.length ? (L[L.length - 1].currency || 'TWD') : 'TWD'; }
/** 修改單位成本：品號（庫存）與成本資料庫有同一個編號就一起更新，並留下異動紀錄（生效日、原單價→新單價、供應商、說明）。
 *  未來生效的先記著，到那天以紀錄為準 */
function setCost_(u, p) {
  if (!perms_(u).buy) throw new Error('只有採購人員可以修改材料單價。');
  const list = p.list || []; if (!list.length) throw new Error('沒有要修改的單價。');
  const items = readAll_('items'), cis = readAll_('costItems'); const logs = []; const ts = Date.now(); const today = today_();
  const ciOf = c => cis.find(x => x.code.toLowerCase() === String(c || '').trim().toLowerCase());
  list.forEach((x, i) => {
    const ci = ciOf(x.itemCode), it = itemByAny_(items, ci ? ci.code : x.itemCode);
    if (!it && !ci) throw new Error('找不到品號或成本項目 ' + (x.itemCode || '') + '。');
    const code = ci ? ci.code : it.code;
    const v = Number(x.cost); if (x.cost === '' || x.cost == null || isNaN(v) || v < 0) throw new Error(code + ' 的單價要是 0 以上的數字。');
    const eff = String(x.effDate || today).slice(0, 10);
    const old = Number(ci ? ci.price : it.cost) || 0;
    const cur = String(x.currency || 'TWD').trim().toUpperCase(); if (CURS_.indexOf(cur) < 0) throw new Error(code + ' 的幣別不正確。');
    const oldCur = ci ? (ci.currency || 'TWD') : curOf_(code, today);
    if (v === old && cur === oldCur && !x.force) return;
    logs.push({ id: 'C' + ts + '_' + i, itemCode: code, effDate: eff, oldCost: old, newCost: v, currency: cur,
      supplier: String(x.supplier || '').trim(), note: String(x.note || '').trim(), byId: u.id, byName: u.name, at: nowStr_() });
    if (eff <= today) {
      if (it && (!ci || it.code === ci.code) && !bomParents_()[it.code]) { it.cost = v; update_('items', it); }
      if (ci) { ci.price = v; ci.currency = cur; ci.priceDate = eff; ci.updatedAt = nowStr_(); update_('costItems', ci); }
    }
  });
  append_('costLog', logs); COSTLOG_CACHE_ = null;
  const synced = logs.length ? syncBomCosts_() : 0;
  return { count: logs.length, synced };
}
function costLog_(u, p) {
  if (!perms_(u).cost) throw new Error('沒有查看成本的權限。');
  return readAll_('costLog').filter(x => !p.itemCode || x.itemCode === p.itemCode).map(x => { delete x._row; return x; });
}
// ======================= BOM 成本估算（業務、採購看得到；採購修改） =======================
/* 連動規則：
 *  - 成本資料庫和品號用同一個編號時，是同一個單價（改一邊另一邊跟著變，共用一份修改紀錄）。
 *  - 品號有 BOM（是成品）時，品號的單位成本＝BOM 估算成本，會在單價或 BOM 修改後自動重算；出入庫紀錄也記當天的 BOM 成本。 */
let BOMC_CACHE_ = null;
function bomCtx_() {
  if (BOMC_CACHE_) return BOMC_CACHE_;
  const ci = {}; readAll_('costItems').forEach(x => ci[x.code.toLowerCase()] = x);
  const it = {}; readAll_('items').forEach(x => it[String(x.code).toLowerCase()] = x);
  const log = {}; readAll_('costLog').forEach(x => (log[String(x.itemCode).toLowerCase()] = log[String(x.itemCode).toLowerCase()] || []).push(x));
  Object.keys(log).forEach(k => log[k].sort((a, b) => String(a.effDate).localeCompare(String(b.effDate)) || String(a.at).localeCompare(String(b.at))));
  const bom = {}; readAll_('bom').forEach(l => (bom[l.parent] = bom[l.parent] || []).push(l));
  BOMC_CACHE_ = { ci, it, log, bom, calc: calcSettings_() }; return BOMC_CACHE_;
}
function bomParents_() { return bomCtx_().bom; }
/** 某日的單價（換成台幣）；邏輯和網頁上的 bcPrice 相同 */
function priceOn_(code, d) {
  const C = bomCtx_(); const k = String(code).toLowerCase(); const c = C.ci[k], it = C.it[k]; if (!c && !it) return 0;
  const L = C.log[k] || []; const P = L.filter(x => String(x.effDate) <= d); let v, cur = 'TWD';
  if (P.length) { v = Number(P[P.length - 1].newCost); cur = P[P.length - 1].currency || 'TWD'; }
  else if (L.length) { v = L[0].oldCost === '' ? 0 : Number(L[0].oldCost); cur = L[0].currency || 'TWD'; }
  else { v = Number(c ? c.price : it.cost) || 0; cur = c ? (c.currency || 'TWD') : 'TWD'; }
  if (cur === 'TWD') return v; const r = cur === 'USD' ? Number(C.calc.fx) : Number((C.calc.rates || {})[cur]); return r ? v * r : 0;
}
function bomCostOn_(parent, d) {
  return (bomCtx_().bom[parent] || []).reduce((s, l) => s + (Number(l.useQty) || 0) * (l.base === '' || l.base == null ? 1 : Number(l.base)) * priceOn_(l.code, d), 0);
}
/** 把有 BOM 的品號的單位成本更新成今天的 BOM 估算成本 */
function syncBomCosts_() {
  BOMC_CACHE_ = null; const C = bomCtx_(); const d = today_(); let n = 0;
  readAll_('items').forEach(it => { if (!C.bom[it.code]) return; const v = round_(bomCostOn_(it.code, d)); if (Number(it.cost) !== v) { it.cost = v; update_('items', it); n++; } });
  BOMC_CACHE_ = null; return n;
}
const COST_CATS_ = ['貴重材料', '材料', '生產', '生產外包'];
function needCost_(u) { if (!perms_(u).cost) throw new Error('BOM 成本只有業務和採購看得到。'); }
function needBuy_(u) { if (!perms_(u).buy) throw new Error('BOM 與成本資料庫只有採購可以修改。'); }
const noRow_ = x => { delete x._row; return x; };
/** 整個分頁改寫（大量匯入時比一列一列刪快） */
function writeAll_(k, objs) {
  const s = sh_(k); const last = s.getLastRow(); const n = F[k].length;
  const rows = objs.map(o => objToRow_(k, o)); const blank = []; for (let i = 0; i < n; i++) blank.push('');
  const total = Math.max(rows.length, last - 1); if (!total) return;
  while (rows.length < total) rows.push(blank.slice());
  s.getRange(2, 1, total, n).setValues(rows); READ_MEMO_ = {};
}
function calcSettings_() { let c = {}; try { c = JSON.parse(setting_('costCalc') || '{}'); } catch (e) {} const r = Object.assign({ fx: 30, m1: 1.2, m2: 1.1, n1: '預計售價', n2: '代理商售價' }, c); r.rates = Object.assign({}, c.rates || {}); return r; }
function costLoad_(u) {
  needCost_(u);
  return { costItems: readAll_('costItems').map(noRow_), bom: readAll_('bom').map(noRow_), bomHeads: readAll_('bomHeads').map(noRow_),
    bomLog: readAll_('bomLog').slice(-800).map(noRow_), metal: readAll_('metalPrices').map(noRow_), calc: calcSettings_(),
    costLog: readAll_('costLog').map(noRow_), canEdit: perms_(u).buy };
}
function saveCostCalc_(u, p) {
  needBuy_(u); const c = calcSettings_();
  ['fx', 'm1', 'm2'].forEach(k => { if (p[k] !== undefined) { const v = Number(p[k]); if (!(v > 0)) throw new Error('匯率與倍率要大於 0。'); c[k] = v; } });
  ['n1', 'n2'].forEach(k => { if (p[k] !== undefined) c[k] = String(p[k]).trim() || c[k]; });
  if (p.rates) Object.keys(p.rates).forEach(k => { if (['EUR', 'JPY', 'CNY'].indexOf(k) < 0) return; const v = p.rates[k]; if (v === '' || v == null) { delete c.rates[k]; return; } if (!(Number(v) > 0)) throw new Error(k + ' 匯率要大於 0。'); c.rates[k] = Number(v); });
  setSetting_('costCalc', JSON.stringify(c)); syncBomCosts_(); return c;
}
function cleanCostItem_(x) {
  const code = String(x.code || '').trim(); if (!code) throw new Error('材料編號不能空白。');
  const cat = String(x.cat || '').trim(); if (cat && COST_CATS_.indexOf(cat) < 0) throw new Error(code + ' 的類別要是：' + COST_CATS_.join('、') + '。');
  return { code, name: String(x.name || '').trim(), spec: String(x.spec == null ? '' : x.spec).trim(), unit: String(x.unit || '').trim(), cat,
    metal: String(x.metal || '').trim(), note: String(x.note || '').trim() };
}
/** 新增或修改成本項目的基本資料；單價有變就走 setCost 留紀錄 */
function saveCostItem_(u, p) {
  needBuy_(u); const r = cleanCostItem_(p); const all = readAll_('costItems');
  const ex = all.find(x => x.code.toLowerCase() === (p.origCode || r.code).toLowerCase());
  if (p.isNew && all.some(x => x.code.toLowerCase() === r.code.toLowerCase())) throw new Error('材料編號 ' + r.code + ' 已經在成本資料庫。');
  const items = readAll_('items');
  if (ex && ex.code !== r.code) {
    if (items.some(i => i.code === ex.code)) throw new Error('編號是品號的資料，要改編號請到「品號」修改，成本資料庫和 BOM 會一起換。');
    if (all.some(x => x !== ex && x.code.toLowerCase() === r.code.toLowerCase())) throw new Error('材料編號 ' + r.code + ' 已經存在。');
    replaceCol_('bom', 'code', ex.code, r.code); replaceCol_('costLog', 'itemCode', ex.code, r.code);
  }
  // 品號是主檔：品名、規格、單位寫回品號（沒有品號就建立一個）
  const it = items.find(i => i.code.toLowerCase() === r.code.toLowerCase());
  if (it) { const before = { code: it.code, name: it.name, spec: it.spec, unit: it.unit };
    if (r.name) it.name = r.name; it.spec = r.spec; if (r.unit) it.unit = r.unit;
    if (before.name !== it.name || String(before.spec || '') !== String(it.spec || '') || before.unit !== it.unit) { update_('items', it); syncItemRefs_(it.code, it); }
    r.code = it.code; }
  else { if (!r.name) throw new Error('請填品名。'); append_('items', [itemFromCost_(Object.assign({ price: Number(p.price) || 0 }, r))]); }
  const rec = Object.assign(ex || { price: 0, currency: 'TWD', priceDate: '', active: '是' }, r, { updatedAt: nowStr_() });
  if (ex) update_('costItems', rec); else append_('costItems', [rec]);
  const cur = String(p.currency || rec.currency || 'TWD').toUpperCase();
  const hasP = p.price !== undefined && p.price !== '';
  if ((hasP && Number(p.price) !== Number(rec.price || 0)) || cur !== (rec.currency || 'TWD') || (!ex && hasP))
    setCost_(u, { list: [{ itemCode: rec.code, cost: hasP ? p.price : rec.price, currency: cur, effDate: p.effDate, supplier: p.supplier, note: p.costNote || (ex ? '' : '新增成本項目'), force: !ex }] });
  return { code: rec.code };
}
/** 從成本資料庫的項目建一個品號（材料→原物料/零組件；工錢、委外→成品/半成品） */
function itemFromCost_(c) {
  return { code: c.code, name: c.name || c.code, nameEn: '', spec: c.spec || '', unit: c.unit || 'PCS', cat: (c.cat === '生產' || c.cat === '生產外包') ? '成品/半成品' : '原物料/零組件',
    mainWh: '', safety: 0, cost: Number(c.price) || 0, netWt: '', grossWt: '', note: '由成本資料庫建立', alias: '', specEn: '' };
}
/** 品號與成本資料庫同步：品號是主檔。成本資料庫有、品號沒有的編號建立品號；同編號的品名、規格、單位以品號為準 */
function syncCostItems_() {
  const items = readAll_('items'); const by = {}; items.forEach(i => by[String(i.code).toLowerCase()] = i);
  const cis = readAll_('costItems').map(noRow_); const add = []; let fixed = 0;
  cis.forEach(c => { const it = by[c.code.toLowerCase()];
    if (!it) { const n = itemFromCost_(c); add.push(n); by[c.code.toLowerCase()] = n; return; }
    if (c.code !== it.code || c.name !== it.name || String(c.spec || '') !== String(it.spec || '') || c.unit !== it.unit) { c.code = it.code; c.name = it.name; c.spec = it.spec || ''; c.unit = it.unit; fixed++; } });
  if (add.length) append_('items', add);
  if (fixed) writeAll_('costItems', cis);
  return { made: add.length, fixed };
}
function syncCostItemsH_(u) { needBuy_(u); const r = syncCostItems_(); r.synced = syncBomCosts_(); return r; }
function deleteCostItem_(u, p) {
  needBuy_(u); const ex = readAll_('costItems').find(x => x.code === p.code); if (!ex) throw new Error('找不到成本項目。');
  const used = [...new Set(readAll_('bom').filter(b => b.code === ex.code).map(b => b.parent))];
  if (used.length) throw new Error(ex.code + ' 還在這些 BOM 裡使用，請先移除：' + used.slice(0, 10).join('、') + (used.length > 10 ? ' 等 ' + used.length + ' 個' : ''));
  deleteRow_('costItems', ex); return true;  // 品號本身保留
}
/** 匯入成本資料庫（Excel「資料庫」分頁）：已存在的更新基本資料，單價不同就留紀錄（生效日＝價格更新日） */
function importCostItems_(u, p) {
  needBuy_(u); const rows = (p.rows || []).map(x => Object.assign(cleanCostItem_(x), { price: Number(x.price) || 0, currency: CURS_.indexOf(String(x.currency || '').toUpperCase()) >= 0 ? String(x.currency).toUpperCase() : 'TWD', priceDate: String(x.priceDate || '').slice(0, 10) }));
  if (!rows.length) throw new Error('沒有可匯入的資料。');
  const all = readAll_('costItems').map(noRow_); const by = {}; all.forEach(x => by[x.code.toLowerCase()] = x);
  const logs = []; const ts = Date.now(); let add = 0, upd = 0, chg = 0; const today = today_();
  rows.forEach((r, i) => {
    const k = r.code.toLowerCase(); const ex = by[k]; const eff = r.priceDate && r.priceDate <= today ? r.priceDate : today;
    if (ex) {
      const oldP = Number(ex.price) || 0;
      ['name', 'spec', 'unit', 'cat', 'metal', 'note'].forEach(f => { if (r[f] !== '') ex[f] = r[f]; }); ex.updatedAt = nowStr_(); upd++;
      if (r.price !== oldP || r.currency !== (ex.currency || 'TWD')) { logs.push({ id: 'C' + ts + '_' + i, itemCode: ex.code, effDate: eff, oldCost: oldP, newCost: r.price, currency: r.currency, supplier: '', note: 'Excel 匯入', byId: u.id, byName: u.name, at: nowStr_() });
        ex.price = r.price; ex.currency = r.currency; ex.priceDate = eff; chg++; }
    } else {
      const rec = Object.assign(r, { priceDate: eff, active: '是', updatedAt: nowStr_() }); by[k] = rec; all.push(rec); add++;
      logs.push({ id: 'C' + ts + '_' + i, itemCode: rec.code, effDate: rec.priceDate, oldCost: '', newCost: rec.price, currency: rec.currency, supplier: '', note: 'Excel 匯入（初始單價）', byId: u.id, byName: u.name, at: nowStr_() });
    }
  });
  writeAll_('costItems', all); append_('costLog', logs); COSTLOG_CACHE_ = null;
  const sy = syncCostItems_();  // 新編號建立品號；同編號的品名、規格、單位以品號為準
  return { add, upd, chg, made: sy.made, synced: syncBomCosts_() };
}
function cleanBom_(p, ciSet) {
  const parent = String(p.parent || '').trim(); if (!parent) throw new Error('請填成品品號。');
  const miss = [];
  const lines = (p.lines || []).filter(l => String(l.code || '').trim()).map((l, i) => {
    const code = String(l.code).trim(); if (ciSet && !ciSet[code.toLowerCase()]) miss.push(code);
    const n = (v, d) => v === '' || v == null ? d : Number(v);
    const useQty = n(l.useQty, n(l.unitQty, NaN)); if (isNaN(useQty) || useQty < 0) throw new Error(parent + ' 第 ' + (i + 1) + ' 行（' + code + '）的使用量不正確。');
    const base = n(l.base, 1); if (isNaN(base) || base < 0) throw new Error(parent + ' 第 ' + (i + 1) + ' 行的子件基數不正確。');
    return { parent, seq: i + 1, level: n(l.level, 1) || 0, virt: String(l.virt || '').trim() ? 'N' : '', code, unitQty: n(l.unitQty, useQty), useQty, base, note: String(l.note || '').trim() };
  });
  if (miss.length) throw new Error(parent + ' 有成本資料庫裡沒有的編號：' + [...new Set(miss)].slice(0, 12).join('、') + '。請先到「成本資料庫」新增。');
  return { parent, name: String(p.name || '').trim(), note: String(p.note || '').trim(), lines };
}
const bomDesc_ = x => x.code + ' ×' + x.useQty + (Number(x.base) !== 1 ? '×' + x.base : '') + (x.virt ? '(虛擬)' : '');
function bomDiff_(old, lines) {
  const was = old.map(bomDesc_), now = lines.map(bomDesc_);
  const add = now.filter(x => was.indexOf(x) < 0), del = was.filter(x => now.indexOf(x) < 0);
  return (old.length ? '' : '新建；') + (del.length ? '移除：' + del.join('、') + '；' : '') + (add.length ? '新增／修改：' + add.join('、') : '');
}
/** 儲存一個成品的 BOM（整份取代），可改成品品號（另存或改名） */
function saveBom_(u, p) {
  needBuy_(u);
  const ciSet = {}; readAll_('costItems').forEach(x => ciSet[x.code.toLowerCase()] = 1); readAll_('items').forEach(x => ciSet[String(x.code).toLowerCase()] = 1);
  const b = cleanBom_(p, ciSet); if (!b.lines.length) throw new Error('BOM 至少要有一行。');
  const orig = String(p.origParent || '').trim();
  const all = readAll_('bom').map(noRow_), heads = readAll_('bomHeads').map(noRow_);
  if (b.parent !== orig && heads.some(h => h.parent.toLowerCase() === b.parent.toLowerCase())) throw new Error(b.parent + ' 已經有 BOM 了，請直接打開修改。');
  const old = all.filter(x => x.parent === (orig || b.parent));
  const keep = all.filter(x => x.parent !== orig && x.parent !== b.parent).concat(b.lines);
  writeAll_('bom', keep);
  const h = heads.find(x => x.parent === (orig || b.parent));
  const rec = Object.assign(h || {}, { parent: b.parent, name: b.name, note: b.note, updatedAt: nowStr_(), byName: u.name });
  if (!h) heads.push(rec); writeAll_('bomHeads', heads);
  let sum = bomDiff_(old, b.lines); if (orig && orig !== b.parent) sum = '品號 ' + orig + ' 改為 ' + b.parent + '；' + sum;
  if (p.copyFrom) sum = '從 ' + p.copyFrom + ' 複製；' + sum;
  if (sum) append_('bomLog', [{ at: nowStr_(), parent: b.parent, byName: u.name, summary: sum }]);
  return { parent: b.parent, count: b.lines.length, synced: syncBomCosts_() };
}
function deleteBom_(u, p) {
  needBuy_(u); const par = String(p.parent || '');
  writeAll_('bom', readAll_('bom').map(noRow_).filter(x => x.parent !== par));
  writeAll_('bomHeads', readAll_('bomHeads').map(noRow_).filter(x => x.parent !== par));
  append_('bomLog', [{ at: nowStr_(), parent: par, byName: u.name, summary: '刪除整份 BOM' }]); return true;
}
/** 匯入多個 BOM（Excel 每個成品一個分頁）；同品號的 BOM 整份取代 */
function importBoms_(u, p) {
  needBuy_(u); const list = p.boms || []; if (!list.length) throw new Error('沒有可匯入的 BOM。');
  const ciSet = {}; readAll_('costItems').forEach(x => ciSet[x.code.toLowerCase()] = 1); readAll_('items').forEach(x => ciSet[String(x.code).toLowerCase()] = 1);
  const bs = list.map(x => cleanBom_(x, ciSet));
  const set = {}; bs.forEach(b => { if (set[b.parent]) throw new Error('匯入的檔案裡 ' + b.parent + ' 重複。'); set[b.parent] = 1; });
  const all = readAll_('bom').map(noRow_), heads = readAll_('bomHeads').map(noRow_);
  const logs = bs.map(b => ({ at: nowStr_(), parent: b.parent, byName: u.name, summary: 'Excel 匯入；' + (bomDiff_(all.filter(x => x.parent === b.parent), b.lines) || '內容沒有變') }));
  writeAll_('bom', all.filter(x => !set[x.parent]).concat(...bs.map(b => b.lines)));
  bs.forEach(b => { const h = heads.find(x => x.parent === b.parent); const rec = { parent: b.parent, name: b.name || (h && h.name) || '', note: b.note || (h && h.note) || '', updatedAt: nowStr_(), byName: u.name };
    if (h) Object.assign(h, rec); else heads.push(rec); });
  writeAll_('bomHeads', heads); append_('bomLog', logs);
  return { count: bs.length, lines: bs.reduce((s, b) => s + b.lines.length, 0), synced: syncBomCosts_() };
}
/** 金屬價格（銅價）：登記 LME、匯率、廠商報價 */
function saveMetal_(u, p) {
  needBuy_(u); const d = String(p.date || '').slice(0, 10); if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) throw new Error('請填日期。');
  const num = (v, l) => { if (v === '' || v == null) return ''; const x = Number(v); if (isNaN(x) || x < 0) throw new Error(l + '要是數字。'); return x; };
  const r = { id: p.id || 'M' + Date.now(), date: d, metal: String(p.metal || '紅銅').trim(), lme: num(p.lme, 'LME'), fx: num(p.fx, '匯率'), quote: num(p.quote, '報價'),
    note: String(p.note || '').trim(), byName: u.name, at: nowStr_() };
  const ex = readAll_('metalPrices').find(x => x.id === r.id); if (ex) { r._row = ex._row; update_('metalPrices', r); } else append_('metalPrices', [r]);
  return r.id;
}
function deleteMetal_(u, p) { needBuy_(u); const ex = readAll_('metalPrices').find(x => x.id === p.id); if (!ex) throw new Error('找不到紀錄。'); deleteRow_('metalPrices', ex); return true; }
function deleteOp_(u, p) {
  needOpEdit_(u); const o = readAll_('ops').find(x => x.code === p.code); if (!o) throw new Error('找不到製程。');
  if (readAll_('woReports').some(r => r.opCode === o.code || r.stationCode === o.code)) { o.active = '否'; o.updatedAt = nowStr_(); update_('ops', o); return { deactivated: true }; }
  deleteRow_('ops', o); return { deleted: true };
}

// ======================= 報工 =======================
function woReport_(u, p) {
  needProd_(u); const whs = readAll_('whs');
  let w = null, op = null;
  if (p.woNo) {
    w = readAll_('wos').find(x => x.no === p.woNo); if (!w) throw new Error('找不到工單 ' + (p.woNo || '') + '。');
    if (w.status === '已結案' || w.status === '作廢') throw new Error('工單 ' + w.no + ' 已' + w.status + '，不能再報工。');
    op = readAll_('woOps').find(o => o.woNo === w.no && o.lid === p.opLid);
    if (!op) throw new Error('請選擇製程。');
  } else {
    // 沒有工單的報工（收集現況用）：填品號和製程名稱即可
    const it = p.itemCode ? itemByAny_(readAll_('items'), p.itemCode) : null;
    const code = it ? it.code : String(p.itemCode || '').trim();   // 系統沒有的品號也可以直接記文字
    const name = String(p.opName || '').trim();
    if (!code && !name && !String(p.station || '').trim() && !String(p.finalItem || '').trim()) throw new Error('沒有工單時，生產品號、製程、工作站、最終產品至少填一項。');
    w = { no: '', itemCode: code, status: '' }; op = { lid: '', name: name, seq: '' };
  }
  const site = String(p.site || (w.site && whType_(whs, w.site) === '生產' ? w.site : '') || '').trim();
  const tx_ = v => String(v || '').trim();
  const fi = p.finalItem ? itemByAny_(readAll_('items'), p.finalItem) : null; const finalItem = fi ? fi.code : tx_(p.finalItem);
  // 生產地點：可以選已建立的生產地點（庫別代號），也可以直接填文字，之後再到「代碼」建立
  const hours = Number(p.hours || 0), good = Number(p.good || 0), bad = Number(p.bad || 0);
  if ([hours, good, bad].some(x => isNaN(x) || x < 0)) throw new Error('工時、良品、不良都要是 0 以上的數字。');
  if (!(hours > 0 || good > 0 || bad > 0)) throw new Error('請至少填工時、良品或不良其中一項。');
  if (bad > 0 && !String(p.badReason || '').trim()) throw new Error('有不良數時請填不良原因。');
  // 報工人員：一人或一組（多人時，工時是每人工時；良品/不良是全組合計，平均分給每個人）
  const users = readAll_('users');
  const list = (p.workers && p.workers.length ? p.workers : [{ workerId: p.workerId, worker: p.worker, dept: p.dept }]).map(x => {
    let worker = String(x.worker || '').trim(), dept = String(x.dept || '').trim(), workerId = '';
    if (x.workerId) {
      const per = users.find(y => y.id.toLowerCase() === String(x.workerId).trim().toLowerCase());
      if (!per || per.active !== '是') throw new Error('找不到員工ID ' + x.workerId + '，或已停用。');
      workerId = per.id; worker = per.name; dept = per.dept;
    }
    if (!workerId && !dept) throw new Error(worker + ' 沒有建檔，請填他的單位（課／組）。');
    return { workerId, worker, dept };
  }).filter(x => x.worker);
  if (!list.length) throw new Error('請刷員工證或填寫報工人員。');
  const n = list.length; const split = total => {
    if (n === 1) return [total];
    if (Number.isInteger(total)) { const b = Math.floor(total / n), rem = total - b * n; return list.map((x, i) => b + (i < rem ? 1 : 0)); }
    const each = Math.floor(total / n * 100) / 100; const arr = list.map(() => each); arr[n - 1] = round_(total - each * (n - 1)); return arr;
  };
  const goods = split(good), bads = split(bad);
  const lead = perms_(u).prodLead; const ts = Date.now(); const gid = n > 1 ? 'G' + ts : '';
  const recs = list.map((x, i) => ({ id: 'R' + ts + '_' + i + Math.floor(Math.random() * 100), date: p.date || today_(), woNo: w.no, opLid: op.lid, opName: op.name, opSeq: op.seq,
    itemCode: w.itemCode, workerId: x.workerId, worker: x.worker, dept: x.dept, hours, good: goods[i], bad: bads[i],
    badReason: String(p.badReason || '').trim(), note: String(p.note || '').trim(), byId: u.id, ts,
    opDone: p.opDone ? '是' : '', status: lead ? '已核准' : '待審核', reviewer: lead ? u.name : '', reviewedAt: lead ? nowStr_() : '', rejectReason: '',
    groupId: gid, teamSize: n, site, finalItem, station: tx_(p.station), opCode: tx_(p.opCode) || (readAll_('ops').find(x => x.name === op.name && (x.kind || '製程') === '製程') || {}).code || '', stationCode: tx_(p.stationCode), prevDept: tx_(p.prevDept), prevOp: tx_(p.prevOp), nextDept: tx_(p.nextDept), nextOp: tx_(p.nextOp) }));
  append_('woReports', recs);
  if (w.no && w.status === '未開工') { w.status = '生產中'; w.updatedAt = nowStr_(); update_('wos', w); }
  return { id: recs[0].id, status: recs[0].status, count: n, goods, bads };
}
function delReport_(u, p) {
  needProd_(u);
  const r = readAll_('woReports').find(x => x.id === p.id); if (!r) throw new Error('找不到這筆報工。');
  const st = r.status || '已核准';
  if (!perms_(u).prodLead && !(r.byId === u.id && st !== '已核准')) throw new Error('已核准的報工只有生產主管可以刪除；別人登記的報工也只有主管能刪。');
  deleteRow_('woReports', r); return true;
}
/** 主管審核：可以先修改數字再核准，或整批退回（要寫原因） */
function reviewReports_(u, p) {
  if (!perms_(u).prodLead) throw new Error('只有生產主管可以審核報工。');
  const ids = p.ids || []; if (!ids.length) throw new Error('請先勾選要審核的報工。');
  if (p.action === 'reject' && !String(p.reason || '').trim()) throw new Error('退回時請填寫原因。');
  const all = readAll_('woReports'); let n = 0;
  ids.forEach(id => {
    const r = all.find(x => x.id === id); if (!r) return;
    const e = (p.edits || {})[id];
    if (e) {
      ['hours', 'good', 'bad'].forEach(k => { if (e[k] !== undefined && e[k] !== '') { const v = Number(e[k]); if (isNaN(v) || v < 0) throw new Error('數字不正確。'); r[k] = v; } });
      if (e.badReason !== undefined) r.badReason = String(e.badReason || '').trim();
      if (e.opDone !== undefined) r.opDone = e.opDone ? '是' : '';
    }
    if (p.action === 'approve' && Number(r.bad) > 0 && !r.badReason) throw new Error(r.worker + ' 的報工有不良數，請先填不良原因。');
    r.status = p.action === 'approve' ? '已核准' : '退回'; r.reviewer = u.name; r.reviewedAt = nowStr_();
    r.rejectReason = p.action === 'reject' ? String(p.reason).trim() : '';
    update_('woReports', r); n++;
  });
  return { count: n };
}

// ======================= 銷貨單 =======================
function saveSale_(u, p) {
  needSales_(u); const pm = perms_(u); const d = p.doc || {};
  const all = readAll_('sales'); let x = d.no && !d.isNew ? all.find(y => y.no === d.no) : null;
  if (d.isNew && d.no && all.some(y => y.no === d.no)) throw new Error('銷貨單號 ' + d.no + ' 已經存在。');
  if (x && x.status !== '待出貨') throw new Error('狀態為「' + x.status + '」的銷貨單不能再修改。');
  const h = docHead_(d); const whs = readAll_('whs');
  h.whId = String(d.whId || '').trim(); if (h.whId && !whs.some(w => w.code === h.whId)) throw new Error('找不到庫別 ' + h.whId + '。');
  h.shipDate = d.shipDate || ''; h.orderNo = String(d.orderNo || '').trim(); h.exportNo = String(d.exportNo || '').trim();
  if (h.orderNo && !readAll_('orders').some(o => o.no === h.orderNo)) throw new Error('找不到訂單 ' + h.orderNo + '。');
  const items = readAll_('items'); const old = x ? readAll_('salesLines').filter(l => l.saleNo === x.no) : [];
  const lines = (d.lines || []).filter(l => String(l.itemCode || '').trim()).map((l, i) => {
    const it = itemByAny_(items, l.itemCode); if (!it) throw new Error('第 ' + (i + 1) + ' 行找不到品號 ' + l.itemCode + '（銷貨單的品號要在品號資料裡，才能扣庫存）。');
    const q = Number(l.qty); if (!(q > 0)) throw new Error('第 ' + (i + 1) + ' 行的數量要大於 0。');
    const o = old.find(y => y.lid === l.lid) || {};
    return { lid: l.lid || Utilities.getUuid().slice(0, 8), seq: i + 1, itemCode: it.code, name: it.name, nameEn: it.nameEn || '', spec: it.spec || '', unit: it.unit, qty: q,
      price: pm.price ? (l.price === '' || l.price == null ? '' : Number(l.price)) : o.price, whId: String(l.whId || '').trim(), note: String(l.note || '').trim(), shipQty: '',
      orderNo: String(l.orderNo || o.orderNo || h.orderNo || '').trim(), free: ['樣品', '補料', '其他'].indexOf(l.free) >= 0 ? l.free : '' };
  });
  // 來源訂單（可多張）：客戶、幣別要一致，數量不能超過訂單未出數量（扣掉已出貨與其他待出貨銷貨單）
  const ordNos = Array.from(new Set(lines.map(l => l.orderNo).filter(Boolean)));
  if (ordNos.length) {
    const orders = readAll_('orders'); const oLines = readAll_('orderLines');
    const shippedAll = {}; readAll_('txns').forEach(t => { if (!t.orderNo || String(t.purpose || '').indexOf('生產') === 0) return; const k = t.orderNo + '__' + t.itemCode;
      if (t.typeLabel === '出庫') shippedAll[k] = (shippedAll[k] || 0) + Number(t.qty || 0); else if (t.typeLabel === '入庫' && t.purpose === '客戶退回') shippedAll[k] = (shippedAll[k] || 0) - Number(t.qty || 0); });
    const imp = importedShipped_(); Object.keys(imp).forEach(k => shippedAll[k] = (shippedAll[k] || 0) + imp[k]);
    const others = {}; readAll_('sales').filter(y => y.status === '待出貨' && (!x || y.no !== x.no)).forEach(y => others[y.no] = y);
    const pend = {}; readAll_('salesLines').forEach(l => { const y = others[l.saleNo]; if (!y) return; const on = l.orderNo || y.orderNo; if (!on) return; const k = on + '__' + l.itemCode; pend[k] = (pend[k] || 0) + Number(l.qty || 0); });
    let first = null;
    ordNos.forEach(no => {
      const o = orders.find(y => y.no === no); if (!o) throw new Error('找不到訂單 ' + no + '。');
      if (o.status !== '進行中') throw new Error('訂單 ' + no + ' 已' + o.status + '，不能再開銷貨單。');
      if (!first) first = o; else if ((first.custCode || first.customer) !== (o.custCode || o.customer)) throw new Error('訂單 ' + no + ' 的客戶和 ' + first.no + ' 不同，不能放在同一張銷貨單。');
      const want = {}; lines.filter(l => l.orderNo === no).forEach(l => want[l.itemCode] = (want[l.itemCode] || 0) + l.qty);
      Object.keys(want).forEach(code => {
        const ordered = oLines.filter(l => l.orderNo === no && l.itemCode === code).reduce((s, l) => s + Number(l.qty || 0), 0);
        if (!ordered) throw new Error('訂單 ' + no + ' 沒有品號 ' + code + '。');
        const k = no + '__' + code; const left = round_(ordered - (shippedAll[k] || 0) - (pend[k] || 0));
        if (want[code] > left + 1e-9) throw new Error('訂單 ' + no + ' 的 ' + code + ' 只剩 ' + Math.max(0, left) + ' 可以出貨，這張銷貨單填了 ' + want[code] + '。');
      });
    });
    h.orderNo = ordNos[0];
    if (first && !h.custCode && first.custCode) h.custCode = first.custCode;
  }
  if (!lines.length) throw new Error('請至少填一個品項。');
  if (!x) {
    const no = String(d.no || '').trim() || nextNo_('SC', h.date, all.map(y => y.no));
    x = Object.assign({ no, salesId: u.id, salesName: u.name, status: '待出貨', createdAt: nowStr_() }, h); x.updatedAt = nowStr_(); append_('sales', [x]);
  } else { Object.assign(x, h, { updatedAt: nowStr_() }); update_('sales', x); }
  replaceLines_('salesLines', 'saleNo', x.no, lines);
  return { no: x.no };
}
/** 出口報單號碼：出貨後才拿到，所以已出貨的銷貨單也可以補填 */
/** 已出貨銷貨單的金額相關修改（單價、計價、備註、交易條件、幣別、稅別、出口報單號碼）；數量與品項不動，並留下修改紀錄 */
function saleAdjust_(u, p) {
  needSales_(u); const pm = perms_(u);
  const x = readAll_('sales').find(y => y.no === p.no); if (!x) throw new Error('找不到銷貨單。');
  if (x.status !== '已出貨') throw new Error('只有已出貨的銷貨單用這個方式修改；待出貨的請直接編輯。');
  const log = []; const h = p.head || {};
  const setH = (k, label, v) => { v = String(v == null ? '' : v).trim(); if (String(x[k] || '') !== v) { log.push(label + '：' + (x[k] || '（空白）') + ' → ' + (v || '（空白）')); x[k] = v; } };
  setH('terms', '交易條件', h.terms); setH('note', '備註', h.note); setH('exportNo', '出口報單號碼', h.exportNo);
  if (h.currency) setH('currency', '幣別', h.currency);
  if (h.taxType && h.taxType !== x.taxType) { setH('taxType', '稅別', h.taxType); x.taxRate = TAX_[h.taxType] != null ? TAX_[h.taxType] : 0; }
  const lines = readAll_('salesLines').filter(l => l.saleNo === x.no);
  (p.lines || []).forEach(n => { const l = lines.find(y => y.lid === n.lid); if (!l) return; const ch = [];
    if (pm.price) { const np = n.price === '' || n.price == null ? '' : Number(n.price); if (String(l.price) !== String(np)) { ch.push('單價 ' + (l.price === '' ? '（空白）' : l.price) + ' → ' + (np === '' ? '（空白）' : np)); l.price = np; } }
    const nf = ['樣品', '補料', '其他'].indexOf(n.free) >= 0 ? n.free : ''; if ((l.free || '') !== nf) { ch.push((l.free ? '不計價（' + l.free + '）' : '計價') + ' → ' + (nf ? '不計價（' + nf + '）' : '計價')); l.free = nf; }
    const nn = String(n.note || '').trim(); if ((l.note || '') !== nn) { ch.push('備註 → ' + (nn || '（空白）')); l.note = nn; }
    if (ch.length) { log.push(l.itemCode + '：' + ch.join('，')); update_('salesLines', l); } });
  if (!log.length) return { changed: 0 };
  x.editLog = (x.editLog ? x.editLog + '\n' : '') + nowStr_() + ' ' + u.name + '｜' + log.join('；'); x.updatedAt = nowStr_(); update_('sales', x);
  return { changed: log.length };
}
function setSaleExport_(u, p) {
  needSales_(u); const x = readAll_('sales').find(y => y.no === p.no); if (!x) throw new Error('找不到銷貨單。');
  x.exportNo = String(p.exportNo || '').trim(); x.updatedAt = nowStr_(); update_('sales', x); return true;
}
/** 修改銷貨單號（例如改成和鼎新一致）：單身、出庫紀錄、Packing List、Invoice、寄信紀錄一起換 */
function renameSale_(u, p) {
  needSales_(u);
  const from = String(p.no || '').trim(), to = String(p.newNo || '').trim();
  if (!to) throw new Error('請輸入新的銷貨單號。');
  if (!/^[A-Za-z0-9][A-Za-z0-9\-_]{2,39}$/.test(to)) throw new Error('單號只能用英文、數字和「-」，例如 2304-20261103001。');
  if (from === to) throw new Error('新單號和原單號一樣。');
  const all = readAll_('sales'); const x = all.find(y => y.no === from); if (!x) throw new Error('找不到銷貨單 ' + from + '。');
  if (all.some(y => y.no === to)) throw new Error('銷貨單號 ' + to + ' 已經有了，請確認是不是重複的單。');
  const n = { lines: replaceCol_('salesLines', 'saleNo', from, to), txns: replaceCol_('txns', 'ref', from, to),
    packings: replaceCol_('packings', 'sc', from, to), invoices: replaceCol_('invoices', 'sc', from, to), mails: replaceCol_('mails', 'docNo', from, to) };
  ['packings', 'invoices'].forEach(k => readAll_(k).filter(r => r.sc === to).forEach(r => {
    try { const d = JSON.parse(r.json || '{}'); let ch = false; ['no', 'sc'].forEach(f => { if (d[f] === from) { d[f] = to; ch = true; } }); if (ch) { r.json = JSON.stringify(d); update_(k, r); } } catch (e) {} }));
  const y = readAll_('sales').find(z => z.no === from);
  y.no = to; y.updatedAt = nowStr_();
  y.editLog = (y.editLog ? y.editLog + '\n' : '') + nowStr_() + ' ' + u.name + '｜單號由 ' + from + ' 改為 ' + to;
  update_('sales', y);
  return { no: to, moved: n };
}
/** 訂單、報價單改單號（例如改成跟鼎新一樣）：所有引用這個單號的地方一起改，單號以外的內容不動 */
function renameDoc_(u, p) {
  needSales_(u);
  const kind = p.kind === 'quote' ? 'quote' : 'order', k = kind === 'quote' ? 'quotes' : 'orders', label = kind === 'quote' ? '報價單號' : '訂單單號';
  const from = String(p.no || '').trim(), to = String(p.newNo || '').trim();
  if (!to) throw new Error('請輸入新的' + label + '。');
  if (!/^[A-Za-z0-9][A-Za-z0-9\-_]{2,39}$/.test(to)) throw new Error('單號只能用英文、數字和「-」，例如 2204-20261116001。');
  if (from === to) throw new Error('新單號和原單號一樣。');
  const all = readAll_(k); const d = all.find(y => y.no === from); if (!d) throw new Error('找不到' + label + ' ' + from + '。');
  if (all.some(y => y.no === to)) throw new Error(label + ' ' + to + ' 已經有了，請確認是不是重複的單。');
  const n = {};
  if (kind === 'quote') {
    n.lines = replaceCol_('quoteLines', 'quoteNo', from, to); n.orders = replaceCol_('orders', 'quoteNo', from, to);
  } else {
    n.lines = replaceCol_('orderLines', 'orderNo', from, to); n.quotes = replaceCol_('quotes', 'orderNo', from, to);
    n.sales = replaceCol_('sales', 'orderNo', from, to); n.salesLines = replaceCol_('salesLines', 'orderNo', from, to);
    n.wos = replaceCol_('wos', 'orderNo', from, to); n.txns = replaceCol_('txns', 'orderNo', from, to);
  }
  n.mails = replaceCol_('mails', 'docNo', from, to);
  const y = readAll_(k).find(z => z.no === from);
  y.no = to; if (!String(y.erpNo || '').trim() && p.asErp) y.erpNo = to; y.updatedAt = nowStr_();
  y.note = y.note || '';
  update_(k, y);
  return { no: to, moved: n };
}
function saleStatus_(u, p) {
  needSales_(u);
  const x = readAll_('sales').find(y => y.no === p.no); if (!x) throw new Error('找不到銷貨單。');
  if (x.status === '已出貨') throw new Error('已出貨的銷貨單不能改狀態；要更正請由管理員修改出庫紀錄。');
  if (p.status === '已出貨') {   // 誤按作廢、但貨其實已經出了（出庫紀錄還在）：管理員可以恢復成已出貨，不會再扣一次庫存
    if (u.role !== 'admin') throw new Error('只有管理員可以把銷貨單恢復成已出貨。');
    const tail = String(x.no).split('-').pop();
    const outs = readAll_('txns').filter(t => t.typeLabel === '出庫' && [x.no, tail].indexOf(String(t.ref || '').trim()) >= 0);
    if (!outs.length) throw new Error('找不到這張銷貨單的出庫紀錄，不能直接恢復成已出貨；請改成待出貨，再由倉庫確認出貨。');
    x.status = '已出貨'; if (!x.shippedAt) x.shippedAt = String(outs[0].date).slice(0, 10);
    x.editLog = (x.editLog ? x.editLog + '\n' : '') + nowStr_() + ' ' + u.name + '｜作廢 → 已出貨（出庫紀錄 ' + outs.length + ' 筆已存在）';
    x.updatedAt = nowStr_(); update_('sales', x); return true;
  }
  if (['作廢', '待出貨'].indexOf(p.status) < 0) throw new Error('狀態不正確。');
  x.status = p.status; x.updatedAt = nowStr_(); update_('sales', x); return true;
}
/** 訂單轉銷貨單：帶入尚未出貨、也還沒開在其他待出貨銷貨單上的數量 */
function orderToSale_(u, p) {
  needSales_(u);
  const o = readAll_('orders').find(y => y.no === p.no); if (!o) throw new Error('找不到訂單。');
  if (o.status !== '進行中') throw new Error('訂單已' + o.status + '，不能再開銷貨單。');
  const lines = readAll_('orderLines').filter(l => l.orderNo === o.no && l.itemCode).sort((a, b) => a.seq - b.seq);
  const ono = orderNoResolver_();
  const shipped = {}; readAll_('txns').forEach(t => { if (!t.orderNo || ono(t.orderNo, t.itemCode) !== o.no || String(t.purpose || '').indexOf('生產') === 0) return; const k = t.itemCode;
    if (t.typeLabel === '出庫') shipped[k] = (shipped[k] || 0) + Number(t.qty || 0); else if (t.typeLabel === '入庫' && t.purpose === '客戶退回') shipped[k] = (shipped[k] || 0) - Number(t.qty || 0); });
  const imp = importedShipped_(o.no); Object.keys(imp).forEach(k => { const it = k.split('__')[1]; shipped[it] = (shipped[it] || 0) + imp[k]; });
  const pend = {}; const openSales = {}; readAll_('sales').filter(x => x.status === '待出貨').forEach(x => openSales[x.no] = x);
  readAll_('salesLines').filter(l => openSales[l.saleNo] && (l.orderNo || openSales[l.saleNo].orderNo) === o.no).forEach(l => pend[l.itemCode] = (pend[l.itemCode] || 0) + Number(l.qty || 0));
  const items = readAll_('items');
  const out = []; lines.forEach(l => {
    const used = Math.min(Number(l.qty), Math.max(0, (shipped[l.itemCode] || 0) + (pend[l.itemCode] || 0)));
    shipped[l.itemCode] = Math.max(0, (shipped[l.itemCode] || 0) + (pend[l.itemCode] || 0) - used); pend[l.itemCode] = 0;
    const rest = round_(Number(l.qty) - used); if (rest <= 0) return;
    const it = itemByAny_(items, l.itemCode);
    out.push({ itemCode: l.itemCode, qty: rest, price: l.price, whId: (it && it.mainWh) || '', note: '', orderNo: o.no });
  });
  if (!out.length) throw new Error('這張訂單的品項都已出貨，或已經開在待出貨的銷貨單上了。');
  return saveSale_(u, { doc: { isNew: true, no: p.saleNo || '', date: p.date || today_(), custCode: o.custCode || '', customer: o.customer, contact: o.contact, orderNo: o.no,
    currency: o.currency, taxType: o.taxType, whId: p.whId || '', shipDate: p.shipDate || '', terms: o.terms, note: o.custPO ? 'PO ' + o.custPO : '', lines: out } });
}
/** 倉庫確認出貨：依實出數量扣庫存（全部檢查通過才寫入），銷貨單變「已出貨」 */
function shipSale_(u, p) {
  const pm = perms_(u); if (!pm.wh) throw new Error('只有倉庫人員可以確認出貨。');
  const x = readAll_('sales').find(y => y.no === p.no); if (!x) throw new Error('找不到銷貨單。');
  if (x.status !== '待出貨') throw new Error('這張銷貨單的狀態是「' + x.status + '」，不能再出貨。');
  const lines = readAll_('salesLines').filter(l => l.saleNo === x.no);
  const date = p.date || today_();
  const moves = (p.lines || []).filter(l => Number(l.qty) > 0).map(l => {
    const sl = lines.find(y => y.lid === l.lid); if (!sl) throw new Error('銷貨單明細有變動，請重新整理。');
    const wh = l.whId || sl.whId || x.whId; if (!wh) throw new Error(sl.itemCode + ' 請選擇出貨庫別。');
    return { sl, m: { type: 'out', purpose: '銷貨出庫', itemId: sl.itemCode, whId: wh, qty: Number(l.qty), date, ref: x.no, party: x.customer, orderNo: sl.orderNo || x.orderNo || '',
      packLines: l.packLines || '', pack: l.pack || '', palletWt: l.palletWt || '', note: String(p.note || '').trim(), filler: p.filler, dept: p.dept, fillerId: p.fillerId } };
  });
  if (!moves.length) throw new Error('請填入實出數量。');
  // 這張單（含沒有單別的舊單號，例如 2304-20261014001 ↔ 20261014001）已經有同品號的銷貨出庫：多半是在出入庫登記先登記過，再確認一次就會重複扣庫存
  if (!p.force) {
    const tail = String(x.no).split('-').pop(), codes = new Set(moves.map(v => v.sl.itemCode));
    const dup = readAll_('txns').filter(t => t.typeLabel === '出庫' && codes.has(t.itemCode) && (String(t.ref || '').trim() === x.no || String(t.ref || '').trim() === tail || String(t.ref || '').split('-').pop() === tail && /^\d{8,}$/.test(tail)));
    if (dup.length) throw new Error('DUPSHIP:' + dup.map(t => String(t.date).slice(0, 10) + ' ' + t.itemCode + ' ' + t.qty + '（單號 ' + t.ref + '）').join('；'));
  }
  const ctx = stockCtx_(); const rec = []; const items = readAll_('items'), whs = readAll_('whs');
  moves.forEach(v => moveOne_(u, v.m, ctx, rec, items, whs));
  flushStock_(ctx); append_('txns', rec);
  moves.forEach(v => { v.sl.shipQty = v.m.qty; v.sl.whId = v.m.whId; update_('salesLines', v.sl); });
  x.status = '已出貨'; x.shippedAt = nowStr_(); x.shippedBy = p.filler || u.name; x.updatedAt = nowStr_(); update_('sales', x);
  return { count: moves.length };
}

/** 取消出貨（管理員）：出貨後發現銷貨單有錯時用。刪掉這張單「確認出貨」產生的銷貨出庫、把庫存加回去，
 *  銷貨單回到「待出貨」，改好後倉庫再重新確認出貨。入庫紀錄、批號都不動；修改紀錄會留下取消了哪些出庫。 */
function unshipSale_(u, p) {
  const x = readAll_('sales').find(y => y.no === p.no); if (!x) throw new Error('找不到銷貨單。');
  if (x.status !== '已出貨') throw new Error('這張銷貨單的狀態是「' + x.status + '」，不用取消出貨。');
  if (x.imported === '是') throw new Error('這張是從舊資料匯入的銷貨單，沒有系統的出貨紀錄可以取消；請改由出入庫紀錄更正。');
  const lines = readAll_('salesLines').filter(l => l.saleNo === x.no), codes = new Set(lines.map(l => l.itemCode));
  const outs = readAll_('txns').filter(t => t.typeLabel === '出庫' && t.purpose === '銷貨出庫' && String(t.ref || '').trim() === x.no && codes.has(t.itemCode));
  if (!outs.length && !p.noOuts) throw new Error('NOOUT:找不到這張銷貨單的出庫紀錄（可能已經手動刪除）。');
  if (!p.force) { const hits = []; outs.forEach(t => countedAfter_(t, txnKeys_(t)).forEach(h => hits.push(h))); if (hits.length) throw new Error('COUNTED:' + hits.join('；')); }
  const ctx = stockCtx_();
  outs.forEach(t => applyTxnDelta_(ctx, itemForTxn_(t), t, -Number(t.qty), ''));
  flushStock_(ctx);
  outs.slice().sort((a, b) => (b._row || 0) - (a._row || 0)).forEach(t => deleteRow_('txns', t));
  lines.forEach(l => { l.shipQty = ''; update_('salesLines', l); });
  const why = String(p.reason || '').trim();
  x.status = '待出貨'; x.shippedAt = ''; x.shippedBy = '';
  x.editLog = (x.editLog ? x.editLog + '\n' : '') + nowStr_() + ' ' + u.name + '｜取消出貨：' + (outs.length ? '' : '出庫紀錄已先手動刪除，只改回待出貨') + outs.map(t => t.itemCode + ' ' + t.qty + '（' + t.whCode + '）').join('、') + (why ? '；原因：' + why : '');
  x.updatedAt = nowStr_(); update_('sales', x);
  return { count: outs.length };
}

// ======================= 結帳與收款 =======================
// 結帳單：挑一個客戶的已出貨銷貨單（預設某個月，也可以加入之前還沒收款的），輸出對帳單給客戶確認金額。
// 收款：客戶匯款常常不是一張一張付，收款時把金額沖到哪幾張銷貨單（預設從最舊的未收款開始沖），匯款憑證存成附件。
function needPrice_(u) { if (!perms_(u).price) throw new Error('只有業務或管理員可以處理結帳與收款。'); }
const jsonArr_ = v => { try { const a = JSON.parse(v || '[]'); return Array.isArray(a) ? a : []; } catch (e) { return []; } };
const jsonObj_ = v => { try { const a = JSON.parse(v || '{}'); return a && typeof a === 'object' && !Array.isArray(a) ? a : {}; } catch (e) { return {}; } };
/** 附件：網頁傳來 [{name, mime, b64}] 存到「收款與結帳附件」資料夾；已存的 [{id, name, url}] 原樣保留 */
function saveFiles_(list) {
  const out = [];
  (list || []).forEach(f => {
    if (f && f.id) { out.push({ id: f.id, name: f.name, url: f.url, mime: f.mime || '' }); return; }
    if (!f || !f.b64) return;
    if (String(f.b64).length > 14e6) throw new Error('檔案「' + f.name + '」太大，請小於 10MB。');
    const root = DriveApp.getRootFolder(); const it = root.getFoldersByName('收款與結帳附件');
    const folder = it.hasNext() ? it.next() : root.createFolder('收款與結帳附件');
    const file = folder.createFile(Utilities.newBlob(Utilities.base64Decode(f.b64), f.mime || 'application/octet-stream', String(f.name || 'file')));
    out.push({ id: file.getId(), name: file.getName(), url: file.getUrl(), mime: f.mime || '' });
  });
  return JSON.stringify(out);
}
function billSave_(u, p) {
  needPrice_(u); const d = p.doc || {};
  const sales = (d.sales || []).map(String).filter(Boolean); if (!sales.length) throw new Error('請至少勾一張銷貨單。');
  const all = readAll_('bills'); const now = nowStr_();
  let x = d.no ? all.find(b => b.no === d.no) : null;
  if (!x) x = { no: nextNo_('BL', d.date || today_(), all.map(b => b.no)), status: '草稿', byName: u.name, ts: Date.now(), files: '[]' };
  ['date', 'custCode', 'customer', 'currency', 'period', 'lang', 'note'].forEach(k => { if (d[k] !== undefined) x[k] = String(d[k]).trim(); });
  if (!x.date) x.date = today_();
  x.sales = JSON.stringify(sales); x.amount = Number(d.amount) || 0; x.updatedAt = now;
  if (x._row) update_('bills', x); else append_('bills', [x]);
  return { no: x.no };
}
function billStatus_(u, p) {
  needPrice_(u); const x = readAll_('bills').find(b => b.no === p.no); if (!x) throw new Error('找不到結帳單。');
  if (p.status) { if (['草稿', '已寄出', '客戶已確認'].indexOf(p.status) < 0) throw new Error('狀態不正確。'); x.status = p.status; }
  if (p.status === '已寄出' && !x.sentAt) x.sentAt = p.date || today_();
  if (p.status === '客戶已確認') x.confirmedAt = p.date || today_();
  if (p.status === '草稿') { x.sentAt = ''; x.confirmedAt = ''; }
  if (p.confirmNote !== undefined) x.confirmNote = String(p.confirmNote).trim();
  if (p.files) x.files = saveFiles_(p.files);
  x.updatedAt = nowStr_(); update_('bills', x); return true;
}
function billDelete_(u, p) {
  needPrice_(u); const x = readAll_('bills').find(b => b.no === p.no); if (!x) throw new Error('找不到結帳單。');
  deleteRow_('bills', x); return true;
}
function paySave_(u, p) {
  needPrice_(u); const d = p.doc || {}; const all = readAll_('payments'); const now = nowStr_();
  const amount = Number(d.amount); if (!(amount > 0)) throw new Error('收款金額要大於 0。');
  if (!d.custCode && !d.customer) throw new Error('請選客戶。');
  const alloc = {}; Object.keys(d.alloc || {}).forEach(k => { const v = Number(d.alloc[k]); if (v > 0) alloc[k] = v; });
  const used = Object.values(alloc).reduce((s, v) => s + v, 0), fee = Number(d.fee) || 0;
  if (used > amount + fee + 0.005) throw new Error('沖銷金額合計（' + used + '）不能大於收款金額加手續費／匯差（' + (amount + fee) + '）。');
  let x = d.id ? all.find(y => y.id === d.id) : null;
  if (!x) x = { id: nextNo_('RC', d.date || today_(), all.map(y => y.id)), byName: u.name, ts: Date.now() };
  ['date', 'custCode', 'customer', 'currency', 'note'].forEach(k => { if (d[k] !== undefined) x[k] = String(d[k]).trim(); });
  if (!x.date) x.date = today_();
  x.amount = amount; x.fee = fee; x.alloc = JSON.stringify(alloc); x.files = saveFiles_(d.files); x.updatedAt = now;
  if (x._row) update_('payments', x); else append_('payments', [x]);
  return { id: x.id };
}
function payDelete_(u, p) {
  needPrice_(u); const x = readAll_('payments').find(y => y.id === p.id); if (!x) throw new Error('找不到收款紀錄。');
  deleteRow_('payments', x); return true;
}

// ======================= 重新包裝 =======================
/** 只改庫存的包裝狀態（不改數量），並留下包裝紀錄 */
function repack_(u, p) {
  const item = itemByAny_(readAll_('items'), p.itemCode); if (!item) throw new Error('找不到品號 ' + (p.itemCode || '') + '。');
  whOf_(p.whId);
  const r = readAll_('stock').find(x => x.itemId === item.code && x.whId === p.whId);
  if (!r || !(Number(r.qty) > 0)) throw new Error(item.code + ' 在 ' + p.whId + ' 沒有庫存，不能登記包裝。');
  const pk = packNorm_(p.packLines); if (!pk.text) throw new Error('請填寫新的包裝明細，例如 4×12 + 1×5。');
  const total = String(pk.text).split(' + ').reduce((s, x) => { const m = x.split('×'); return s + Number(m[0]) * Number(m[1]); }, 0);
  const mismatch = Math.abs(total - Number(r.qty)) > 1e-9;
  if (mismatch && !p.force) throw new Error('MISMATCH:' + total + ':' + r.qty);
  const date = p.date || today_(); const before = r.packLines || '';
  r.packLines = pk.text; r.packAt = date; r.packSize = String(p.packSize || '').trim(); update_('stock', r);
  append_('repacks', [{ date, itemCode: item.code, itemName: item.name, whId: p.whId, qty: r.qty, before, after: pk.text, packSize: r.packSize,
    note: String(p.note || '').trim(), filler: String(p.filler || u.name).trim(), byId: u.id, ts: Date.now() }]);
  return { mismatch, total };
}

// ======================= 庫位與鼎新庫別 =======================
// 庫位只記實際位置：倉庫代號-區-4位數編號，例如 WO-A-0001（大寫、去空白）
function locNorm_(v) { return String(v || '').trim().toUpperCase().replace(/\s+/g, '').replace(/[－—–]/g, '-'); }
// 資料傳回鼎新時用的庫別：品號第一碼決定（1 原料、2 物料、3 半成品、4 成品、5 商品、6 物料）；品號可單獨指定
const ERP_WH_BY_PREFIX = { '1': '1111', '2': '1112', '3': '1113', '4': '1114', '5': '1115', '6': '1112' };
const ERP_WH_NAME = { '1111': '原料倉', '1112': '物料倉', '1113': '半成品倉', '1114': '成品倉', '1115': '商品存貨倉', '1121': '不良品倉', '1122': '待報廢倉',
  '1211': '寄庫倉', '1311': '暫出倉', '1312': '暫入倉', '1330': '暫入轉出倉', '2111': '耗材倉', '2112': '客供倉', '2113': '費用倉', '2114': '收入倉', '2121': '已報廢倉' };
function erpWhOf_(item, purpose) {
  if (purpose === '客戶退回') return '1121';
  if (item && item.erpWh) return String(item.erpWh).trim();
  const c = String(item && item.code || '').charAt(0);
  return ERP_WH_BY_PREFIX[c] || '';
}

// ======================= 棧板調整：併板／改包裝 =======================
// 入庫紀錄（批號、品管出廠檢驗都跟著它）完全不動；另外記一筆「棧板」資料，Packing List 帶出時用最新的棧板資料。
const plLots_ = t => { try { return JSON.parse(t.lots || '[]') || []; } catch (e) { return []; } };
function palletOverlay_() {
  const m = {};
  readAll_('pallets').filter(t => t.status === '有效').sort((a, b) => (Number(a.ts) || 0) - (Number(b.ts) || 0)).forEach(t => {
    plLots_(t).forEach((x, i) => { m[x.lotNo] = { id: t.id, head: i === 0, packLines: x.packLines || '', pack: t.pack, palletWt: t.palletWt, loc: t.loc || '' }; });
  });
  return m;
}
function palletsLoad_(u, p) {
  const lots = stockLots_(null, '', { inclReserved: true }).filter(l => l.lotNo);
  const pallets = readAll_('pallets', { tail: 300 }).map(t => { delete t._row; t.lotList = plLots_(t); return t; }).sort((a, b) => b.ts - a.ts);
  return { lots, pallets };
}
function savePallet_(u, p) {
  const sel = (p.lots || []).filter(x => x && x.lotNo); if (!sel.length) throw new Error('請至少勾一個批號。');
  if (new Set(sel.map(x => x.lotNo)).size !== sel.length) throw new Error('同一個批號勾了兩次。');
  const avail = {}; stockLots_(null, '', { inclReserved: true }).forEach(l => { if (l.lotNo) avail[l.lotNo] = l; });
  sel.forEach(x => { if (!avail[x.lotNo]) throw new Error('批號 ' + x.lotNo + ' 已經沒有庫存（可能已出貨），不能調整。'); });
  const wh = avail[sel[0].lotNo].whId;
  if (sel.some(x => avail[x.lotNo].whId !== wh)) throw new Error('放在同一板的貨要在同一個庫別；不同庫別請先用「調撥」移過來。');
  const date = p.date || today_(), now = nowStr_(), who = String(p.filler || u.name).trim(), codes = new Set(sel.map(x => x.lotNo));
  const all = readAll_('pallets');
  // 這些批號原本在別的棧板：從那一板移出（那一板剩下的貨照舊）
  all.filter(t => t.status === '有效').forEach(t => {
    const L = plLots_(t), keep = L.filter(x => !codes.has(x.lotNo)); if (keep.length === L.length) return;
    t.lots = JSON.stringify(keep); if (!keep.length) t.status = '已調整';
    t.history = (t.history ? t.history + '\n' : '') + now + ' ' + who + ' 移出 ' + L.filter(x => codes.has(x.lotNo)).map(x => x.lotNo).join('、');
    update_('pallets', t);
  });
  const id = nextNo_('PLT', date, all.map(x => x.id));
  const lots = sel.map(x => { const l = avail[x.lotNo]; const pk = packNorm_(x.packLines).text;
    return { lotNo: x.lotNo, itemCode: l.itemCode, qty: l.qty, packLines: pk || l.packLines || '', before: l.packLines || '' }; });
  const loc = p.loc ? locNorm_(p.loc) : (sel.map(x => avail[x.lotNo].loc).find(Boolean) || '');
  append_('pallets', [{ id, date, whId: wh, loc, lots: JSON.stringify(lots), pack: String(p.pack || '').trim(), palletWt: Number(p.palletWt) || '',
    status: '有效', note: String(p.note || '').trim(), history: now + ' ' + who + ' 建立（' + (lots.length > 1 ? '併板 ' + lots.length + ' 批' : '改包裝') + '）',
    filler: who, byId: u.id, ts: Date.now() }]);
  return { id };
}

// ======================= Commercial Invoice（只有業務） =======================
function getInvoice_(u, p) {
  needSales_(u);
  const sc = String(p.sc || '').trim(); if (!sc) throw new Error('請輸入銷貨單號。');
  const saved = readAll_('invoices').find(x => x.sc === sc);
  const sale = readAll_('sales').find(x => x.no === sc) || null;
  const items = readAll_('items');
  let lines = [];
  if (sale) {
    lines = readAll_('salesLines').filter(l => l.saleNo === sc).sort((a, b) => a.seq - b.seq).map(l => ({
      itemCode: l.itemCode, desc: l.nameEn || (itemByAny_(items, l.itemCode) || {}).nameEn || l.name, spec: (itemByAny_(items, l.itemCode) || {}).specEn || '',
      qty: sale.status === '已出貨' && l.shipQty !== '' && l.shipQty != null ? Number(l.shipQty) : Number(l.qty), unit: l.unit, price: l.price, free: l.free || '' }));
  } else {
    // 舊資料沒有銷貨單：從出庫紀錄帶品號與數量，單價盡量從訂單帶，沒有就留空手動填
    const oLines = readAll_('orderLines');
    lines = txnsQuery_(u, { ref: sc }).filter(t => t.type === 'out').map(t => {
      const it = itemByAny_(items, t.itemCode) || {}; const ol = t.orderNo ? oLines.find(l => l.orderNo === t.orderNo && l.itemCode === t.itemCode) : null;
      return { itemCode: t.itemCode, desc: it.nameEn || t.itemName, spec: it.specEn || '', qty: Number(t.qty), unit: t.unit, price: ol ? ol.price : '' };
    });
  }
  const pk = readAll_('packings').find(x => x.sc === sc);
  const party = sale ? sale.customer : '';
  const cons = party ? readAll_('consignees').find(c => c.company === party) : null;
  const cm = sale ? readAll_('customers').find(c => (sale.custCode && c.code === sale.custCode) || c.short === party || c.full === party) : null;
  return { saved: saved ? { data: JSON.parse(saved.json || '{}'), updatedAt: saved.updatedAt, byName: saved.byName } : null,
    sale: sale ? { no: sale.no, date: sale.date, customer: sale.customer, currency: sale.currency, terms: sale.terms, orderNo: sale.orderNo, status: sale.status } : null,
    lines, packing: pk ? JSON.parse(pk.json || '{}') : null, consignee: cons ? clean_(cons) : null, customer: cm ? clean_(cm) : null };
}
function saveInvoice_(u, p) {
  needSales_(u);
  const d = p.data || {}; const sc = String(d.sc || '').trim(); if (!sc) throw new Error('缺少銷貨單號。');
  const ex = readAll_('invoices').find(x => x.sc === sc);
  const rec = Object.assign(ex || {}, { sc, json: JSON.stringify(d), updatedAt: nowStr_(), byName: u.name });
  if (ex) update_('invoices', rec); else append_('invoices', [rec]);
  return { updatedAt: rec.updatedAt, byName: u.name };
}

// ======================= 客戶主檔 =======================
const CUST_KEYS_ = ['short', 'full', 'nameEn', 'contact', 'phone', 'email', 'address', 'shipTo', 'currency', 'taxType', 'payTerms', 'tradeTerms', 'salesName', 'note'];
/** 統一單據上的客戶名稱：報價單、訂單、銷貨單有客戶代號的，客戶名稱改成客戶資料的簡稱（同一個客戶只出現一個名稱）。
 *  出入庫紀錄不動。p.code 有填就只處理這個客戶。 */
function syncCustNames_(u, p) {
  needSales_(u);
  const only = String(p.code || '').trim(); const cs = {};
  readAll_('customers').forEach(c => { const n = String(c.short || c.full || '').trim(); if (c.code && n) cs[c.code] = n; });
  const out = { quotes: 0, orders: 0, sales: 0, names: {} };
  ['quotes', 'orders', 'sales'].forEach(k => readAll_(k).forEach(d => {
    const n = cs[d.custCode]; if (!n || (only && d.custCode !== only) || d.customer === n) return;
    out.names[d.customer || '（空白）'] = n; out[k]++; if (p.dry) return; d.customer = n; update_(k, d);
  }));
  return out;
}
function saveCustomer_(u, p) {
  needSales_(u); const c = p.cust || {};
  const code = String(c.code || '').trim(); if (!code) throw new Error('請輸入客戶代號（和鼎新一致，例如 A20007）。');
  if (!String(c.short || c.full || '').trim()) throw new Error('請輸入客戶簡稱或全名。');
  const all = readAll_('customers'); const oldCode = p.isNew ? code : String(p.oldCode || code);
  const ex = all.find(x => x.code === oldCode);
  if (p.isNew && all.some(x => x.code.toLowerCase() === code.toLowerCase())) throw new Error('客戶代號 ' + code + ' 已經存在。');
  if (!p.isNew && !ex) throw new Error('找不到客戶 ' + oldCode + '。');
  if (!p.isNew && code !== oldCode && all.some(x => x !== ex && x.code.toLowerCase() === code.toLowerCase())) throw new Error('客戶代號 ' + code + ' 已經存在。');
  const rec = ex || { code };
  rec.code = code; CUST_KEYS_.forEach(k => { if (c[k] !== undefined) rec[k] = String(c[k] || '').trim(); });
  rec.active = c.active === '否' ? '否' : '是'; rec.updatedAt = nowStr_();
  if (ex) update_('customers', rec); else append_('customers', [rec]);
  if (ex && code !== oldCode) ['quotes', 'orders', 'sales'].forEach(k => readAll_(k).filter(d => d.custCode === oldCode).forEach(d => { d.custCode = code; update_(k, d); }));
  return { code };
}
/** 從鼎新匯出的客戶資料整批匯入：代號已存在就更新有值的欄位 */
function importCustomers_(u, p) {
  needSales_(u); const all = readAll_('customers'); let made = 0, upd = 0; const add = [];
  (p.rows || []).forEach(r => {
    const code = String(r.code || '').trim(); if (!code) return;
    const ex = all.find(x => x.code.toLowerCase() === code.toLowerCase()) || add.find(x => x.code.toLowerCase() === code.toLowerCase());
    const rec = ex || { code, active: '是' };
    CUST_KEYS_.forEach(k => { if (r[k] !== undefined && String(r[k]).trim() !== '') rec[k] = String(r[k]).trim(); });
    rec.updatedAt = nowStr_();
    if (ex && ex._row) { update_('customers', rec); upd++; } else if (!ex) { add.push(rec); made++; }
  });
  append_('customers', add);
  return { made, upd };
}
function deleteCustomer_(u, p) {
  needSales_(u);
  const c = readAll_('customers').find(x => x.code === p.code); if (!c) throw new Error('找不到客戶。');
  const used = ['quotes', 'orders', 'sales'].some(k => readAll_(k).some(d => d.custCode === c.code));
  if (used) { c.active = '否'; c.updatedAt = nowStr_(); update_('customers', c); return { deactivated: true }; }
  deleteRow_('customers', c); return { deleted: true };
}
