
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
//    ソース: キャストリスト（Notion_FromDB + 内部キャストDB の情報を関数で集約済み）
// =============================================
function syncCastsToFirestore_() {
  console.log('=== casts 同期開始 ===');
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  
  // --- キャストリスト 読み取り ---
  // A=CastID, B=氏名, C=性別, D=生年月日, E=所属事務所,
  // F=アイコンURL, G=主演回数, H=メール, I=メモ, J=内部外部,
  // K=SlackID, L=X(Twitter), M=Instagram, N=TikTok, O=ふりがな
  var castListSheet = ss.getSheetByName('キャストリスト');
  if (!castListSheet || castListSheet.getLastRow() < 2) {
    console.warn('キャストリスト が見つからないかデータなし');
    return 0;
  }
  var castListData = castListSheet.getRange(2, 1, castListSheet.getLastRow() - 1, 15).getValues();
  
  var documents = [];
  
  castListData.forEach(function(row) {
    var castId = String(row[0] || '').trim();   // A: CastID
    var name = String(row[1] || '').trim();      // B: 氏名
    
    // cast_XXXXX フォーマットのみ同期（削除済み等はスキップ）
    if (!castId || !name || !castId.startsWith('cast_')) return;
    
    var docId = sanitizeDocId_(castId);
    if (!docId) return;
    
    var castType = String(row[9] || '').trim();  // J: 内部外部
    
    var castData = {
      name: name,
      furigana: String(row[14] || '').trim(),      // O: ふりがな
      gender: String(row[2] || ''),                 // C: 性別
      castType: castType || '外部',                 // J: 内部外部（空なら外部）
      agency: String(row[4] || ''),                 // E: 所属事務所
      imageUrl: String(row[5] || ''),               // F: アイコンURL
      email: String(row[7] || ''),                  // H: メール
      slackMentionId: String(row[10] || ''),         // K: SlackID
      snsX: String(row[11] || ''),                  // L: X(Twitter)
      snsInstagram: String(row[12] || ''),           // M: Instagram
      snsTikTok: String(row[13] || ''),              // N: TikTok
      dateOfBirth: String(row[3] || ''),             // D: 生年月日
      updatedAt: new Date()
    };
    
    documents.push({ id: docId, data: castData });
  });
  
  // 重複排除
  var uniqueMap = {};
  documents.forEach(function(doc) {
    uniqueMap[doc.id] = doc;
  });
  var uniqueDocs = Object.keys(uniqueMap).map(function(key) { return uniqueMap[key]; });
  
  if (uniqueDocs.length > 0) {
    firestoreBatchWrite_(uniqueDocs, 'casts');
  }
  
  console.log('casts 同期完了: ' + uniqueDocs.length + '件 (キャストリストから)');
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
  
  // shootingDetails は香盤.gas から直接Firestoreに書き込むため、日次同期は不要
  // （香盤DB経由の二重登録を防止）
  // try {
  //   results.shootingDetails = syncShootingDetailsToFirestore_();
  // } catch (e) {
  //   console.error('shootingDetails同期エラー:', e);
  //   results.shootingDetails = 'ERROR: ' + e.message;
  // }
  
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
