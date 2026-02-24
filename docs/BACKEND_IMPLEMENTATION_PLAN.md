# バックエンド実装計画書
## GAS → Firebase Cloud Functions + Firestore 移行ガイド

> **作成日**: 2026-02-04  
> **目的**: 現行GASベースのバックエンドをFirebase Cloud Functions + Firestoreに移行

---

## � クイックスタート: 実装優先順位

> [!IMPORTANT]
> バックエンド実装を始める際は、以下の順序で進めることを推奨します。

### 推奨実装順序

| 順序 | タスク | 説明 | 所要時間目安 |
|------|--------|------|-------------|
| **1** | **Firebase Functions 初期化** | `firebase init functions` でプロジェクト作成 | 30分 |
| **2** | **Slack連携 Cloud Function** | `submitOrder`, `updateStatus` の実装 | 1日 |
| **3** | **Googleカレンダー連携** | `calendar.ts` (イベント作成/更新/削除) | 1日 |
| **4** | **撮影スケジュール同期** | `syncSchedule` - Notionから撮影リスト取得 | 半日 |
| **5** | **キャストマスタ同期** | `syncCastsFromNotion` - 日次同期 | 半日 |
| **6** | **Firestoreトリガー** | ステータス変更時の自動処理 | 半日 |

### Firebase Functions 初期化コマンド

```bash
# プロジェクトディレクトリで実行
cd /Users/mk0012/Desktop/workspace/vue_casty

# Firebase Functions 初期化
firebase init functions

# 選択オプション:
# - Language: TypeScript
# - ESLint: Yes
# - Install dependencies: Yes
```

---

## �📋 目次

1. [現行GAS機能の分析](#1-現行gas機能の分析)
2. [Firestoreコレクション設計](#2-firestoreコレクション設計)
3. [Cloud Functions 実装計画](#3-cloud-functions-実装計画)
4. [VUE_IMPLEMENTATION_INSTRUCTIONS Phase 6](#4-vue_implementation_instructions-phase-6)
5. [移行フェーズ](#5-移行フェーズ)
6. [環境変数・シークレット](#6-環境変数シークレット)

---

## 1. 現行GAS機能の分析

### 1.1 機能一覧

| # | GAS関数名 | 用途 | 実行タイミング | 移行先 |
|---|-----------|------|---------------|--------|
| 1 | `syncCastToNotion` | キャスト情報をNotionに同期 | Webhook (doPost) | Cloud Function (callable) |
| 2 | `syncDriveLinksToShootingDB` | オフショットDriveリンクを撮影連絡DBに同期 | Webhook (doGet) | **不要** (Firestore直接参照) |
| 3 | `syncShootingContact` | 香盤DBから撮影連絡DBにIN/OUT/場所を同期 | Webhook (doGet) | **不要** (Firestore直接参照) |
| 4 | `mainDailySync` | Notionからキャストマスタへ日次同期 | 時間トリガー | Cloud Function (scheduled) |
| 5 | `syncNewCastMembersWithIdAndFormulas` | 新規キャストのID自動採番・追加 | `mainDailySync`内 | Cloud Function (scheduled) |
| 6 | `markDeletedCastsInColumnA` | Notion削除済みキャストのマーク | `mainDailySync`内 | Cloud Function (scheduled) |
| 7 | `buildCastShootCalendar` | キャスト別撮影日一覧の生成 | 手動/トリガー | **不要** (Vue側でリアルタイム計算) |
| 8 | `syncShootScheduleFromNotion` | Notion撮影DBから撮影リストを同期 | 時間トリガー | Cloud Function (scheduled) |

### 1.2 移行アプローチ

| 元の処理 | Firestore移行後 |
|----------|----------------|
| スプレッドシート読み書き | Firestore CRUD |
| シート間のVLOOKUP/参照 | Firestoreリレーション or 非正規化 |
| 数式コピー | Cloud Function内でロジック実行 |
| 行削除・更新 | Firestoreドキュメント削除・更新 |

---

## 2. Firestoreコレクション設計

### 2.1 コレクション構造

```
/casts/{castId}
  - name: string
  - furigana: string
  - gender: string ("男性" | "女性")
  - dateOfBirth: string (YYYY-MM-DD)
  - agency: string
  - imageUrl: string
  - appearanceCount: number
  - email: string
  - notes: string
  - castType: string ("内部" | "外部")
  - slackMentionId: string
  - snsX: string
  - snsInsta: string
  - snsTiktok: string
  - notionPageId: string  // Notion連携用
  - isDeleted: boolean    // 削除フラグ
  - createdAt: timestamp
  - updatedAt: timestamp

/castings/{castingId}
  - accountName: string
  - projectName: string
  - roleName: string
  - castId: string (ref to /casts)
  - castName: string (非正規化)
  - startDate: string
  - endDate: string
  - rank: string
  - status: string
  - note: string
  - slackThreadTs: string
  - slackPermalink: string
  - mainSub: string ("メイン" | "サブ" | "その他")
  - calendarEventId: string
  - projectId: string (Notion Page ID)
  - cost: number
  - structureData: object
  - dbSentStatus: string
  - createdAt: timestamp
  - updatedAt: timestamp
  - updatedBy: string

/shootingContacts/{contactId}
  - castingId: string (ref to /castings)
  - projectId: string (Notion Page ID)
  - shootingDate: string
  - castId: string
  - castName: string
  - agency: string
  - email: string
  - inTime: string
  - outTime: string
  - location: string
  - address: string
  - cost: number
  - status: string
  - driveLink: string  // オフショットDriveリンク
  - createdAt: timestamp
  - updatedAt: timestamp

/shootings/{shootingId}
  - notionPageId: string
  - title: string
  - shootingDate: string
  - team: string
  - cd: string[]
  - fd: string[]
  - producer: string[]
  - createdAt: timestamp
  - updatedAt: timestamp

/users/{userId}
  - email: string
  - name: string
  - role: string ("admin" | "viewer")
  - createdAt: timestamp
```

### 2.2 インデックス設計

```
// 複合インデックス
castings: [status, shootingDate] - ステータス+日付フィルター用
castings: [projectId, castId] - プロジェクト別キャスト検索用
shootingContacts: [projectId, castId] - 撮影連絡検索用
shootings: [shootingDate] - 日付範囲クエリ用
```

---

## 3. Cloud Functions 実装計画

### 3.1 ファイル構成

```
functions/
├── src/
│   ├── index.ts           # エントリーポイント
│   ├── config.ts          # 環境変数・設定
│   ├── notion/
│   │   ├── api.ts         # Notion API共通処理
│   │   ├── syncCasts.ts   # キャストマスタ同期
│   │   ├── syncShootings.ts # 撮影リスト同期
│   │   └── updateCast.ts  # キャスト情報更新
│   ├── calendar/
│   │   ├── create.ts      # イベント作成
│   │   ├── update.ts      # イベント更新
│   │   └── delete.ts      # イベント削除
│   ├── slack/
│   │   ├── notify.ts      # 通知送信
│   │   └── thread.ts      # スレッド管理
│   ├── triggers/
│   │   ├── onCastingCreate.ts  # キャスティング作成時
│   │   └── onStatusChange.ts   # ステータス変更時
│   └── scheduled/
│       ├── dailySync.ts   # 日次同期
│       └── cleanupOld.ts  # 古いデータクリーンアップ
├── package.json
└── tsconfig.json
```

### 3.2 関数別実装詳細

---

#### **Function 1: syncCastsFromNotion** (Scheduled)

**元GAS関数**: `mainDailySync`, `syncNotionToSheet`, `syncNewCastMembersWithIdAndFormulas`, `markDeletedCastsInColumnA`

```typescript
// functions/src/scheduled/dailySync.ts

import * as functions from 'firebase-functions';
import { getFirestore } from 'firebase-admin/firestore';
import { fetchAllNotionCasts } from '../notion/api';

export const syncCastsFromNotion = functions.pubsub
  .schedule('0 6 * * *')  // 毎日6時
  .timeZone('Asia/Tokyo')
  .onRun(async (context) => {
    const db = getFirestore();
    
    // 1. Notionから全キャスト取得
    const notionCasts = await fetchAllNotionCasts();
    
    // 2. Firestoreの既存キャストを取得
    const castsSnapshot = await db.collection('casts').get();
    const existingCasts = new Map<string, any>();
    castsSnapshot.forEach(doc => {
      existingCasts.set(doc.data().notionPageId, { id: doc.id, ...doc.data() });
    });
    
    // 3. ID自動採番用の最大値取得
    let maxIdNum = 0;
    castsSnapshot.forEach(doc => {
      const id = doc.id;
      if (id.startsWith('cast_')) {
        const num = parseInt(id.replace('cast_', ''), 10);
        if (!isNaN(num) && num > maxIdNum) maxIdNum = num;
      }
    });
    
    const batch = db.batch();
    const notionPageIds = new Set<string>();
    
    // 4. 新規追加・更新処理
    for (const cast of notionCasts) {
      notionPageIds.add(cast.pageId);
      
      if (existingCasts.has(cast.pageId)) {
        // 更新
        const existing = existingCasts.get(cast.pageId)!;
        batch.update(db.collection('casts').doc(existing.id), {
          ...cast,
          updatedAt: new Date()
        });
      } else {
        // 新規追加
        maxIdNum++;
        const newId = `cast_${String(maxIdNum).padStart(5, '0')}`;
        batch.set(db.collection('casts').doc(newId), {
          ...cast,
          createdAt: new Date(),
          updatedAt: new Date()
        });
      }
    }
    
    // 5. 削除済みマーク処理
    existingCasts.forEach((data, notionId) => {
      if (!notionPageIds.has(notionId) && !data.id.startsWith('ext') && !data.isDeleted) {
        batch.update(db.collection('casts').doc(data.id), { isDeleted: true });
      }
    });
    
    await batch.commit();
    console.log(`Synced ${notionCasts.length} casts from Notion`);
  });
```

---

#### **Function 2: syncShootingsFromNotion** (Scheduled)

**元GAS関数**: `syncShootScheduleFromNotion`

```typescript
// functions/src/scheduled/syncShootings.ts

export const syncShootingsFromNotion = functions.pubsub
  .schedule('0 */2 * * *')  // 2時間ごと
  .timeZone('Asia/Tokyo')
  .onRun(async (context) => {
    const db = getFirestore();
    
    // 期間: 今日から1ヶ月後まで
    const now = new Date();
    const oneMonthLater = new Date();
    oneMonthLater.setMonth(oneMonthLater.getMonth() + 1);
    
    // Notionから撮影データ取得
    const shootings = await fetchShootingsFromNotion(now, oneMonthLater);
    
    // Firestoreに同期
    const batch = db.batch();
    const validIds = new Set<string>();
    
    for (const shooting of shootings) {
      validIds.add(shooting.notionPageId);
      const docRef = db.collection('shootings').doc(shooting.notionPageId);
      batch.set(docRef, { ...shooting, updatedAt: new Date() }, { merge: true });
    }
    
    // Notionにない古いデータを削除
    const existingDocs = await db.collection('shootings')
      .where('shootingDate', '>=', formatDate(now))
      .where('shootingDate', '<=', formatDate(oneMonthLater))
      .get();
    
    existingDocs.forEach(doc => {
      if (!validIds.has(doc.id)) {
        batch.delete(doc.ref);
      }
    });
    
    await batch.commit();
  });
```

---

#### **Function 3: updateCastInNotion** (Callable)

**元GAS関数**: `syncCastToNotion`

```typescript
// functions/src/notion/updateCast.ts

export const updateCastInNotion = functions.https.onCall(async (data, context) => {
  // 認証チェック
  if (!context.auth) {
    throw new functions.https.HttpsError('unauthenticated', 'ログインが必要です');
  }
  
  const { pageId, castName, isInternal, orderDetails } = data;
  
  if (!pageId || !castName) {
    throw new functions.https.HttpsError('invalid-argument', '必須データが不足しています');
  }
  
  // プロパティ名の決定
  let targetPropName = 'サブキャスト';
  if (isInternal) {
    targetPropName = '内部キャスト';
  } else if (orderDetails) {
    const details = typeof orderDetails === 'string' ? JSON.parse(orderDetails) : orderDetails;
    if (Array.isArray(details) && details[0]?.type === 'メイン') {
      targetPropName = 'メインキャスト';
    }
  }
  
  // Notion API呼び出し
  const result = await updateNotionMultiSelect(pageId, targetPropName, castName);
  return result;
});
```

---

#### **Function 4: createCalendarEvent** (Callable)

**元GAS関数**: (新規) - Googleカレンダー連携

```typescript
// functions/src/calendar/create.ts

export const createCalendarEvent = functions.https.onCall(async (data, context) => {
  const { castName, projectName, startDate, endDate } = data;
  
  const calendar = google.calendar({ version: 'v3', auth });
  
  const event = {
    summary: `【仮押さえ】${castName} - ${projectName}`,
    start: { date: startDate },
    end: { date: endDate },
  };
  
  const result = await calendar.events.insert({
    calendarId: process.env.GOOGLE_CALENDAR_ID,
    requestBody: event
  });
  
  return { eventId: result.data.id };
});
```

---

#### **Function 5: onCastingStatusChange** (Firestore Trigger)

**自動トリガー**: キャスティングステータス変更時

```typescript
// functions/src/triggers/onStatusChange.ts

export const onCastingStatusChange = functions.firestore
  .document('castings/{castingId}')
  .onUpdate(async (change, context) => {
    const before = change.before.data();
    const after = change.after.data();
    
    // ステータスが変更された場合のみ処理
    if (before.status === after.status) return;
    
    // 1. Slack通知
    await postStatusUpdateToSlack(after);
    
    // 2. カレンダー更新
    if (after.calendarEventId) {
      await updateCalendarEventTitle(after);
    }
    
    // 3. OK/決定になった場合、撮影連絡DBに追加
    if (['OK', '決定'].includes(after.status) && after.castType === '外部') {
      await createShootingContact(after);
    }
    
    // 4. Notion連携
    if (after.projectId) {
      await updateCastInNotion({
        pageId: after.projectId,
        castName: after.castName,
        isInternal: after.castType === '内部',
        orderDetails: after.structureData
      });
    }
  });
```

---

#### **Function 6: submitOrder** (Callable)

**元処理**: オーダー送信

```typescript
// functions/src/order/submit.ts

export const submitOrder = functions.https.onCall(async (data, context) => {
  if (!context.auth) {
    throw new functions.https.HttpsError('unauthenticated', 'ログインが必要です');
  }
  
  const { castings, shooting, hasIntimacy, attachments } = data;
  const db = getFirestore();
  const batch = db.batch();
  
  // 1. キャスティングデータをFirestoreに保存
  for (const casting of castings) {
    const docRef = db.collection('castings').doc();
    batch.set(docRef, {
      ...casting,
      status: '打診中',
      createdAt: new Date(),
      updatedAt: new Date(),
      updatedBy: context.auth.uid
    });
  }
  
  // 2. Slackに通知
  const slackResult = await postOrderToSlack(castings, shooting, hasIntimacy);
  
  // 3. カレンダーにイベント作成
  for (const casting of castings) {
    const eventId = await createCalendarEvent({
      castName: casting.castName,
      projectName: casting.projectName,
      startDate: casting.startDate,
      endDate: casting.endDate
    });
    // batch内でeventIdを更新
  }
  
  await batch.commit();
  
  return { success: true, slackThreadTs: slackResult.ts };
});
```

---

## 4. VUE_IMPLEMENTATION_INSTRUCTIONS Phase 6: Googleカレンダー連携

> [!NOTE]
> この内容は `VUE_IMPLEMENTATION_INSTRUCTIONS.md` の Phase 6 から抜粋したものです。

### 対象ファイル
- `functions/src/calendar.ts` (新規作成)
- `functions/src/index.ts` (修正)

### 4.1 calendar.ts (Firebase Functions)

```typescript
// functions/src/calendar.ts

import * as functions from 'firebase-functions';
import { google } from 'googleapis';

const CALENDAR_ID = process.env.GOOGLE_CALENDAR_ID;
const SERVICE_ACCOUNT_KEY = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_KEY || '{}');

const auth = new google.auth.GoogleAuth({
  credentials: SERVICE_ACCOUNT_KEY,
  scopes: ['https://www.googleapis.com/auth/calendar']
});

const calendar = google.calendar({ version: 'v3', auth });

// イベント作成
export const createCalendarEvent = functions.https.onCall(async (data) => {
  const { castName, projectName, startDate, endDate } = data;
  
  const event = {
    summary: `【仮押さえ】${castName} - ${projectName}`,
    start: { date: startDate },
    end: { date: endDate },
  };
  
  const result = await calendar.events.insert({
    calendarId: CALENDAR_ID,
    requestBody: event
  });
  
  return { eventId: result.data.id };
});

// イベント更新
export const updateCalendarEvent = functions.https.onCall(async (data) => {
  const { eventId, newTitle } = data;
  
  await calendar.events.patch({
    calendarId: CALENDAR_ID,
    eventId,
    requestBody: { summary: newTitle }
  });
  
  return { success: true };
});

// イベント削除
export const deleteCalendarEvent = functions.https.onCall(async (data) => {
  const { eventId } = data;
  
  await calendar.events.delete({
    calendarId: CALENDAR_ID,
    eventId
  });
  
  return { success: true };
});
```

### 4.2 Vue側の useGoogleCalendar.ts (既存ファイル更新)

```typescript
// src/composables/useGoogleCalendar.ts

import { getFunctions, httpsCallable } from 'firebase/functions';

export function useGoogleCalendar() {
  const functions = getFunctions();

  const createEvent = async (data: {
    castName: string;
    projectName: string;
    startDate: string;
    endDate: string;
  }) => {
    const createCalendarEvent = httpsCallable(functions, 'createCalendarEvent');
    const result = await createCalendarEvent(data);
    return result.data as { eventId: string };
  };

  const updateEventTitle = async (eventId: string, newTitle: string) => {
    const updateCalendarEvent = httpsCallable(functions, 'updateCalendarEvent');
    await updateCalendarEvent({ eventId, newTitle });
  };

  const deleteEvent = async (eventId: string) => {
    const deleteCalendarEvent = httpsCallable(functions, 'deleteCalendarEvent');
    await deleteCalendarEvent({ eventId });
  };

  return {
    createEvent,
    updateEventTitle,
    deleteEvent
  };
}
```

### 4.3 カレンダータイトル命名規則

| ステータス | タイトル形式 |
|-----------|-------------|
| 仮押さえ | `【仮押さえ】{キャスト名} - {案件名}` |
| 打診中 | `【打診中】{キャスト名} - {案件名}` |
| OK | `【OK】{キャスト名} - {案件名}` |
| 決定 | `【決定】{キャスト名} - {案件名}` |
| NG/キャンセル | イベント削除 |

---

## 5. 移行フェーズ

### Phase 1: 基盤構築 (1日)
- [ ] Firebase Functions プロジェクト初期化
- [ ] Firestoreセキュリティルール設定
- [ ] 環境変数・シークレット設定

### Phase 2: Notion連携 (1-2日)
- [ ] `syncCastsFromNotion` - キャストマスタ日次同期
- [ ] `syncShootingsFromNotion` - 撮影リスト同期
- [ ] `updateCastInNotion` - キャスト情報更新

### Phase 3: カレンダー連携 (1日)
- [ ] `createCalendarEvent` - イベント作成
- [ ] `updateCalendarEvent` - イベント更新
- [ ] `deleteCalendarEvent` - イベント削除

### Phase 4: Slack連携 (1日)
- [ ] `postOrderToSlack` - オーダー送信通知
- [ ] `postStatusUpdateToSlack` - ステータス変更通知
- [ ] スレッド返信機能

### Phase 5: トリガー実装 (1日)
- [ ] `onCastingStatusChange` - ステータス変更トリガー
- [ ] `onCastingCreate` - 新規作成トリガー

### Phase 6: Vue側統合 (1日)
- [ ] `useCastings.ts` - Cloud Functions呼び出しに変更
- [ ] `useSlack.ts` - Cloud Functions呼び出しに変更
- [ ] `useGoogleCalendar.ts` - Cloud Functions呼び出しに変更

---

## 6. 環境変数・シークレット

### Firebase Functions シークレット

```bash
# Notion
firebase functions:secrets:set NOTION_TOKEN
firebase functions:secrets:set NOTION_DB_ID
firebase functions:secrets:set NOTION_SHOOT_DB_ID

# Slack
firebase functions:secrets:set SLACK_BOT_TOKEN
firebase functions:secrets:set SLACK_DEFAULT_CHANNEL
firebase functions:secrets:set SLACK_EXTERNAL_CHANNEL

# Google Calendar
firebase functions:secrets:set GOOGLE_CALENDAR_ID
firebase functions:secrets:set GOOGLE_SERVICE_ACCOUNT_KEY
```

### 取得方法

| シークレット | 取得場所 |
|-------------|---------|
| `NOTION_TOKEN` | Notion Integrations ページ |
| `NOTION_DB_ID` | Notion データベースURLから抽出 |
| `SLACK_BOT_TOKEN` | Slack App管理画面 |
| `GOOGLE_SERVICE_ACCOUNT_KEY` | GCP Console → IAM → サービスアカウント |

---

## 7. GAS機能の代替まとめ

| GAS機能 | Firestore移行後の対応 |
|---------|---------------------|
| シート間参照 (VLOOKUP等) | Firestoreの非正規化 or リアルタイムクエリ |
| 行削除 | ドキュメント削除 or `isDeleted`フラグ |
| 数式コピー | Cloud Function内でロジック実行 |
| 時間トリガー | Cloud Scheduler (PubSub) |
| Webhook (doGet/doPost) | Cloud Functions (https.onCall / https.onRequest) |
| スプレッドシートUI | Vue UI |

---

> **次のステップ**: この計画書をレビューし、承認後にPhase 1から実装を開始します。
