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
        },
        // updateMask: スプレッドシート由来のフィールドのみ上書き
        // サイトから追加したフィールドは保持される
        updateMask: {
          fieldPaths: Object.keys(doc.data)
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
      appearanceCount: notion.appearanceCount || 0,
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
