/**
 * GAS 定期バッチ処理
 * 
 * このスクリプトは以下の定期同期処理を行います:
 * - syncCastsFromNotion: NotionのキャストDBからFirestoreへ同期（毎日6時）
 * - syncShootingsFromNotion: Notionの撮影スケジュールをFirestoreへ同期（2時間毎）
 * 
 * リアルタイム処理（Slack通知、Calendar連携）はCloud Functionsで行うため、
 * このスクリプトでは対応しません。
 * 
 * セットアップ:
 * 1. GASエディタでこのコードをコピー
 * 2. setupScriptProperties() を一度実行してプロパティを設定
 * 3. setupTriggers() を一度実行してトリガーを設定
 */

// =============================================
// Firestore REST API ヘルパー
// =============================================

/**
 * Firestore REST APIのベースURL
 */
function getFirestoreBaseUrl() {
  const projectId = PropertiesService.getScriptProperties().getProperty('FIREBASE_PROJECT_ID');
  return `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents`;
}

/**
 * Firestoreの認証ヘッダーを取得
 */
function getFirestoreHeaders() {
  const token = ScriptApp.getOAuthToken();
  return {
    'Authorization': 'Bearer ' + token,
    'Content-Type': 'application/json'
  };
}

/**
 * Firestoreドキュメントを作成/更新
 */
function firestoreSet(collectionPath, docId, data) {
  const url = `${getFirestoreBaseUrl()}/${collectionPath}/${docId}`;
  const fields = {};
  
  for (const [key, value] of Object.entries(data)) {
    fields[key] = convertToFirestoreValue(value);
  }
  
  const options = {
    method: 'patch',
    headers: getFirestoreHeaders(),
    payload: JSON.stringify({ fields }),
    muteHttpExceptions: true
  };
  
  const response = UrlFetchApp.fetch(url, options);
  if (response.getResponseCode() !== 200) {
    console.error(`Firestore set error for ${collectionPath}/${docId}:`, response.getContentText());
    return null;
  }
  return JSON.parse(response.getContentText());
}

/**
 * Firestoreのコレクションを取得
 */
function firestoreGetAll(collectionPath) {
  const url = `${getFirestoreBaseUrl()}/${collectionPath}`;
  const options = {
    method: 'get',
    headers: getFirestoreHeaders(),
    muteHttpExceptions: true
  };
  
  const response = UrlFetchApp.fetch(url, options);
  if (response.getResponseCode() !== 200) {
    console.error(`Firestore getAll error:`, response.getContentText());
    return [];
  }
  
  const result = JSON.parse(response.getContentText());
  return (result.documents || []).map(doc => {
    const id = doc.name.split('/').pop();
    const data = {};
    if (doc.fields) {
      for (const [key, value] of Object.entries(doc.fields)) {
        data[key] = convertFromFirestoreValue(value);
      }
    }
    return { id, ...data };
  });
}

/**
 * JavaScript値をFirestore値に変換
 */
function convertToFirestoreValue(value) {
  if (value === null || value === undefined) return { nullValue: null };
  if (typeof value === 'string') return { stringValue: value };
  if (typeof value === 'number') {
    return Number.isInteger(value) ? { integerValue: value } : { doubleValue: value };
  }
  if (typeof value === 'boolean') return { booleanValue: value };
  if (value instanceof Date) return { timestampValue: value.toISOString() };
  if (Array.isArray(value)) {
    return { arrayValue: { values: value.map(convertToFirestoreValue) } };
  }
  if (typeof value === 'object') {
    const fields = {};
    for (const [k, v] of Object.entries(value)) {
      fields[k] = convertToFirestoreValue(v);
    }
    return { mapValue: { fields } };
  }
  return { stringValue: String(value) };
}

/**
 * Firestore値をJavaScript値に変換
 */
function convertFromFirestoreValue(value) {
  if ('stringValue' in value) return value.stringValue;
  if ('integerValue' in value) return parseInt(value.integerValue);
  if ('doubleValue' in value) return value.doubleValue;
  if ('booleanValue' in value) return value.booleanValue;
  if ('timestampValue' in value) return new Date(value.timestampValue);
  if ('nullValue' in value) return null;
  if ('arrayValue' in value) {
    return (value.arrayValue.values || []).map(convertFromFirestoreValue);
  }
  if ('mapValue' in value) {
    const result = {};
    for (const [k, v] of Object.entries(value.mapValue.fields || {})) {
      result[k] = convertFromFirestoreValue(v);
    }
    return result;
  }
  return null;
}

// =============================================
// Notion → Firestore 同期
// =============================================

/**
 * NotionのキャストDBからFirestoreのcastsコレクションに同期
 * トリガー: 毎日6時
 */
function syncCastsFromNotion() {
  const props = PropertiesService.getScriptProperties();
  const notionToken = props.getProperty('NOTION_TOKEN');
  const notionDbId = props.getProperty('NOTION_CAST_DB_ID');
  
  if (!notionToken || !notionDbId) {
    console.error('NOTION_TOKEN or NOTION_CAST_DB_ID not set');
    return;
  }
  
  console.log('Starting cast sync from Notion...');
  
  try {
    // Notionからキャスト一覧を取得
    const casts = queryNotionDatabase(notionToken, notionDbId);
    console.log(`Found ${casts.length} casts in Notion`);
    
    let synced = 0;
    for (const cast of casts) {
      try {
        const castData = extractCastData(cast);
        if (castData.name) {
          firestoreSet('casts', castData.id, castData);
          synced++;
        }
      } catch (e) {
        console.error('Error syncing cast:', e);
      }
    }
    
    console.log(`Synced ${synced} casts to Firestore`);
  } catch (error) {
    console.error('syncCastsFromNotion error:', error);
  }
}

/**
 * Notionの撮影スケジュールDBからFirestoreのshootingsコレクションに同期
 * トリガー: 2時間毎
 */
function syncShootingsFromNotion() {
  const props = PropertiesService.getScriptProperties();
  const notionToken = props.getProperty('NOTION_TOKEN');
  const notionDbId = props.getProperty('NOTION_SHOOTING_DB_ID');
  
  if (!notionToken || !notionDbId) {
    console.error('NOTION_TOKEN or NOTION_SHOOTING_DB_ID not set');
    return;
  }
  
  console.log('Starting shooting sync from Notion...');
  
  try {
    const shootings = queryNotionDatabase(notionToken, notionDbId);
    console.log(`Found ${shootings.length} shootings in Notion`);
    
    let synced = 0;
    for (const shooting of shootings) {
      try {
        const shootingData = extractShootingData(shooting);
        if (shootingData.title) {
          firestoreSet('shootings', shootingData.id, shootingData);
          synced++;
        }
      } catch (e) {
        console.error('Error syncing shooting:', e);
      }
    }
    
    console.log(`Synced ${synced} shootings to Firestore`);
  } catch (error) {
    console.error('syncShootingsFromNotion error:', error);
  }
}

// =============================================
// Notion API ヘルパー
// =============================================

/**
 * Notionデータベースをクエリしてすべてのページを取得
 */
function queryNotionDatabase(token, databaseId) {
  const results = [];
  let hasMore = true;
  let startCursor = undefined;
  
  while (hasMore) {
    const payload = { page_size: 100 };
    if (startCursor) payload.start_cursor = startCursor;
    
    const response = UrlFetchApp.fetch(`https://api.notion.com/v1/databases/${databaseId}/query`, {
      method: 'post',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Notion-Version': '2022-06-28',
        'Content-Type': 'application/json'
      },
      payload: JSON.stringify(payload),
      muteHttpExceptions: true
    });
    
    if (response.getResponseCode() !== 200) {
      console.error('Notion API error:', response.getContentText());
      break;
    }
    
    const data = JSON.parse(response.getContentText());
    results.push(...data.results);
    hasMore = data.has_more;
    startCursor = data.next_cursor;
  }
  
  return results;
}

/**
 * Notionページからキャストデータを抽出
 */
function extractCastData(page) {
  const props = page.properties || {};
  
  return {
    id: page.id,
    name: getNotionPropertyValue(props['名前'] || props['Name'], 'title'),
    furigana: getNotionPropertyValue(props['フリガナ'], 'rich_text'),
    gender: getNotionPropertyValue(props['性別'], 'select'),
    agency: getNotionPropertyValue(props['事務所'], 'rich_text') || '',
    imageUrl: getNotionPropertyValue(props['写真'], 'files') || '',
    email: getNotionPropertyValue(props['メール'], 'email') || '',
    notes: getNotionPropertyValue(props['備考'], 'rich_text') || '',
    castType: getNotionPropertyValue(props['タイプ'], 'select') || '外部',
    slackMentionId: getNotionPropertyValue(props['SlackID'], 'rich_text') || '',
    snsX: getNotionPropertyValue(props['X'], 'url') || '',
    snsInstagram: getNotionPropertyValue(props['Instagram'], 'url') || '',
    snsTikTok: getNotionPropertyValue(props['TikTok'], 'url') || '',
    updatedAt: new Date()
  };
}

/**
 * Notionページから撮影スケジュールデータを抽出
 */
function extractShootingData(page) {
  const props = page.properties || {};
  
  return {
    id: page.id,
    title: getNotionPropertyValue(props['タイトル'] || props['Name'], 'title'),
    shootDate: getNotionPropertyValue(props['撮影日'], 'date'),
    team: getNotionPropertyValue(props['チーム'], 'select') || '',
    director: getNotionPropertyValue(props['ディレクター'], 'rich_text') || '',
    floorDirector: getNotionPropertyValue(props['フロアD'], 'rich_text') || '',
    notionUrl: `https://www.notion.so/${page.id.replace(/-/g, '')}`,
    notionPageId: page.id,
    updatedAt: new Date()
  };
}

/**
 * Notionプロパティ値を取得するヘルパー
 */
function getNotionPropertyValue(property, type) {
  if (!property) return '';
  
  switch (type) {
    case 'title':
      return (property.title || []).map(t => t.plain_text).join('');
    case 'rich_text':
      return (property.rich_text || []).map(t => t.plain_text).join('');
    case 'select':
      return property.select ? property.select.name : '';
    case 'multi_select':
      return (property.multi_select || []).map(s => s.name);
    case 'date':
      return property.date ? property.date.start : '';
    case 'email':
      return property.email || '';
    case 'url':
      return property.url || '';
    case 'number':
      return property.number || 0;
    case 'files':
      const files = property.files || [];
      if (files.length > 0) {
        return files[0].file ? files[0].file.url : (files[0].external ? files[0].external.url : '');
      }
      return '';
    default:
      return '';
  }
}

// =============================================
// セットアップ
// =============================================

/**
 * スクリプトプロパティを設定
 * 初回のみ実行
 */
function setupScriptProperties() {
  const props = PropertiesService.getScriptProperties();
  
  // 以下の値を実際の値に置き換えてください
  props.setProperties({
    'FIREBASE_PROJECT_ID': 'gokko-casty',
    'NOTION_TOKEN': 'YOUR_NOTION_TOKEN',
    'NOTION_CAST_DB_ID': 'YOUR_NOTION_CAST_DATABASE_ID',
    'NOTION_SHOOTING_DB_ID': 'YOUR_NOTION_SHOOTING_DATABASE_ID'
  });
  
  console.log('Script properties set successfully');
}

/**
 * トリガーを設定
 * 初回のみ実行
 */
function setupTriggers() {
  // 既存のトリガーを削除
  const existingTriggers = ScriptApp.getProjectTriggers();
  existingTriggers.forEach(trigger => ScriptApp.deleteTrigger(trigger));
  
  // キャスト同期: 毎日6時
  ScriptApp.newTrigger('syncCastsFromNotion')
    .timeBased()
    .atHour(6)
    .everyDays(1)
    .create();
  
  // 撮影スケジュール同期: 2時間毎
  ScriptApp.newTrigger('syncShootingsFromNotion')
    .timeBased()
    .everyHours(2)
    .create();
  
  console.log('Triggers set up successfully');
}

/**
 * doGet - ヘルスチェック用
 */
function doGet() {
  return ContentService
    .createTextOutput(JSON.stringify({ status: 'ok', service: 'vue_casty_gas_sync' }))
    .setMimeType(ContentService.MimeType.JSON);
}
