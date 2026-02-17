# キャスティング管理システム - システム仕様書

**更新日:** 2026-02-16  
**バージョン:** 3.0

---

## 📋 目次

1. [システム概要](#1-システム概要)
2. [技術スタック](#2-技術スタック)
3. [認証・権限管理](#3-認証権限管理)
4. [データモデル (Firestore)](#4-データモデル-firestore)
5. [フロントエンド アーキテクチャ](#5-フロントエンド-アーキテクチャ)
6. [画面仕様](#6-画面仕様)
7. [モーダル仕様](#7-モーダル仕様)
8. [Cloud Functions](#8-cloud-functions)
9. [GAS (Google Apps Script)](#9-gas-google-apps-script)
10. [外部連携](#10-外部連携)
11. [ビジネスロジック](#11-ビジネスロジック)
12. [ステータス定義](#12-ステータス定義)
13. [環境変数](#13-環境変数)

---

## 1. システム概要

### 1.1 目的
キャスティング業務を効率化するWebアプリケーション。キャスト検索、オーダー管理、ステータス追跡、Slack通知、カレンダー連携、撮影連絡管理を一元化。

### 1.2 システム構成

```
┌──────────────────────────────────────────────────────┐
│                Vue 3 フロントエンド                     │
│  Vue Router / Pinia / PrimeVue / Composition API      │
└───────────────────────┬──────────────────────────────┘
                        │
          ┌─────────────┼────────────────┐
          │             │                │
   ┌──────┴──────┐ ┌────┴─────┐  ┌───────┴───────┐
   │  Firestore  │ │  Cloud   │  │  Firebase     │
   │  (データ)    │ │ Functions│  │  Auth         │
   └─────────────┘ └────┬─────┘  └───────────────┘
                        │
          ┌─────────────┼────────────────┐
          │             │                │
   ┌──────┴──────┐ ┌────┴─────┐  ┌───────┴───────┐
   │  Slack API  │ │ Google   │  │  Notion API   │
   │             │ │ Calendar │  │  (GAS経由)     │
   └─────────────┘ └──────────┘  └───────────────┘
```

### 1.3 ユーザーロール

| ロール | 権限 |
|--------|------|
| **管理者 (Admin)** | 全機能利用、ステータス変更、削除、管理画面アクセス |
| **一般ユーザー** | 閲覧、オーダー作成 |

---

## 2. 技術スタック

### 2.1 フロントエンド

| 技術 | バージョン | 用途 |
|------|-----------|------|
| Vue 3 | 3.x | UIフレームワーク (Composition API) |
| TypeScript | 5.x | 型安全 |
| Vite | 6.x | ビルドツール |
| PrimeVue | 4.x | UIコンポーネントライブラリ |
| Pinia | 2.x | 状態管理 |
| Vue Router | 4.x | ルーティング |
| vuedraggable | 4.x | ドラッグ&ドロップ (カート内) |
| jsPDF | - | PDF発注書生成 |

### 2.2 バックエンド

| 技術 | 用途 |
|------|------|
| Firebase Firestore | メインデータベース |
| Firebase Auth | Google OAuth認証 |
| Firebase Cloud Functions v2 | サーバーサイドロジック |
| Firebase Hosting | デプロイ |
| Google Apps Script (GAS) | データ同期（Notion、スプレッドシート） |

### 2.3 外部サービス

| サービス | 用途 |
|----------|------|
| Slack | 通知・スレッド管理 |
| Google Calendar | 内部キャスト仮押さえ・決定イベント |
| Notion | 撮影案件データの読み取り |

---

## 3. 認証・権限管理

### 3.1 認証フロー

1. ユーザーがGoogleアカウントでサインイン（Firebase Auth `signInWithPopup`）
2. `onAuthStateChanged` でユーザー状態を監視
3. Firestore `admins` コレクションでメールアドレスベースの管理者判定

### 3.2 管理者判定ロジック

```
admins コレクション:
  { email: "admin@example.com", active: true }
```

- `useAuth()` composableが `isAdmin` computed を提供
- `admins` コレクションの `email` フィールドと `active: true` で照合

### 3.3 実装ファイル

- `src/composables/useAuth.ts` — 認証状態管理、signIn/signOut、isAdmin判定
- `src/services/firebase.ts` — Firebase初期化、Auth/Firestore/Functions インスタンス

---

## 4. データモデル (Firestore)

### 4.1 `casts` コレクション — キャスト情報

| フィールド | 型 | 説明 |
|-----------|------|------|
| `name` | string | キャスト名 |
| `furigana` | string? | ふりがな（50音順ソート用） |
| `gender` | '男性' \| '女性' \| '' | 性別 |
| `dateOfBirth` | Timestamp? | 生年月日 |
| `agency` | string | 所属事務所 |
| `imageUrl` | string | 写真URL |
| `email` | string | メールアドレス |
| `notes` | string | 備考 |
| `castType` | '内部' \| '外部' | キャスト種別 |
| `slackMentionId` | string | Slack User ID |
| `appearanceCount` | number | 出演回数 |
| `snsX`, `snsInstagram`, `snsTikTok` | string? | SNS URL |
| `createdAt`, `updatedAt` | Timestamp | タイムスタンプ |

### 4.2 `castings` コレクション — キャスティング（オーダー）

| フィールド | 型 | 説明 |
|-----------|------|------|
| `castId` | string | キャストID参照 |
| `castName` | string | キャスト名（非正規化） |
| `castType` | '内部' \| '外部' | キャスト種別 |
| `accountName` | string | アカウント名/チーム名 |
| `projectName` | string | 作品名 |
| `projectId` | string | Notion Page ID |
| `roleName` | string | 役名 |
| `startDate`, `endDate` | Timestamp | 撮影日の開始・終了 |
| `startTime`, `endTime` | string? | 時間帯 (HH:mm) |
| `rank` | number | 候補順位 (1-based) |
| `status` | CastingStatus | ステータス |
| `note` | string | 備考 |
| `mainSub` | 'メイン' \| 'サブ' \| 'その他' | メイン/サブ区分 |
| `cost` | number | 金額（税別） |
| `slackThreadTs` | string | Slackスレッド timestamp |
| `slackPermalink` | string | Slackパーマリンク |
| `calendarEventId` | string | Google CalendarイベントID |
| `dbSentStatus` | '済' \| '' | DB送信済みフラグ |
| `shootingDates` | string[]? | 中長編用：参加日リスト |
| `createdBy`, `updatedBy` | string | 操作者 |
| `createdAt`, `updatedAt` | Timestamp | タイムスタンプ |

### 4.3 `shootingContacts` コレクション — 撮影連絡DB

| フィールド | 型 | 説明 |
|-----------|------|------|
| `castingId` | string | 元のcastingsへの参照 |
| `castName`, `castType`, `projectName`, `accountName`, `roleName` | string | 非正規化データ |
| `shootDate` | Timestamp | 撮影日 |
| `inTime`, `outTime` | string? | IN/OUT時間 |
| `location`, `address` | string? | 撮影場所 |
| `fee` | number? | 金額 |
| `makingUrl` | string? | メイキングURL |
| `postDate` | Timestamp? | 投稿日 |
| `mainSub` | string | メイン/サブ区分 |
| `status` | ShootingContactStatus | フェーズステータス |
| `email` | string? | メールアドレス |
| `orderDocumentId` | string? | 発注書ID |

### 4.4 `castMaster` コレクション — キャスト履歴

| フィールド | 型 | 説明 |
|-----------|------|------|
| `castingId` | string | 元のcastingsへの参照 |
| `castId`, `castName`, `castType` | string | キャスト情報 |
| `accountName`, `projectName`, `roleName`, `mainSub` | string | 案件情報 |
| `shootDate`, `endDate` | Timestamp | 撮影日 |
| `cost` | number | 金額 |
| `decidedAt` | Timestamp | 決定日時 |
| `decidedBy` | string | 決定したユーザー |

### 4.5 `shootings` コレクション — 撮影スケジュール (Notionから同期)

| フィールド | 型 | 説明 |
|-----------|------|------|
| `title` | string | 作品名 |
| `shootDate` | Timestamp | 撮影日 |
| `team` | string | アカウント名 |
| `director`, `floorDirector` | string | CD/FD名 |
| `notionUrl`, `notionPageId` | string | Notion参照 |
| `cd`, `fd`, `producer`, `camera` 等 | string? | スタッフ情報 |
| `allStaff` | string[]? | 全スタッフ名一覧 |

### 4.6 `admins` コレクション — 管理者リスト

| フィールド | 型 | 説明 |
|-----------|------|------|
| `email` | string | 管理者メールアドレス |
| `active` | boolean | 有効フラグ |

### 4.7 `shootingDetails` / `offshotDrive` コレクション — GAS同期データ

- `shootingDetails`: 香盤DB（IN/OUT時間、場所、住所、Notion URL）
- `offshotDrive`: オフショットDriveリンク（Notion ID、Drive Link）

---

## 5. フロントエンド アーキテクチャ

### 5.1 ルーティング

| パス | ビュー | 説明 |
|------|--------|------|
| `/` | `HomeView.vue` | ホーム |
| `/casting` | `CastingView.vue` | キャストを探す |
| `/casting-status` | `CastingStatusView.vue` | キャスティング状況 |
| `/status` | `StatusView.vue` | ステータス |
| `/management` | `ManagementView.vue` | 管理画面 |
| `/shooting-contact` | `ShootingContactView.vue` | 撮影連絡DB |
| `/setup-test` | `SetupTestView.vue` | セットアップテスト |

### 5.2 Composables (15ファイル)

| Composable | 用途 |
|-----------|------|
| `useAuth` | 認証、管理者判定 |
| `useAdmins` | 管理者リスト管理 |
| `useCasts` | キャスト情報のCRUD |
| `useCastings` | キャスティングデータ、ステータス更新、タブフィルタリング、階層グループ化 |
| `useOrders` | オーダー作成・送信、Slack通知呼び出し |
| `useAvailability` | キャスト空き状況チェック |
| `useBulkSelection` | 一括選択モード |
| `useCastMaster` | キャスト履歴（決定時に自動追加） |
| `useShootingContact` | 撮影連絡DB管理 |
| `useShootings` | 撮影スケジュール（Notionデータ） |
| `useSlack` | Slack API呼び出し |
| `useGoogleCalendar` | Googleカレンダー連携 |
| `useNotion` | Notion同期 |
| `useEmailTemplate` | メールテンプレート生成 |
| `usePdfGenerator` | PDF発注書生成 (jsPDF) |

### 5.3 Pinia Stores (2ファイル)

| Store | 用途 |
|-------|------|
| `orderStore` | オーダー状態管理（cast pool、projects/roles、context、manualMeta） |
| `cartStore` | カート表示状態 |

### 5.4 コンポーネント構成

```
components/
├── calendar/          # カレンダーUI
├── cart/              # カートモーダル (6コンポーネント)
│   ├── CartModal.vue
│   ├── CartCastPool.vue
│   ├── CartProjectList.vue
│   ├── CartRoleDropZone.vue
│   ├── CartConfirmation.vue
│   └── CartProgressModal.vue
├── cast/              # キャストカード、詳細モーダル (2)
├── casting/           # キャスティング行、ステータスバッジ (6)
├── common/            # 共通モーダル (4: Email, PDF, Summary, Progress)
├── contact/           # 撮影連絡テーブル (1)
├── shooting/          # 撮影選択UI (1)
└── status/            # 一括操作バー (3)
```

---

## 6. 画面仕様

### 6.1 キャストを探す (`CastingView.vue`)

**カレンダー + 撮影選択 → フィルター → キャストカード → カート**

#### カレンダー機能
- 月送りナビゲーション
- 日付クリックでトグル選択（複数選択可）
- 日程範囲（`~`区切り）生成

#### 撮影選択
- 選択した日付に一致する `shootings` コレクションのデータを表示
- 撮影を選択すると `orderStore` のcontextが自動設定（mode='shooting'）
- 未選択時は手動でモード切替可（外部案件/社内イベント）

#### フィルター

| フィルター | 動作 |
|-----------|------|
| テキスト検索 | 名前・事務所名・ふりがな |
| タイプ | すべて / 内部 / 外部 |
| 性別 | チェックボックス（男性/女性） |
| 事務所 | マルチセレクト |
| 未仮キャスのみ | 仮押さえされていないキャストのみ |
| ソート | 最新 / 出演回数 / 50音順 |

#### 表示モード
- **3列モード**: 詳細重視
- **5列モード**: 一覧性重視

#### カート追加
- キャストカードのボタンクリック → `orderStore.addToPool(cast)`
- カートアイコンのバッジに件数表示

---

### 6.2 キャスティング状況 (`CastingStatusView.vue`)

**4タブ + 月送り + フィルター → アコーディオン表示（日付→アカウント→案件→キャスト）**

#### タブ構成

| タブ | フィルタ条件 | 説明 |
|------|-------------|------|
| **全体** | 全キャスティング | フィルタなし |
| **撮影** | `!isSpecialAccount && !isMultiDay` | 通常案件（単日） |
| **社内イベント・外部案件** | `accountName in ['外部案件', '社内イベント']` | 特別案件 |
| **中長編** | `!isSpecialAccount && isMultiDay` | 中長編（startDate ≠ endDate） |

#### 表示切替
- **日付ビュー**（デフォルト）: 日付 → アカウント → 案件 → キャスト行
- **作品ビュー**: 作品名でグループ化（撮影タブ、中長編タブで利用可）

#### コントロール
- 月送り（◀ ▶）
- ☐ オーダー待ちのみ
- ☐ 過去を表示

#### キャスト行
- ステータスバッジ（クリックでステータス変更モーダル）
- キャスト名 / 役名 / ランク
- アクション: Slackを開く、追加オーダー、まとめ、削除（Admin）

---

### 6.3 撮影連絡DB (`ShootingContactView.vue`)

**フェーズタブ → 日付/案件別アコーディオン → インライン編集テーブル**

#### フェーズ（ステータス）タブ

| タブ | ステータス | 機能 |
|------|-----------|------|
| 1 | 香盤連絡待ち | IN/OUT時間・場所の編集 |
| 2 | 発注書送信待ち | PDF発注書作成 |
| 3 | メイキング共有待ち | メイキングURL編集 |
| 4 | 投稿日連絡待ち | 投稿日編集 |
| 5 | 完了 | 全フロー完了 |

#### 行アクション
- 💾 保存: インライン編集内容をFirestoreに反映
- 📧 メール: メールテンプレート作成モーダル
- 📄 発注書: PDF生成モーダル（発注書タブのみ）
- ステータス進行: 次のフェーズへ移動

---

## 7. モーダル仕様

### 7.1 カートモーダル

**Step 1: キャスト割り当て**
- Cast Pool: ドラッグ元（`pull: 'clone'` — プールから消えない）
- Projects/Roles: ドロップゾーン
- 重複チェック: 同じキャストを同じ役に2回ドロップ不可
- プロジェクト追加/削除、役追加/削除

**Step 2: 確認・送信**
- 内容確認（アカウント、日程、キャスト/役割り当て）
- PDF添付（任意）
- 送信 → プログレスモーダル表示

### 7.2 ステータス変更モーダル
- ステータス選択ボタン群
- 金額入力（OK/決定選択時のみ表示）
- 追加メッセージ（任意）

### 7.3 メールモーダル (`EmailModal.vue`)
- 2タブ: 香盤連絡 / 発注書送付
- テンプレート自動生成
- クリップボードコピー / mailto:リンク

### 7.4 PDF発注書モーダル (`OrderPdfModal.vue`)
- jsPDFによるブラウザ内PDF生成
- 季節の挨拶文自動挿入
- プレビュー / ダウンロード

### 7.5 まとめモーダル (`SummaryModal.vue`)
- プロジェクト全体のキャスティングサマリー
- 合計金額表示
- DataTable形式

---

## 8. Cloud Functions

**リージョン:** `asia-northeast1` (東京)  
**ランタイム:** Node.js  
**エントリーポイント:** `functions/src/index.ts`

### 8.1 エクスポート一覧

| 関数 | ファイル | トリガー | 説明 |
|------|---------|---------|------|
| `notifyOrderCreated` | `index.ts` | `onCall` | オーダー送信 → Slack通知 + Calendar作成 |
| `notifyStatusUpdate` | `index.ts` | `onCall` | ステータス変更 → Slack通知 + Calendar更新 + Notion同期 |
| `deleteCastingCleanup` | `index.ts` | `onCall` | 削除 → Calendar削除 + Slack通知 |
| `getShootingDetails` / `syncShootingDetailsToContacts` | `shootingDetails.ts` | `onCall` | 香盤データ取得・同期 |
| `syncDriveLinksToContacts` | `driveSync.ts` | `onCall` | Driveリンク同期 |

### 8.2 補助モジュール

| ファイル | 内容 |
|---------|------|
| `slack.ts` | Slack API ラッパー (`postToSlack`, メッセージ構築) |
| `calendar.ts` | Google Calendar API ラッパー (イベント作成/更新/削除) |
| `notion.ts` | Notion API ラッパー (キャスト同期) |

### 8.3 `notifyOrderCreated` 処理フロー

1. ペイロード検証
2. Slack通知送信（チャンネル選択、メッセージ構築、`thread_ts`/`permalink`取得）
3. 内部キャストのGoogleカレンダーイベント作成
4. Firestore `castings` ドキュメントに `slackThreadTs`/`slackPermalink` を書き戻し
5. 結果返却 (`{ ts, permalink, calendarResults }`)

### 8.4 `notifyStatusUpdate` 処理フロー

1. Firestoreから `castings/{castingId}` を取得
2. Slackスレッドにステータス変更通知を投稿
3. 内部キャスト + カレンダーイベントがある場合: カレンダー更新/削除
4. OK/決定の場合: Notion同期（GAS経由 or 直接）

---

## 9. GAS (Google Apps Script)

### 9.1 ファイル

| ファイル | 用途 |
|---------|------|
| `gas.gas` | メインGASスクリプト（Notion同期、Drive同期、撮影連絡同期） |
| `gas/sync_to_firestore.gs` | スプレッドシート → Firestore同期 |

### 9.2 主要関数

| 関数 | 説明 |
|------|------|
| `syncShootingDetailsToFirestore_()` | 香盤DB → `shootingDetails` コレクション |
| `syncOffshotDriveToFirestore_()` | オフショットDrive → `offshotDrive` コレクション |
| `syncCastToNotion()` | キャスト情報をNotionに同期 |
| `syncDriveLinksToShootingDB()` | DriveリンクをshootingDBに同期 |
| `syncShootingContact()` | 撮影連絡情報の同期 |
| `mainDailySync()` | 日次バッチ同期処理 |

---

## 10. 外部連携

### 10.1 Slack連携

#### チャンネル振り分け
- 環境変数 `SLACK_CHANNEL_INTERNAL` をデフォルトチャンネルとして使用
- オーダーの `mode` やキャストの種別に応じてチャンネルを分岐可能

#### メッセージフォーマット

**新規オーダー:**
```
<!subteam^{MENTION_GROUP_ID}>
cc: {CCメンション}

キャスティングオーダーがありました。
*内部キャストはスタンプで反応ください*

`撮影日`
・2026-02-15

`アカウント`
チームA

`作品名`
サンプルCM

`役名`
【サンプルCM】
  主役
    第1候補：<@U12345678>
    第2候補：田中太郎

`Notionリンク`
https://www.notion.so/xxxxx
```

**ステータス更新:**
```
ステータスが *決定* に変更されました。
金額: ¥50,000
```

**削除通知:**
```
🗑️ *田中太郎* のキャスティングが削除されました（サンプルCM）
```

#### スレッドID (`ts`)
- 形式: `1768379900.553249` (10桁.6桁)
- Firestoreの `slackThreadTs` フィールドに保存
- 追加オーダー・ステータス更新は同一スレッドに返信

### 10.2 Googleカレンダー連携

#### 対象
- **内部キャストのみ**

#### イベント形式
| フィールド | 内容 |
|------------|------|
| `summary` | `[仮] キャスト名 / 案件名` or `キャスト名 / 案件名` |
| start/end | 撮影日（終日イベント） |

#### ステータス変更時の処理

| 新ステータス | カレンダー処理 |
|---|---|
| OK / 決定 | `[仮]` プレフィックスを削除 |
| NG / キャンセル | イベント削除 |
| 削除 | イベント削除 |

### 10.3 Notion連携

- 撮影スケジュール（`shootings` コレクション）のデータソース
- ステータスがOK/決定時にNotionへキャスト情報を同期
- GAS経由での定期同期

---

## 11. ビジネスロジック

### 11.1 オーダー作成フロー

1. **日付選択** → カレンダーで撮影日を選択
2. **撮影選択**（任意）→ Notionから同期された撮影案件を選択
3. **キャスト選択** → フィルタリング → カートに追加
4. **カートモーダル** → プロジェクト/役にキャストをドラッグ&ドロップ
5. **確認** → PDF添付（任意）→ 送信
6. **Firestore書き込み** → `castings` コレクションにドキュメント作成
7. **Cloud Function呼出** → Slack通知 + カレンダー登録
8. **Firestore更新** → `slackThreadTs` / `slackPermalink` を書き戻し

### 11.2 ステータス変更フロー

1. ステータスバッジクリック → ステータス変更モーダル
2. 新ステータス選択 + 金額/メッセージ入力
3. Firestore `castings/{id}` 更新
4. Cloud Function `notifyStatusUpdate` 呼出
5. **OK/決定の場合:**
   - 外部キャスト → `shootingContacts` に自動追加（重複チェック付き）
   - `castMaster` に履歴追加
   - Notion同期

### 11.3 中長編 (Feature Film) 検出

- `startDate ≠ endDate` のキャスティングを中長編として自動分類
- `shootingDates` フィールドで個別参加日を管理
- キャスティング状況の「中長編」タブで表示

### 11.4 撮影連絡DB自動追加

- トリガー: ステータスが「決定」or「OK」に変更
- 条件: **外部キャストのみ**
- 重複チェック: 同一 `castingId` が既存の場合スキップ
- 初期ステータス: `香盤連絡待ち`

### 11.5 撮影連絡フェーズ進行

```
香盤連絡待ち → 発注書送信待ち → メイキング共有待ち → 投稿日連絡待ち → 完了
```

---

## 12. ステータス定義

### 12.1 キャスティングステータス (`CastingStatus`)

| ステータス | 色 | 説明 |
|-----------|-----|------|
| 仮押さえ | グレー (`bg-gray-200`) | 日程を仮確保 |
| 仮キャスティング | グレー | 内部キャストの仮確定 |
| 打診中 | 青 (`bg-blue-200`) | 事務所に打診中 |
| オーダー待ち | 紫 (`bg-purple-200`) | オーダー発行待ち |
| オーダー待ち（仮キャスティング） | 紫 | 仮キャスティング付きオーダー待ち |
| OK | 薄緑 (`bg-green-200`) | 事務所からOK回答 |
| 決定 | 濃緑 (`bg-green-500 text-white`) | 正式決定 |
| 条件つきOK | オレンジ (`bg-orange-200`) | 条件付きOK |
| NG | 赤 (`bg-red-500 text-white`) | 不可 |
| キャンセル | 濃グレー (`bg-gray-400 text-white`) | キャンセル |

### 12.2 撮影連絡ステータス (`ShootingContactStatus`)

| ステータス | 説明 |
|-----------|------|
| 香盤連絡待ち | IN/OUT時間・場所の連絡待ち |
| 発注書送信待ち | 発注書の作成・送信待ち |
| メイキング共有待ち | メイキングURL共有待ち |
| 投稿日連絡待ち | SNS投稿日の連絡待ち |
| 完了 | 全工程完了 |

---

## 13. 環境変数

### 13.1 フロントエンド (`.env.local`)

| 変数 | 説明 |
|------|------|
| `VITE_FIREBASE_API_KEY` | Firebase API Key |
| `VITE_FIREBASE_AUTH_DOMAIN` | Firebase Auth Domain |
| `VITE_FIREBASE_PROJECT_ID` | Firebase Project ID |
| `VITE_FIREBASE_STORAGE_BUCKET` | Firebase Storage Bucket |
| `VITE_FIREBASE_MESSAGING_SENDER_ID` | Firebase Messaging Sender ID |
| `VITE_FIREBASE_APP_ID` | Firebase App ID |

### 13.2 Cloud Functions (`functions/.env` or Secret Manager)

| 変数 | 説明 |
|------|------|
| `SLACK_BOT_TOKEN` | Slack Bot User OAuth Token (`xoxb-...`) |
| `SLACK_CHANNEL_INTERNAL` | 内部通知用Slackチャンネル |
| `SLACK_MENTION_GROUP_ID` | メンション対象グループID |
| `GOOGLE_SERVICE_ACCOUNT_KEY` | Google サービスアカウントJSON |
| `GOOGLE_CALENDAR_ID` | Google Calendar ID |
| `NOTION_TOKEN` | Notion API Token |

---

**End of Document**
