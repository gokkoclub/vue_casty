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
