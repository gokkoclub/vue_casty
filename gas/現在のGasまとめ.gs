/***** 設定 *****/
const NOTION_CONF = {
  VERSION: "2022-06-28",
  PROP: {
    TOKEN: "NOTION_TOKEN",   // スクリプトプロパティ名
    DB_ID: "NOTION_DB_ID"    // スクリプトプロパティ名
  },
  SHEET_NAME: "Notion_FromDB", // 出力先シート名

  // Notionのプロパティ名と完全に一致させてください
  // 配列の最後に追加したため、シート上では「L列」に出力されます
  HEADERS: [
    "page_id", 
    "名前", 
    "性別", 
    "事務所", 
    "出演回数", 
    "アイコン_Gドライブリンク", 
    "連絡先",       // リレーション
    "X(Twitter)",  // URL
    "Instagram",   // URL
    "TikTok",      // URL
    "ふりがな",    // K列
    "生年月日"     // ★追加（L列になります）
  ]
};

/**
 * 【メイン関数】これを時間トリガーに設定してください
 * 1. Notion同期 -> 2. 新規追加 -> 3. 削除済み更新 の順で実行します
 */
function mainDailySync() {
  try {
    console.log("【開始】Notion同期処理");
    syncNotionToSheet();
    
    // シートへの書き込みを確定させる
    SpreadsheetApp.flush();
    
    console.log("【開始】キャストリスト更新処理（新規追加）");
    syncNewCastMembersWithIdAndFormulas();
    
    console.log("【開始】削除済みメンバーID更新処理");
    markDeletedCastsInColumnA();

    console.log("【完了】全処理が正常に終了しました");
    
  } catch (e) {
    console.error("エラーが発生しました: " + e.stack);
  }
}

// =======================================================
// 1. Notion API連携用関数 (データ取得・整形)
// =======================================================

function syncNotionToSheet() {
  const token = _prop(NOTION_CONF.PROP.TOKEN);
  const dbId  = _prop(NOTION_CONF.PROP.DB_ID);
  if (!token || !dbId) {
    throw new Error("NOTION_TOKEN / NOTION_DB_ID をスクリプトプロパティに設定してください。");
  }

  const rows = fetchAllNotionRows_(token, dbId);
  if (rows.length === 0) {
    Logger.log("Notionから取得できるレコードがありません。");
    return;
  }

  const ss = SpreadsheetApp.getActive();
  const sh = ss.getSheetByName(NOTION_CONF.SHEET_NAME) || ss.insertSheet(NOTION_CONF.SHEET_NAME);
  sh.clearContents();

  const headers = NOTION_CONF.HEADERS;
  const values = [
    headers,
    ...rows.map(r => headers.map(h => r[h] ?? ""))
  ];

  sh.getRange(1, 1, values.length, headers.length).setValues(values);
  Logger.log(`Notion → シート へ ${rows.length}件 同期しました。`);
}

function fetchAllNotionRows_(token, dbId) {
  const url = `https://api.notion.com/v1/databases/${dbId}/query`;
  const all = [];
  let cursor = null;

  do {
    const payload = cursor ? { start_cursor: cursor } : {};
    const res = UrlFetchApp.fetch(url, {
      method: "post",
      contentType: "application/json; charset=utf-8",
      payload: JSON.stringify(payload),
      headers: {
        "Authorization": `Bearer ${token}`,
        "Notion-Version": NOTION_CONF.VERSION
      },
      muteHttpExceptions: true
    });

    if (res.getResponseCode() !== 200) {
      throw new Error("Notion API エラー: " + res.getResponseCode() + " / " + res.getContentText());
    }

    const json = JSON.parse(res.getContentText());
    (json.results || []).forEach(p => all.push(convertPage_(p)));
    cursor = json.has_more ? json.next_cursor : null;
  } while (cursor);

  return all;
}

function convertPage_(page) {
  const obj = {};
  obj["page_id"] = page.id;
  const props = page.properties || {};
  Object.keys(props).forEach(name => {
    obj[name] = parseProp_(props[name]);
  });
  return obj;
}

function parseProp_(prop) {
  if (!prop || !prop.type) return "";
  const t = prop.type;
  const v = prop[t];

  switch (t) {
    case "title":
    case "rich_text": return (v || []).map(r => r.plain_text || "").join("");
    case "select": return v ? v.name || "" : "";
    case "multi_select": return (v || []).map(s => s.name || "").join(", ");
    case "number": return v != null ? v : "";
    case "checkbox": return v ? "TRUE" : "FALSE";
    case "date": return v && v.start ? v.start : "";
    case "people": return (v || []).map(p => p.name || p.id || "").join(", ");
    case "relation": return (v || []).map(r => r.id || "").join(", ");
    case "files":
      if (!v || v.length === 0) return "";
      const f = v[0];
      return (f.file && f.file.url) || (f.external && f.external.url) || "";
    case "url": return v || "";
    case "email": return v || "";
    case "phone_number": return v || "";
    case "status": return v ? v.name || "" : "";
    case "rollup": return parseRollup_(v);
    default: return "";
  }
}

function parseRollup_(rollupVal) {
  if (!rollupVal || !rollupVal.type) return "";
  const t = rollupVal.type;

  if (t === "number") return rollupVal.number != null ? rollupVal.number : "";
  if (t === "date") return rollupVal.date && rollupVal.date.start ? rollupVal.date.start : "";
  
  if (t === "array") {
    const arr = rollupVal.array || [];
    const collected = [];

    function collectValues(node) {
      if (!node) return;
      if (Array.isArray(node)) { 
        node.forEach(collectValues); 
        return; 
      }
      if (typeof node === "object") {
        if (typeof node.plain_text === "string") collected.push(node.plain_text);
        if (typeof node.name === "string") collected.push(node.name);
        if (typeof node.email === "string") collected.push(node.email);
        if (typeof node.url === "string") collected.push(node.url);
        
        Object.keys(node).forEach(k => {
          if (k !== "type" && typeof node[k] === "object") {
             collectValues(node[k]);
          }
        });
      }
    }
    collectValues(arr);
    const uniq = Array.from(new Set(collected)).filter(s => s && s.trim() !== "");
    return uniq.join(", ");
  }
  return "";
}

function _prop(key) {
  return PropertiesService.getScriptProperties().getProperty(key) || "";
}

// =======================================================
// 2. キャストリスト同期用関数 (ID自動採番＆追加)
// =======================================================

function syncNewCastMembersWithIdAndFormulas() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const srcSheet = ss.getSheetByName('Notion_FromDB');
  const destSheet = ss.getSheetByName('キャストリスト');

  if (!srcSheet || !destSheet) {
    console.error('シートが見つかりません。');
    return;
  }

  const srcLastRow = srcSheet.getLastRow();
  if (srcLastRow < 2) {
    Logger.log('元データがありません。');
    return;
  }
  
  // Notionのデータ取得（列が増えたので範囲を少し広めに取得）
  const srcValues = srcSheet.getRange(2, 1, srcLastRow - 1, 25).getValues();

  const destLastRow = destSheet.getLastRow();
  let existingNames = new Set();
  let maxIdNum = 0; 

  if (destLastRow > 1) { 
    // 既存の名前リストを取得(B列=2列目)
    const currentNames = destSheet.getRange(2, 2, destLastRow - 1, 1).getValues();
    currentNames.forEach(row => existingNames.add(row[0]));

    // A列全体をチェックして、最大のID番号を探す
    const currentIds = destSheet.getRange(2, 1, destLastRow - 1, 1).getValues();
    currentIds.forEach(row => {
      const idText = row[0];
      if (typeof idText === 'string' && idText.startsWith('cast_')) {
        const num = parseInt(idText.replace('cast_', ''), 10);
        if (!isNaN(num) && num > maxIdNum) {
          maxIdNum = num;
        }
      }
    });
  }

  let newBasicData = [];    // A列(ID), B列(名前) 用
  let newFuriganaData = []; // O列(ふりがな) 用

  for (let i = 0; i < srcValues.length; i++) {
    const name = srcValues[i][1]; // 名前はB列 (Index 1)
    
    // HEADERSの並び順により「ふりがな」は最後(11番目)なので Index 10 (K列相当)
    const furigana = srcValues[i][10]; 

    if (name && !existingNames.has(name)) {
      maxIdNum++; 
      const newId = 'cast_' + ('00000' + maxIdNum).slice(-5);
      
      newBasicData.push([newId, name]);
      newFuriganaData.push([furigana]);
      
      existingNames.add(name); 
    }
  }

  if (newBasicData.length > 0) {
    const startRow = destLastRow + 1;
    const numRows = newBasicData.length;

    // 1. A列(ID)・B列(名前) 書き込み
    destSheet.getRange(startRow, 1, numRows, 2).setValues(newBasicData);
    
    // 2. O列(15列目) にふりがな書き込み
    destSheet.getRange(startRow, 15, numRows, 1).setValues(newFuriganaData);

    // 3. 数式コピー (R1C1形式)
    // 既存の数式列 (C, E, F, G, H, J, K)
    const formulaCols = [3, 5, 6, 7, 8, 10, 11];
    
    formulaCols.forEach(col => {
      const sourceCell = destSheet.getRange(2, col);
      const r1c1Formula = sourceCell.getFormulaR1C1();
      const val = sourceCell.getValue();
      const targetRange = destSheet.getRange(startRow, col, numRows, 1);

      if (r1c1Formula) {
        targetRange.setFormulaR1C1(r1c1Formula);
      } else {
        targetRange.setValue(val);
      }
    });

    const msg = `${numRows} 件追加しました。（最終ID: cast_${('00000' + maxIdNum).slice(-5)}）`;
    Logger.log(msg);
  } else {
    Logger.log('新しいデータはありませんでした。');
  }
}

// =======================================================
// 3. Notion削除済みメンバーのID書き換え処理
// =======================================================

function markDeletedCastsInColumnA() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const srcSheet = ss.getSheetByName(NOTION_CONF.SHEET_NAME); // Notion_FromDB
  const destSheet = ss.getSheetByName('キャストリスト');
  const MARK_TEXT = "削除ずみ"; // A列に書き込む文言

  if (!srcSheet || !destSheet) return;

  // 1. Notionに「今」存在する人の名前リストを作成
  const srcLastRow = srcSheet.getLastRow();
  const activeNames = new Set();
  if (srcLastRow >= 2) {
    // B列(2列目)が名前
    const data = srcSheet.getRange(2, 2, srcLastRow - 1, 1).getValues();
    data.forEach(r => {
      if(r[0]) activeNames.add(r[0]);
    });
  }

  // 2. キャストリストの名前を確認
  const destLastRow = destSheet.getLastRow();
  if (destLastRow < 2) return;

  // A列(ID)とB列(名前)を取得
  const rangeId   = destSheet.getRange(2, 1, destLastRow - 1, 1);
  const rangeName = destSheet.getRange(2, 2, destLastRow - 1, 1);
  
  const currentIds = rangeId.getValues();
  const currentNames = rangeName.getValues();
  
  let updateCount = 0;

  // 3. Notionにいない人のIDを書き換え
  const newIds = currentIds.map((row, i) => {
    const currentId = row[0];
    const name = currentNames[i][0];

    // IDが文字列で、かつ 'ext' から始まる場合はスキップ
    if (typeof currentId === 'string' && currentId.startsWith('ext')) {
      return [currentId];
    }

    // 名前があって、Notionにはいなくて、IDがまだ「削除ずみ」になっていない場合
    if (name && !activeNames.has(name) && currentId !== MARK_TEXT) {
      updateCount++;
      return [MARK_TEXT]; // IDを上書き
    }
    return [currentId]; // そのまま
  });

  // 変更があった場合のみ書き込み
  if (updateCount > 0) {
    rangeId.setValues(newIds);
    console.log(`${updateCount} 件のIDを『${MARK_TEXT}』に変更しました。`);
  } else {
    console.log("削除処理対象のメンバーはいませんでした。");
  }
}

// =======================================================
// 4. デバッグ・調査用
// =======================================================

function debugNotionContact() {
  const token = _prop(NOTION_CONF.PROP.TOKEN);
  const dbId  = _prop(NOTION_CONF.PROP.DB_ID);
  
  const url = `https://api.notion.com/v1/databases/${dbId}/query`;
  const res = UrlFetchApp.fetch(url, {
    method: "post",
    headers: {
      "Authorization": `Bearer ${token}`,
      "Notion-Version": NOTION_CONF.VERSION,
      "Content-Type": "application/json"
    },
    payload: JSON.stringify({ page_size: 1 }), // 1件だけ
    muteHttpExceptions: true
  });

  const json = JSON.parse(res.getContentText());
  if (!json.results || json.results.length === 0) {
    console.log("データが1件もありませんでした。");
    return;
  }

  const page = json.results[0];
  const contactProp = page.properties["連絡先"]; // Notion側のプロパティ名

  console.log("=== 【調査用データ】ここからコピーしてください ===");
  console.log(JSON.stringify(contactProp, null, 2)); 
  console.log("=== ここまでコピーしてください ===");
}

/**
 * キャストごとの撮影日一覧を「撮影スケ_キャスト」に横持ちで出力
 * 仕様：
 *  A列：キャスト名（既存）
 *  B列以降：そのキャストの全撮影日（昇順、重複排除、M/d表示）
 */
function buildCastShootCalendar() {
  const TZ = 'Asia/Tokyo';
  const DATE_FMT = 'M/d'; // 例: 10/9
  const SRC_SHEET = '撮影スケ_日付';
  const DST_SHEET = '撮影スケ_キャスト';

  const ss = SpreadsheetApp.getActive();
  const src = ss.getSheetByName(SRC_SHEET);
  const dst = ss.getSheetByName(DST_SHEET);
  if (!src || !dst) throw new Error('シート名を確認してください。');

  // ---- 入力取得（「撮影スケ_日付」）----
  const lastRow = src.getLastRow();
  if (lastRow < 2) return;

  // A〜L をまとめて取得（A:日付, B:チーム, C〜L:キャスト）
  const range = src.getRange(2, 1, lastRow - 1, 12);
  const values = range.getValues();

  // 仕切り文字：, 、 ， ・ / を考慮（スペースはTRIMで圧縮）
  const SPLIT_RE = /[,\u3001\uFF0C\u30FB\/]/;
  const TRIM_RE = /[\s\u3000]+/g;

  // name -> Set<dateString> のマップ
  const nameToDates = new Map();

  for (const row of values) {
    const dateCell = row[0]; // A列
    if (!dateCell) continue;

    const d = (dateCell instanceof Date) ? dateCell : new Date(dateCell);
    if (isNaN(d)) continue;
    const dStr = Utilities.formatDate(d, TZ, DATE_FMT);

    // C〜L（インデックス2〜11）
    for (let c = 2; c <= 11; c++) {
      const cell = row[c];
      if (!cell) continue;

      const raw = String(cell).split(SPLIT_RE)
        .map(s => String(s).replace(TRIM_RE, ' ').trim())
        .filter(s => s.length > 0);

      for (const name of raw) {
        if (!nameToDates.has(name)) nameToDates.set(name, new Set());
        nameToDates.get(name).add(dStr);
      }
    }
  }

  // ---- 出力（「撮影スケ_キャスト」）----
  const dstLastRow = dst.getLastRow();
  if (dstLastRow < 2) return;

  // 既存のB列以降を一旦クリア
  const maxCols = Math.max(26, dst.getLastColumn());
  if (maxCols >= 2) {
    dst.getRange(2, 2, dstLastRow - 1, maxCols - 1).clearContent();
  }

  // キャスト名一覧（A列）
  const names = dst.getRange(2, 1, dstLastRow - 1, 1).getValues().map(r => (r[0] || '').toString().trim());

  const out = [];
  let maxWidth = 0;

  for (const cast of names) {
    if (!cast) { out.push([]); continue; }
    const dates = nameToDates.get(cast);
    if (!dates || dates.size === 0) { out.push([]); continue; }

    // "M/d" の昇順
    const sorted = Array.from(dates).sort((a, b) => {
      const [am, ad] = a.split('/').map(n => parseInt(n, 10));
      const [bm, bd] = b.split('/').map(n => parseInt(n, 10));
      return am === bm ? ad - bd : am - bm;
    });
    out.push(sorted);
    if (sorted.length > maxWidth) maxWidth = sorted.length;
  }

  if (maxWidth > 0 && names.length > 0) {
    dst.getRange(2, 2, names.length, maxWidth).setValues(
      out.map(row => {
        const r = row.slice();
        while (r.length < maxWidth) r.push('');
        return r;
      })
    );
  }

  // 見やすさ
  dst.autoResizeColumns(1, Math.max(2 + maxWidth, 2));
  dst.getRange(1, 2).setValue('撮影日一覧');
}

/**
 * 補助：区切りに「・」「/」など別パターンを追加したい場合は SPLIT_RE を編集。
 * 年跨ぎなどで厳密な日付ソートが必要なら、「元Dateも保持→最後にDateでsort→書式化」で対応。
 */

 /**
 * 新香盤 - Notion撮影DB → スプレッドシート → Firestore 完全同期
 * 
 * 機能:
 *   1. Notion撮影DBから撮影データ取得（スタッフ全員含む）
 *   2. スプレッドシート「新香盤撮影リスト」に書き込み（追加/更新/削除）
 *   3. Firestore「shootings」コレクションに同期（追加/更新/削除）
 * 
 * Notionで削除 → スプレッドシートから削除 → Firestoreからも削除
 */

/***** 設定 *****/
const SHOOT_DB_ID          = 'c9ee418a40f64f4ca0cc542b2470024b';
const SHEET_SHOOT_SUMMARY  = '新香盤撮影リスト';

/***** Notion共通 *****/
function _getNotionHeaders_(){
  const props = PropertiesService.getScriptProperties();
  const key = props.getProperty('NOTION_TOKEN');
  const ver = props.getProperty('NOTION_VERSION') || '2022-06-28';
  if (!key) throw new Error('NOTION_TOKEN が未設定です');
  return {
    'Authorization': `Bearer ${key}`,
    'Content-Type': 'application/json',
    'Notion-Version': ver
  };
}

function _notionQueryAll_(databaseId, body = {}){
  const url = `https://api.notion.com/v1/databases/${databaseId}/query`;
  const headers = _getNotionHeaders_();
  const pages = [];
  const payload = Object.assign({ page_size: 100 }, body);
  let cursor;

  do {
    if (cursor) payload.start_cursor = cursor;
    const res = UrlFetchApp.fetch(url, {
      method: 'post',
      headers,
      payload: JSON.stringify(payload),
      muteHttpExceptions: true
    });
    const json = JSON.parse(res.getContentText());
    if (json.object === 'error') throw new Error(JSON.stringify(json));
    if (json.results) pages.push(...json.results);
    cursor = json.has_more ? json.next_cursor : null;
    if (json.has_more) Utilities.sleep(200);
  } while (cursor);

  return pages;
}

/***** Extractors *****/
const _t      = p => p?.title?.map(t => t.plain_text).join('') || '';
const _rt     = p => p?.rich_text?.map(t => t.plain_text).join('') || '';
const _msArr  = p => p?.multi_select?.map(x => x.name) || [];
const _sel    = p => p?.select?.name || '';
const _date   = p => p?.date?.start || '';
const _peopleArr = p => p?.people?.map(u => u.name || u.id) || [];

/***** 期間計算 *****/
function _dateWindow_(){
  const tz = Session.getScriptTimeZone();
  const now = new Date();
  const start = new Date(Utilities.formatDate(now, tz, 'yyyy-MM-dd') + 'T00:00:00');
  const end = new Date(start);
  end.setMonth(end.getMonth() + 1);
  const fmt = d => Utilities.formatDate(d, tz, 'yyyy-MM-dd');
  return { startISO: fmt(start), endISO: fmt(end) };
}

/***** ヘッダ（スタッフ列追加） *****/
const SHOOT_HEADERS_BASE = [
  "NotionPageID", // A列
  "タイトル",      // B列
  "撮影日",        // C列
  "撮影チーム",    // D列
  "CD",           // E列
  "FD",           // F列
  "P",            // G列
  "制作チーフ",    // H列
  "SIX",          // I列
  "カメラ",        // J列
  "衣装",          // K列
  "ヘアメイク"     // L列
];

/***** Firestore ヘルパー（sync_to_firestore.gs の関数を利用） *****/

/**
 * Firestoreからshootingsコレクションの指定ドキュメントを削除
 */
function deleteFirestoreShooting_(docId) {
  try {
    var token = getFirestoreToken_();
    var sanitized = String(docId).replace(/[\/\.]/g, '_').replace(/^__/, 'xx').trim();
    var url = FS_API_BASE + '/shootings/' + sanitized;
    
    var res = UrlFetchApp.fetch(url, {
      method: 'delete',
      headers: { 'Authorization': 'Bearer ' + token },
      muteHttpExceptions: true
    });
    
    if (res.getResponseCode() === 200 || res.getResponseCode() === 404) {
      console.log('Firestore shooting 削除: ' + docId);
      return true;
    } else {
      console.error('Firestore削除エラー:', res.getContentText());
      return false;
    }
  } catch (e) {
    console.error('Firestore削除エラー:', e);
    return false;
  }
}

/**
 * Firestoreにshootings一括書き込み
 */
function writeShootingsToFirestore_(pageDataList) {
  if (pageDataList.length === 0) return;
  
  var documents = pageDataList.map(function(item) {
    var sanitized = String(item.pageId).replace(/[\/\.]/g, '_').replace(/^__/, 'xx').trim();
    
    // 全スタッフ名を集約
    var allStaff = [];
    ['cd', 'fd', 'producer', 'chiefProducer', 'six', 'camera', 'costume', 'hairMakeup'].forEach(function(key) {
      var val = item[key] || '';
      if (val) {
        val.split(/[,、，]/).forEach(function(s) {
          var name = s.trim();
          if (name && allStaff.indexOf(name) === -1) allStaff.push(name);
        });
      }
    });
    
    return {
      id: sanitized,
      data: {
        title: item.title || '',
        shootDate: item.shootDate || '',
        team: item.team || '',
        cd: item.cd || '',
        fd: item.fd || '',
        producer: item.producer || '',
        chiefProducer: item.chiefProducer || '',
        six: item.six || '',
        camera: item.camera || '',
        costume: item.costume || '',
        hairMakeup: item.hairMakeup || '',
        allStaff: allStaff,
        notionPageId: item.pageId,
        notionUrl: 'https://www.notion.so/' + String(item.pageId).replace(/-/g, ''),
        updatedAt: new Date()
      }
    };
  });
  
  firestoreBatchWrite_(documents, 'shootings');
  console.log('Firestore shootings 書き込み: ' + documents.length + '件');
}

/***** 本体 *****/
function syncShootScheduleFromNotion(){
  console.log('=== 新香盤撮影リスト 同期開始 ===');
  
  // 1. 期間設定
  const { startISO, endISO } = _dateWindow_();
  
  // 2. Notion検索クエリ
  const body = {
    filter: {
      and: [
        { property: "撮影日", date: { on_or_after: startISO } },
        { property: "撮影日", date: { on_or_before: endISO } }
      ]
    },
    sorts: [{ property: "撮影日", direction: "ascending" }]
  };

  const pages = _notionQueryAll_(SHOOT_DB_ID, body);
  console.log('Notion取得: ' + pages.length + '件');

  // 3. シート取得・ヘッダ設定
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName(SHEET_SHOOT_SUMMARY);
  if (!sh) sh = ss.insertSheet(SHEET_SHOOT_SUMMARY);

  const needCols = SHOOT_HEADERS_BASE.length; // 12列

  // ヘッダ初期化
  if (sh.getLastRow() === 0) {
    sh.getRange(1, 1, 1, needCols).setValues([SHOOT_HEADERS_BASE]);
  } else {
    const lastCol = sh.getLastColumn();
    if (lastCol < needCols) sh.insertColumnsAfter(lastCol, needCols - lastCol);
    // ヘッダ更新
    sh.getRange(1, 1, 1, needCols).setValues([SHOOT_HEADERS_BASE]);
  }

  // =======================================================
  // 削除フェーズ: Notionにない行を削除 + Firestoreからも削除
  // =======================================================
  const validIds = new Set(pages.map(p => p.id));
  let currentLastRow = sh.getLastRow();
  const deletedIds = [];

  if (currentLastRow > 1) {
    const currentIds = sh.getRange(2, 1, currentLastRow - 1, 1).getValues().flat();
    
    for (let i = currentIds.length - 1; i >= 0; i--) {
      const id = currentIds[i];
      if (id && !validIds.has(id)) {
        sh.deleteRow(i + 2);
        deletedIds.push(id);
      }
    }
  }
  
  // Firestoreからも削除
  if (deletedIds.length > 0) {
    console.log('削除対象: ' + deletedIds.length + '件');
    deletedIds.forEach(function(id) {
      deleteFirestoreShooting_(id);
    });
  }

  // =======================================================
  // 更新・追加フェーズ
  // =======================================================
  const lastRow = sh.getLastRow();
  let existingValues = [];
  let rangeToUpdate = null;
  const idToIndexMap = new Map();

  if (lastRow > 1) {
    rangeToUpdate = sh.getRange(2, 1, lastRow - 1, needCols);
    existingValues = rangeToUpdate.getValues();
    
    existingValues.forEach((row, i) => {
      const id = row[0]; 
      if(id) idToIndexMap.set(id, i);
    });
  }

  const rowsToAppend = [];
  let updateCount = 0;
  const firestoreData = []; // Firestore書き込み用

  pages.forEach(page => {
    const p = page.properties;
    const shootDate = _date(p["撮影日"]);
    if (!shootDate) return;

    // --- データ抽出（スタッフ全員） ---
    const title = _t(p["仮台本名"]) || "";
    const cd = _msArr(p["CD"]).join(", ") || _peopleArr(p["CD"]).join(", ");
    const fd = _msArr(p["FD/SD"]).join(", ") || _peopleArr(p["FD/SD"]).join(", ");
    const statusP = _msArr(p["P"]).join(", ") || _peopleArr(p["P"]).join(", ");
    const team = _sel(p["撮影チーム"]);
    const chiefProducer = _msArr(p["制作チーフ"]).join(", ") || _peopleArr(p["制作チーフ"]).join(", ");
    const six = _msArr(p["SIX"]).join(", ") || _peopleArr(p["SIX"]).join(", ");
    const camera = _msArr(p["カメラ"]).join(", ") || _peopleArr(p["カメラ"]).join(", ");
    const costume = _msArr(p["衣装"]).join(", ") || _peopleArr(p["衣装"]).join(", ");
    const hairMakeup = _msArr(p["ヘアメイク"]).join(", ") || _peopleArr(p["ヘアメイク"]).join(", ");

    const rowData = [
      page.id,    
      title,      
      shootDate,  
      team,       
      cd,         
      fd,         
      statusP,    
      chiefProducer,
      six,        
      camera,     
      costume,    
      hairMakeup  
    ];

    // Firestore用データも蓄積
    firestoreData.push({
      pageId: page.id,
      title: title,
      shootDate: shootDate,
      team: team,
      cd: cd,
      fd: fd,
      producer: statusP,
      chiefProducer: chiefProducer,
      six: six,
      camera: camera,
      costume: costume,
      hairMakeup: hairMakeup
    });

    if (idToIndexMap.has(page.id)) {
      const index = idToIndexMap.get(page.id);
      existingValues[index] = rowData; 
      updateCount++;
    } else {
      rowsToAppend.push(rowData);
    }
  });

  // シートへの反映
  if (updateCount > 0 && rangeToUpdate) {
    rangeToUpdate.setValues(existingValues);
  }
  if (rowsToAppend.length > 0) {
    const startRow = (lastRow > 1 ? lastRow : 1) + 1;
    sh.getRange(startRow, 1, rowsToAppend.length, needCols)
      .setValues(rowsToAppend);
  }

  // Firestoreへの書き込み
  try {
    writeShootingsToFirestore_(firestoreData);
  } catch (e) {
    console.error('Firestore書き込みエラー:', e);
  }

  console.log(`同期完了: 更新 ${updateCount}件 / 新規 ${rowsToAppend.length}件 / 削除 ${deletedIds.length}件`);
}
/**
 * スプレッドシート → Firestore 同期スクリプト
 * 
 * 対象シート:
 *   1. キャストリスト + Notion_FromDB + 内部キャストDB → casts
 *   2. 新香盤撮影リスト → shootings
 *   3. 香盤DB → shootingDetails
 *   4. 外部オーダー連携メール → config/externalEmails
 *   5. オフショットDrive → offshotDrive
 * 
 * セットアップ:
 *   1. setupFirestoreSync() を実行 → サービスアカウントキーをプロパティに保存
 *   2. syncAllToFirestore() を手動実行 or トリガー設定
 */

// =============================================
// 設定
// =============================================
const FS_PROJECT_ID = 'gokko-casty';
const FS_DOC_BASE = 'projects/' + FS_PROJECT_ID + '/databases/(default)/documents';
const FS_API_BASE = 'https://firestore.googleapis.com/v1/' + FS_DOC_BASE;

// =============================================
// Firestore 認証 (サービスアカウント JWT)
// =============================================
var _cachedFsToken = null;
var _fsTokenExpiry = 0;

function getFirestoreToken_() {
  if (_cachedFsToken && Date.now() < _fsTokenExpiry) return _cachedFsToken;
  
  var saKey = PropertiesService.getScriptProperties().getProperty('FIREBASE_SA_KEY');
  if (!saKey) throw new Error('FIREBASE_SA_KEY が未設定。setupFirestoreSync() を実行してください');
  
  var sa = JSON.parse(saKey);
  var now = Math.floor(Date.now() / 1000);
  
  var header = Utilities.base64EncodeWebSafe(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  var claimSet = Utilities.base64EncodeWebSafe(JSON.stringify({
    iss: sa.client_email,
    scope: 'https://www.googleapis.com/auth/datastore',
    aud: 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: now + 3600
  }));
  
  var signatureInput = header + '.' + claimSet;
  var signatureBytes = Utilities.computeRsaSha256Signature(signatureInput, sa.private_key);
  var signature = Utilities.base64EncodeWebSafe(signatureBytes);
  var jwt = signatureInput + '.' + signature;
  
  var res = UrlFetchApp.fetch('https://oauth2.googleapis.com/token', {
    method: 'post',
    payload: {
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: jwt
    },
    muteHttpExceptions: true
  });
  
  if (res.getResponseCode() !== 200) {
    throw new Error('Firestore認証失敗: ' + res.getContentText());
  }
  
  _cachedFsToken = JSON.parse(res.getContentText()).access_token;
  _fsTokenExpiry = Date.now() + 3500 * 1000;
  return _cachedFsToken;
}

// =============================================
// Firestore REST API ヘルパー
// =============================================

function toFsValue_(v) {
  if (v === null || v === undefined || v === '') return { nullValue: null };
  if (typeof v === 'string') return { stringValue: v };
  if (typeof v === 'number') {
    return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
  }
  if (typeof v === 'boolean') return { booleanValue: v };
  if (v instanceof Date) return { timestampValue: v.toISOString() };
  if (Array.isArray(v)) {
    if (v.length === 0) return { arrayValue: {} };
    return { arrayValue: { values: v.map(toFsValue_) } };
  }
  if (typeof v === 'object') {
    var fields = {};
    for (var k in v) {
      if (v.hasOwnProperty(k)) fields[k] = toFsValue_(v[k]);
    }
    return { mapValue: { fields: fields } };
  }
  return { stringValue: String(v) };
}

function toFsFields_(data) {
  var fields = {};
  for (var key in data) {
    if (data.hasOwnProperty(key)) {
      fields[key] = toFsValue_(data[key]);
    }
  }
  return fields;
}

/**
 * バッチ書き込み (最大500件/リクエスト)
 * @param {Array<{id: string, data: Object}>} documents
 * @param {string} collectionPath
 */
function firestoreBatchWrite_(documents, collectionPath) {
  var token = getFirestoreToken_();
  var batchUrl = FS_API_BASE + ':batchWrite';
  
  for (var i = 0; i < documents.length; i += 500) {
    var chunk = documents.slice(i, i + 500);
    var writes = chunk.map(function(doc) {
      return {
        update: {
          name: FS_DOC_BASE + '/' + collectionPath + '/' + doc.id,
          fields: toFsFields_(doc.data)
        }
      };
    });
    
    var res = UrlFetchApp.fetch(batchUrl, {
      method: 'post',
      headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' },
      payload: JSON.stringify({ writes: writes }),
      muteHttpExceptions: true
    });
    
    if (res.getResponseCode() !== 200) {
      console.error('Batch write error (' + collectionPath + ' chunk ' + i + '):', res.getContentText());
    } else {
      console.log('Batch write OK: ' + collectionPath + ' (' + chunk.length + '件)');
    }
    
    // API制限対策
    if (i + 500 < documents.length) Utilities.sleep(200);
  }
}

/**
 * 単一ドキュメント書き込み
 */
function firestoreSetDoc_(collectionPath, docId, data) {
  var token = getFirestoreToken_();
  var url = FS_API_BASE + '/' + collectionPath + '/' + docId;
  
  var res = UrlFetchApp.fetch(url, {
    method: 'patch',
    headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' },
    payload: JSON.stringify({ fields: toFsFields_(data) }),
    muteHttpExceptions: true
  });
  
  if (res.getResponseCode() !== 200) {
    console.error('Set error (' + collectionPath + '/' + docId + '):', res.getContentText());
    return false;
  }
  return true;
}

// =============================================
// ドキュメントID正規化
// =============================================
function sanitizeDocId_(id) {
  if (!id) return null;
  // Firestoreのドキュメントは '/', '.', '__' を含めない
  return String(id).replace(/[\/\.]/g, '_').replace(/^__/, 'xx').trim();
}

// =============================================
// 1. casts コレクション同期
//    ソース: Notion_FromDB + キャストリスト + 内部キャストDB
// =============================================
function syncCastsToFirestore_() {
  console.log('=== casts 同期開始 ===');
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  
  // --- Notion_FromDB 読み取り ---
  var notionSheet = ss.getSheetByName('Notion_FromDB');
  if (!notionSheet || notionSheet.getLastRow() < 2) {
    console.warn('Notion_FromDB が見つからないかデータなし');
    return 0;
  }
  var notionData = notionSheet.getRange(2, 1, notionSheet.getLastRow() - 1, 12).getValues();
  // Notion_FromDB列: A=page_id, B=名前, C=性別, D=事務所, E=出演回数,
  //   F=アイコンURL, G=連絡先, H=X, I=Instagram, J=TikTok, K=ふりがな, L=生年月日
  
  var notionMap = {};
  notionData.forEach(function(row) {
    var name = String(row[1] || '').trim();
    if (name) {
      notionMap[name] = {
        notionPageId: String(row[0] || ''),
        gender: String(row[2] || ''),
        agency: String(row[3] || ''),
        appearanceCount: Number(row[4]) || 0,
        imageUrl: String(row[5] || ''),
        email: String(row[6] || ''),
        snsX: String(row[7] || ''),
        snsInstagram: String(row[8] || ''),
        snsTikTok: String(row[9] || ''),
        furigana: String(row[10] || ''),
        dateOfBirth: String(row[11] || '')
      };
    }
  });
  
  // --- 内部キャストDB 読み取り ---
  var internalSheet = ss.getSheetByName('内部キャストDB');
  var internalMap = {}; // displayname or 本名 → {email, userid}
  
  if (internalSheet && internalSheet.getLastRow() >= 2) {
    var internalData = internalSheet.getRange(2, 1, internalSheet.getLastRow() - 1, 5).getValues();
    // A=本名, B=fullname, C=displayname, D=email, E=userid
    internalData.forEach(function(row) {
      var realName = String(row[0] || '').trim();
      var displayname = String(row[2] || '').trim();
      var info = {
        realName: realName,
        fullname: String(row[1] || '').trim(),
        displayname: displayname,
        email: String(row[3] || '').trim(),
        slackMentionId: String(row[4] || '').trim()
      };
      // displaynameとrealNameの両方で引けるようにする
      if (displayname) internalMap[displayname] = info;
      if (realName && realName !== displayname) internalMap[realName] = info;
    });
  }
  
  // --- キャストリスト 読み取り ---
  var castListSheet = ss.getSheetByName('キャストリスト');
  if (!castListSheet || castListSheet.getLastRow() < 2) {
    console.warn('キャストリスト が見つからないかデータなし');
    return 0;
  }
  var castListData = castListSheet.getRange(2, 1, castListSheet.getLastRow() - 1, 15).getValues();
  // A(1)=cast_ID, B(2)=名前, ... O(15)=ふりがな
  
  var documents = [];
  
  castListData.forEach(function(row) {
    var castId = String(row[0] || '').trim();
    var name = String(row[1] || '').trim();
    
    // cast_XXXXX フォーマットのみ同期（削除済み・ext_ はスキップ）
    if (!castId || !name || !castId.startsWith('cast_')) return;
    
    var docId = sanitizeDocId_(castId);
    if (!docId) return;
    
    // Notion情報をマージ
    var notion = notionMap[name] || {};
    
    // 内部キャスト情報をマージ
    var internal = internalMap[name] || null;
    var isInternal = !!internal;
    
    var castData = {
      name: name,
      furigana: notion.furigana || String(row[14] || '').trim(),
      gender: notion.gender || '',
      castType: isInternal ? '内部' : '外部',
      agency: notion.agency || '',
      imageUrl: notion.imageUrl || '',
      email: internal ? internal.email : (notion.email || ''),
      slackMentionId: internal ? internal.slackMentionId : '',
      // appearanceCount は上書きしない（Vue側で castings から作品単位で計算）
      snsX: notion.snsX || '',
      snsInstagram: notion.snsInstagram || '',
      snsTikTok: notion.snsTikTok || '',
      dateOfBirth: notion.dateOfBirth || '',
      notionPageId: notion.notionPageId || '',
      updatedAt: new Date()
    };
    
    documents.push({ id: docId, data: castData });
  });
  
  // 重複排除（同じdocIdが複数ある場合は最後のものを採用）
  var uniqueMap = {};
  documents.forEach(function(doc) {
    uniqueMap[doc.id] = doc;
  });
  var uniqueDocs = Object.keys(uniqueMap).map(function(key) { return uniqueMap[key]; });
  
  if (uniqueDocs.length > 0) {
    firestoreBatchWrite_(uniqueDocs, 'casts');
  }
  
  console.log('casts 同期完了: ' + uniqueDocs.length + '件' + (documents.length !== uniqueDocs.length ? ' (重複' + (documents.length - uniqueDocs.length) + '件を除外)' : ''));
  return uniqueDocs.length;
}

// =============================================
// 2. shootings コレクション同期
//    ソース: 新香盤撮影リスト
// =============================================
function syncShootingsToFirestore_() {
  console.log('=== shootings 同期開始 ===');
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName('新香盤撮影リスト');
  
  if (!sheet || sheet.getLastRow() < 2) {
    console.warn('新香盤撮影リスト が見つからないかデータなし');
    return 0;
  }
  
  // A〜L列（12列: PageID, タイトル, 撮影日, チーム, CD, FD, P, 制作チーフ, SIX, カメラ, 衣装, ヘアメイク）
  var lastCol = Math.min(sheet.getLastColumn(), 12);
  var data = sheet.getRange(2, 1, sheet.getLastRow() - 1, lastCol).getValues();
  
  var documents = [];
  
  data.forEach(function(row) {
    var pageId = String(row[0] || '').trim();
    if (!pageId) return;
    
    var docId = sanitizeDocId_(pageId);
    if (!docId) return;
    
    var shootDate = row[2];
    if (shootDate instanceof Date) {
      shootDate = Utilities.formatDate(shootDate, Session.getScriptTimeZone(), 'yyyy-MM-dd');
    }
    
    // すべてのスタッフ名を集めて allStaff 配列を作成
    var allStaff = [];
    for (var c = 4; c < lastCol; c++) {
      var staffStr = String(row[c] || '').trim();
      if (staffStr) {
        staffStr.split(/[,、，]/).forEach(function(s) {
          var name = s.trim();
          if (name && allStaff.indexOf(name) === -1) allStaff.push(name);
        });
      }
    }
    
    var shootingData = {
      title: String(row[1] || ''),
      shootDate: String(shootDate || ''),
      team: String(row[3] || ''),
      cd: String(row[4] || ''),
      fd: String(row[5] || ''),
      producer: String(row[6] || ''),
      chiefProducer: lastCol > 7 ? String(row[7] || '') : '',
      six: lastCol > 8 ? String(row[8] || '') : '',
      camera: lastCol > 9 ? String(row[9] || '') : '',
      costume: lastCol > 10 ? String(row[10] || '') : '',
      hairMakeup: lastCol > 11 ? String(row[11] || '') : '',
      allStaff: allStaff,
      notionPageId: pageId,
      notionUrl: 'https://www.notion.so/' + pageId.replace(/-/g, ''),
      updatedAt: new Date()
    };
    
    documents.push({ id: docId, data: shootingData });
  });
  
  if (documents.length > 0) {
    firestoreBatchWrite_(documents, 'shootings');
  }
  
  console.log('shootings 同期完了: ' + documents.length + '件');
  return documents.length;
}

// =============================================
// 3. shootingDetails コレクション同期
//    ソース: 香盤DB
// =============================================
function syncShootingDetailsToFirestore_() {
  console.log('=== shootingDetails 同期開始 ===');
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName('香盤DB');
  
  if (!sheet || sheet.getLastRow() < 2) {
    console.warn('香盤DB が見つからないかデータなし');
    return 0;
  }
  
  var data = sheet.getRange(2, 1, sheet.getLastRow() - 1, 20).getValues();
  // E(5)=キャスト名, F(6)=IN, G(7)=OUT, H(8)=場所, I(9)=住所, J(10)=Notion URL
  
  var documents = [];
  var idCounter = 0;
  
  data.forEach(function(row, idx) {
    var castName = String(row[4] || '').trim();
    if (!castName) return;
    
    var notionUrl = String(row[9] || '');
    var notionId = '';
    if (notionUrl) {
      var match = notionUrl.match(/[0-9a-fA-F]{32}/);
      notionId = match ? match[0].toLowerCase() : '';
    }
    
    var inTime = row[5];
    var outTime = row[6];
    // 時刻をフォーマット
    if (inTime instanceof Date) {
      inTime = Utilities.formatDate(inTime, Session.getScriptTimeZone(), 'HH:mm');
    }
    if (outTime instanceof Date) {
      outTime = Utilities.formatDate(outTime, Session.getScriptTimeZone(), 'HH:mm');
    }
    
    idCounter++;
    var docId = 'sd_' + String('00000' + idCounter).slice(-5);
    
    var detailData = {
      castName: castName,
      inTime: String(inTime || ''),
      outTime: String(outTime || ''),
      location: String(row[7] || ''),
      address: String(row[8] || ''),
      notionPageId: notionId,
      rowIndex: idx + 2,
      updatedAt: new Date()
    };
    
    documents.push({ id: docId, data: detailData });
  });
  
  if (documents.length > 0) {
    firestoreBatchWrite_(documents, 'shootingDetails');
  }
  
  console.log('shootingDetails 同期完了: ' + documents.length + '件');
  return documents.length;
}

// =============================================
// 4. 外部オーダー連携メール → config/externalEmails
// =============================================
function syncExternalEmailsToFirestore_() {
  console.log('=== externalEmails 同期開始 ===');
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName('外部オーダー連携メール');
  
  if (!sheet || sheet.getLastRow() < 2) {
    console.warn('外部オーダー連携メール が見つからないかデータなし');
    return 0;
  }
  
  var data = sheet.getRange(2, 1, sheet.getLastRow() - 1, 1).getValues();
  var emails = [];
  
  data.forEach(function(row) {
    var email = String(row[0] || '').trim();
    if (email && email.indexOf('@') > 0) {
      emails.push(email);
    }
  });
  
  // 単一ドキュメントとして保存
  firestoreSetDoc_('config', 'externalEmails', {
    emails: emails,
    count: emails.length,
    updatedAt: new Date()
  });
  
  console.log('externalEmails 同期完了: ' + emails.length + '件');
  return emails.length;
}

// =============================================
// 5. オフショットDrive → offshotDrive
// =============================================
function syncOffshotDriveToFirestore_() {
  console.log('=== offshotDrive 同期開始 ===');
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName('オフショットDrive');
  
  if (!sheet || sheet.getLastRow() < 2) {
    console.warn('オフショットDrive が見つからないかデータなし');
    return 0;
  }
  
  var data = sheet.getRange(2, 1, sheet.getLastRow() - 1, 2).getValues();
  // A=NotionID, B=DriveLink
  
  var documents = [];
  
  data.forEach(function(row) {
    var notionId = String(row[0] || '').trim();
    var driveLink = String(row[1] || '').trim();
    if (!notionId || !driveLink) return;
    
    var docId = sanitizeDocId_(notionId);
    if (!docId) return;
    
    documents.push({
      id: docId,
      data: {
        notionPageId: notionId,
        driveLink: driveLink,
        updatedAt: new Date()
      }
    });
  });
  
  if (documents.length > 0) {
    firestoreBatchWrite_(documents, 'offshotDrive');
  }
  
  console.log('offshotDrive 同期完了: ' + documents.length + '件');
  return documents.length;
}

// =============================================
// メイン関数
// =============================================

/**
 * すべてのシートをFirestoreに同期
 * mainDailySync() の後に実行するか、トリガーで設定
 */
function syncAllToFirestore() {
  console.log('====================================');
  console.log('Firestore同期 開始: ' + new Date().toLocaleString('ja-JP'));
  console.log('====================================');
  
  var results = {};
  
  try {
    results.casts = syncCastsToFirestore_();
  } catch (e) {
    console.error('casts同期エラー:', e);
    results.casts = 'ERROR: ' + e.message;
  }
  
  // ext_ → cast_ のID付替え（casts同期後に実行）
  try {
    mergeExtCastIds_();
  } catch (e) {
    console.error('ext_マージエラー:', e);
  }
  
  try {
    results.shootings = syncShootingsToFirestore_();
  } catch (e) {
    console.error('shootings同期エラー:', e);
    results.shootings = 'ERROR: ' + e.message;
  }
  
  try {
    results.shootingDetails = syncShootingDetailsToFirestore_();
  } catch (e) {
    console.error('shootingDetails同期エラー:', e);
    results.shootingDetails = 'ERROR: ' + e.message;
  }
  
  try {
    results.externalEmails = syncExternalEmailsToFirestore_();
  } catch (e) {
    console.error('externalEmails同期エラー:', e);
    results.externalEmails = 'ERROR: ' + e.message;
  }
  
  try {
    results.offshotDrive = syncOffshotDriveToFirestore_();
  } catch (e) {
    console.error('offshotDrive同期エラー:', e);
    results.offshotDrive = 'ERROR: ' + e.message;
  }
  
  console.log('====================================');
  console.log('結果:', JSON.stringify(results));
  console.log('====================================');
  
  return results;
}

// =============================================
// ext_ → cast_ ID付替え処理
// =============================================

/**
 * ext_ キャストを cast_XXXXX に統合する
 * 同じ名前の ext_ と cast_ がFirestoreに存在する場合:
 *   1. castings コレクションの castId を ext_ → cast_ に付替え
 *   2. shootingContacts コレクションの castId も付替え
 *   3. ext_ ドキュメントを削除
 */
function mergeExtCastIds_() {
  console.log('=== ext_ マージ処理 開始 ===');
  var token = getFirestoreToken_();
  
  // 1. Firestore から全 casts を取得
  var allDocs = [];
  var pageToken = null;
  
  do {
    var castsUrl = FS_API_BASE + '/casts?pageSize=300';
    if (pageToken) castsUrl += '&pageToken=' + pageToken;
    
    var res = UrlFetchApp.fetch(castsUrl, {
      headers: { 'Authorization': 'Bearer ' + token },
      muteHttpExceptions: true
    });
    
    if (res.getResponseCode() !== 200) {
      console.error('casts取得失敗:', res.getContentText());
      return;
    }
    
    var json = JSON.parse(res.getContentText());
    if (json.documents) allDocs = allDocs.concat(json.documents);
    pageToken = json.nextPageToken || null;
  } while (pageToken);
  
  // ext_ ドキュメントと cast_ ドキュメントの名前マップを構築
  var extDocs = {};   // name → { docId, fullName }
  var castDocs = {};  // name → docId
  
  allDocs.forEach(function(doc) {
    var nameField = doc.fields && doc.fields.name;
    var name = nameField ? (nameField.stringValue || '') : '';
    var docPath = doc.name.split('/').pop();
    
    if (docPath.indexOf('ext_') === 0 || docPath.length > 20) {
      // ext_ プレフィックス or Firestore自動生成ID（addDoc由来）
      if (name && !castDocs[name]) {
        extDocs[name] = { docId: docPath, fullName: doc.name };
      }
    } else if (docPath.indexOf('cast_') === 0) {
      castDocs[name] = docPath;
    }
  });
  
  // 2. 名前が一致する ext_ → cast_ のペアを見つけて付替え
  var mergeCount = 0;
  var extNames = Object.keys(extDocs);
  
  for (var i = 0; i < extNames.length; i++) {
    var name = extNames[i];
    var newCastId = castDocs[name];
    if (!newCastId) continue; // cast_ 側がまだ無い → スキップ
    
    var oldExtId = extDocs[name].docId;
    console.log('マージ対象: ' + oldExtId + ' → ' + newCastId + ' (' + name + ')');
    
    // 2a. castings コレクションの castId を付替え
    replaceFieldInCollection_('castings', 'castId', oldExtId, newCastId);
    
    // 2b. shootingContacts コレクションの castId を付替え
    replaceFieldInCollection_('shootingContacts', 'castId', oldExtId, newCastId);
    
    // 2c. ext_ ドキュメントを削除
    var delUrl = FS_API_BASE + '/casts/' + oldExtId;
    var delRes = UrlFetchApp.fetch(delUrl, {
      method: 'delete',
      headers: { 'Authorization': 'Bearer ' + token },
      muteHttpExceptions: true
    });
    
    if (delRes.getResponseCode() === 200 || delRes.getResponseCode() === 404) {
      console.log('ext_ ドキュメント削除: ' + oldExtId);
    }
    
    mergeCount++;
    Utilities.sleep(200); // API制限対策
  }
  
  console.log('=== ext_ マージ完了: ' + mergeCount + '件 ===');
}

/**
 * Firestoreコレクション内の特定フィールドを検索・置換
 * @param {string} collectionName コレクション名
 * @param {string} field フィールド名
 * @param {string} oldValue 旧値
 * @param {string} newValue 新値
 */
function replaceFieldInCollection_(collectionName, field, oldValue, newValue) {
  var token = getFirestoreToken_();
  
  // Structured Query で検索
  var queryUrl = 'https://firestore.googleapis.com/v1/' + FS_DOC_BASE + ':runQuery';
  var queryBody = {
    structuredQuery: {
      from: [{ collectionId: collectionName }],
      where: {
        fieldFilter: {
          field: { fieldPath: field },
          op: 'EQUAL',
          value: { stringValue: oldValue }
        }
      }
    }
  };
  
  var res = UrlFetchApp.fetch(queryUrl, {
    method: 'post',
    headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' },
    payload: JSON.stringify(queryBody),
    muteHttpExceptions: true
  });
  
  if (res.getResponseCode() !== 200) {
    console.error('Query error (' + collectionName + '):', res.getContentText());
    return;
  }
  
  var results = JSON.parse(res.getContentText());
  var updateCount = 0;
  
  for (var i = 0; i < results.length; i++) {
    var r = results[i];
    if (!r.document) continue;
    var docName = r.document.name;
    
    // フィールドを更新（PATCH）
    var patchUrl = 'https://firestore.googleapis.com/v1/' + docName
      + '?updateMask.fieldPaths=' + field;
    var patchBody = { fields: {} };
    patchBody.fields[field] = { stringValue: newValue };
    
    UrlFetchApp.fetch(patchUrl, {
      method: 'patch',
      headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' },
      payload: JSON.stringify(patchBody),
      muteHttpExceptions: true
    });
    updateCount++;
  }
  
  if (updateCount > 0) {
    console.log(collectionName + ' の ' + field + ' を ' + updateCount + '件 更新 (' + oldValue + ' → ' + newValue + ')');
  }
}

// =============================================
// セットアップ
// =============================================

/**
 * サービスアカウントキーをスクリプトプロパティに保存
 * 
 * 使い方:
 *   1. Firebase Console → プロジェクト設定 → サービスアカウント → 新しい秘密鍵を生成
 *   2. DLしたJSONの中身をコピー
 *   3. 下の SA_KEY_JSON に貼り付け
 *   4. この関数を実行
 */
function setupFirestoreSync() {
  // ★★★ ここにサービスアカウントキーのJSONを貼り付けてください ★★★
  var SA_KEY_JSON = ''; // ← JSON文字列をここに入れる
  
  if (!SA_KEY_JSON) {
    console.error('SA_KEY_JSON が空です。サービスアカウントキーのJSONを貼り付けてください。');
    return;
  }
  
  // バリデーション
  try {
    var parsed = JSON.parse(SA_KEY_JSON);
    if (!parsed.client_email || !parsed.private_key) {
      throw new Error('client_email または private_key がありません');
    }
    console.log('サービスアカウント: ' + parsed.client_email);
  } catch (e) {
    console.error('JSONパースエラー:', e);
    return;
  }
  
  PropertiesService.getScriptProperties().setProperty('FIREBASE_SA_KEY', SA_KEY_JSON);
  console.log('✅ サービスアカウントキーを保存しました');
  
  // テスト接続
  try {
    var token = getFirestoreToken_();
    console.log('✅ Firestore認証テスト成功');
  } catch (e) {
    console.error('❌ Firestore認証テスト失敗:', e);
  }
}

/**
 * Firestore同期のトリガーを設定
 * mainDailySync の30分後に実行
 */
function setupFirestoreSyncTrigger() {
  // 既存のsyncAllToFirestoreトリガーを削除
  ScriptApp.getProjectTriggers().forEach(function(t) {
    if (t.getHandlerFunction() === 'syncAllToFirestore') {
      ScriptApp.deleteTrigger(t);
    }
  });
  
  // 毎日6:30に実行（mainDailySyncが6:00の場合を想定）
  ScriptApp.newTrigger('syncAllToFirestore')
    .timeBased()
    .atHour(6)
    .nearMinute(30)
    .everyDays(1)
    .create();
  
  console.log('✅ syncAllToFirestore トリガーを毎日6:30に設定しました');
}
