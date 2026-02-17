# セッション引き継ぎメモ

> **最終更新**: 2026-02-14
> **ブランチ**: 現在のワーキングブランチ（未push）

---

## 📋 今回のセッションで実施した内容

### 1. キャスティング状況ページ 4タブ化
**変更ファイル**: `src/composables/useCastings.ts`, `src/views/CastingStatusView.vue`, `src/types/index.ts`

- 旧: 2タブ（`normal` / `special`）
- 新: 4タブ（`all` / `shooting` / `event` / `feature`）

| タブ | 表示名 | 判別ロジック |
|------|--------|-------------|
| `all` | 全体 | フィルタなし |
| `shooting` | 撮影 | `!isSpecial && startDate === endDate` |
| `event` | 社内イベント・外部案件 | `accountName ∈ ['外部案件', '社内イベント']` |
| `feature` | 中長編 | `!isSpecial && startDate !== endDate`（自動判別）|

### 2. 中長編（複数日撮影）対応
- `Casting` 型に `shootingDates?: string[]` フィールド追加
- `getFeatureGroupedCastings()`: 作品単位でグルーピング、日程マトリクス表示
- `useOrders.ts`: 複数日オーダー（`dateRange` に `~` 含む）時に `shootingDates` 配列を自動生成

### 3. 日付/作品ビュー切替
- 全体・撮影・社内イベントタブで **日付ビュー** ↔ **作品ビュー** のトグル
- `getProjectGroupedCastings()`: 作品→日付の階層でグルーピング
- UI: トグルボタン（📅日付 / 📁作品）

### 4. Cloud Functions 新規作成
**ファイル**: `functions/src/shootingDetails.ts`, `functions/src/driveSync.ts`

| 関数名 | 用途 |
|--------|------|
| `getShootingDetails` | 香盤DBからIN/OUT/場所/住所を取得 |
| `syncShootingDetailsToContacts` | 香盤DB → 撮影連絡DB一括反映 |
| `syncDriveLinksToContacts` | オフショットDriveリンクの同期（3モード） |

---

## 🏗️ プロジェクト全体のアーキテクチャ

### フロントエンド構成

```
src/
├── views/                    # ページコンポーネント（7つ）
│   ├── CastingView.vue       # キャスト選択・オーダー画面
│   ├── CastingStatusView.vue # キャスティング状況（4タブ）★今回変更
│   ├── ShootingContactView.vue # 撮影連絡DB管理
│   ├── StatusView.vue        # 簡易ステータス確認
│   ├── ManagementView.vue    # 管理画面
│   ├── HomeView.vue          # ホーム
│   └── SetupTestView.vue     # 初期設定テスト
│
├── components/               # UIコンポーネント（25個）
│   ├── cart/                  # カート関連（CartSidebar, CartProjectList等）
│   ├── cast/                  # キャストカード・詳細
│   ├── casting/               # キャスティング状況リスト・フィルタ
│   ├── common/                # メール・PDF・サマリモーダル
│   ├── contact/               # 撮影連絡カード
│   ├── shooting/              # 撮影リスト
│   └── status/                # 一括変更バー・モーダル
│
├── composables/               # ビジネスロジック（15個）
│   ├── useCastings.ts         # ★核心: キャスティングCRUD + 4タブフィルタ + グルーピング
│   ├── useOrders.ts           # オーダー送信フロー
│   ├── useCasts.ts            # キャストマスタ管理
│   ├── useShootingContact.ts  # 撮影連絡CRUD
│   ├── useShootings.ts        # Notion撮影予定
│   ├── useSlack.ts            # Slack通知
│   ├── useGoogleCalendar.ts   # Googleカレンダー連携
│   ├── useNotion.ts           # Notion同期
│   ├── useAvailability.ts     # 空き状況確認
│   └── ... (他5つ)
│
├── stores/                    # Pinia ストア
│   ├── orderStore.ts          # オーダー状態管理（カート・プロジェクト・日程）
│   └── cartStore.ts           # カート状態
│
└── types/index.ts             # 型定義（Cast, Casting, ShootingContact等）
```

### Cloud Functions 構成

```
functions/src/
├── index.ts              # エントリポイント + 3つの主要CF
│   ├── notifyOrderCreated     # オーダー送信 → Slack通知 + カレンダー作成
│   ├── notifyStatusUpdate     # ステータス変更 → Slack返信 + カレンダー更新 + Notion同期
│   └── deleteCastingCleanup   # 削除 → カレンダー削除 + Slack通知
├── slack.ts              # Slack API ヘルパー
├── calendar.ts           # Google Calendar API ヘルパー
├── notion.ts             # Notion API ヘルパー
├── shootingDetails.ts    # ★新規: 香盤DB連携
└── driveSync.ts          # ★新規: Driveリンク同期
```

### GAS（Google Apps Script）

```
gas.gas                   # メインGAS（統合ファイル）
├── syncCastToNotion()         # キャスト→Notion同期
├── syncDriveLinksToShootingDB() # Driveリンク→撮影連絡DB同期
├── syncShootingContact()      # 香盤DB→撮影連絡DB転記
├── mainDailySync()            # 日次Notion同期トリガー
├── syncShootScheduleFromNotion() # Notion撮影予定→Firestore
├── buildCastShootCalendar()   # キャスト撮影カレンダー構築
├── checkAndNotify()           # オフショット通知チェック
└── enrichOffshotData()        # オフショットデータ拡充

gas/sync_to_firestore.gs  # Firestore同期専用GAS
├── syncShootingDetailsToFirestore_() # 香盤DB→Firestore
└── syncOffshotDriveToFirestore_()    # オフショットDrive→Firestore
```

---

## 💾 Firestore データ構造

### `castings` コレクション（メインDB）

```typescript
{
  id: string                    // ドキュメントID（自動生成）
  castId: string                // キャストマスタへの参照
  castName: string
  castType: '内部' | '外部'
  accountName: string           // クライアント名
  projectName: string           // 作品名
  projectId: string             // Notion Page ID
  roleName: string              // 役名
  startDate: Timestamp
  endDate: Timestamp
  startTime?: string            // "HH:mm"（イベント用）
  endTime?: string
  rank: number                  // 候補順位
  status: CastingStatus         // '仮押さえ' | 'オーダー待ち' | 'OK' | '決定' | 'NG' | ...
  note: string
  mainSub: 'メイン' | 'サブ' | 'その他'
  cost: number
  slackThreadTs: string
  slackPermalink: string
  calendarEventId: string
  dbSentStatus: '済' | ''
  shootingDates?: string[]      // 中長編用: ['2026-02-14', '2026-02-15', ...]
  createdBy: string             // ⚠️ 現在 'current-user' ハードコード
  updatedBy: string
  createdAt: Timestamp
  updatedAt: Timestamp
}
```

### スプレッドシート列との対応

| SS列 | Firestoreフィールド | 状態 |
|------|---------------------|------|
| A: CastingID | `id` | ✅ |
| B: アカウント | `accountName` | ✅ |
| C: 作品名 | `projectName` | ✅ |
| D: 役名 | `roleName` | ✅ |
| E: CastID | `castId` | ✅ |
| F: キャスト名 | `castName` | ✅ |
| G: 開始日 | `startDate` | ✅ |
| H: 終了日 | `endDate` | ✅ |
| I: 候補順位 | `rank` | ✅ |
| J: ステータス | `status` | ✅ |
| K: 備考 | `note` | ✅ |
| L: SlackThreadTS | `slackThreadTs` | ✅ |
| M: SlackPermalink | `slackPermalink` | ✅ |
| N: メイン/サブ | `mainSub` | ✅ |
| O: CalenderEventID | `calendarEventId` | ✅ |
| P: ProjectID | `projectId` | ✅ |
| Q: 最終更新 | `updatedAt` | ✅ |
| R: 更新者 | `updatedBy` | ✅（⚠️ ハードコード） |
| S: キャス優先度 | — | ❌ 未実装 |
| T: 内部/外部 | `castType` | ✅ |
| U: メール | — | Cast側で管理 |
| V: 金額 | `cost` | ✅ |
| W: JSON | — | ❌ structureData未保存 |

### 他のコレクション

| コレクション | 用途 | 管理元 |
|-------------|------|--------|
| `casts` | キャストマスタ | Vue CRUD |
| `shootingContacts` | 撮影連絡DB | Vue + CF |
| `castMaster` | キャスティングマスタ（出演実績） | Vue自動追加 |
| `shootings` | 撮影予定（Notion由来） | GAS同期 |
| `shootingDetails` | 香盤DB（IN/OUT/場所） | GAS同期 |
| `offshotDrive` | オフショットDriveリンク | GAS同期 |

---

## ⚡ オーダーフローの仕組み

### フロー概要

```
CastingView.vue で日程・キャスト選択
    ↓
orderStore.ts に状態保存（mode, dateRanges, projects, castPool）
    ↓
CartSidebar.vue でオーダー確認
    ↓
useOrders.ts → submitOrder()
    ↓
1. Firestore batch write → castings コレクションに保存
2. Cloud Function呼び出し → notifyOrderCreated
    ↓
CF側: Slack通知 + カレンダー作成 + castingsにslackThreadTs書き戻し
```

### パターン別の保存形式

**① 1日撮影**: `dateRanges: ['2026-02-14']`
→ キャスト × 1 = 1ドキュメント（startDate === endDate）

**② 複数日程（イベント等）**: `dateRanges: ['2026-02-14', '2026-02-16']`
→ キャスト × 日程数 = 複数ドキュメント（各日 startDate === endDate）

**③ 中長編**: `dateRanges: ['2026-02-14~2026-02-18']`
→ キャスト × 1 = 1ドキュメント（startDate ≠ endDate, shootingDates自動生成）

---

## 🔴 未実装・要対応事項

### 優先度: 高

| 項目 | 詳細 |
|------|------|
| **`updatedBy` ユーザー認証** | 現在 `'current-user'` ハードコード → Firebase Auth連携必要 |
| **Slackスレッド検索フォールバック** | `slackThreadTs` 紛失時の3段階復元ロジック |
| **W列 JSON (structureData)** | オーダー構成JSONの保存（追加オーダーで利用） |

### 優先度: 中

| 項目 | 詳細 |
|------|------|
| **外部オーダー連携メール招待** | カレンダーイベントに追加メール招待 |
| **キャスト出演回数自動更新** | `Cast.appearanceCount` の集計 |
| **プロジェクト名一括変更CF** | バッチ更新Cloud Function |

### 優先度: 低

| 項目 | 詳細 |
|------|------|
| **PDF一括生成** | サーバーサイドPDF生成 |
| **Cloud Scheduler** | GASトリガー代替の定期実行 |
| **メール送信CF** | 撮影連絡メールのサーバーサイド送信 |

---

## 🔧 ビルド・デプロイ

```bash
# フロントエンドビルド確認
npx vue-tsc --noEmit       # 型チェック
npm run build               # プロダクションビルド

# Cloud Functions ビルド確認
cd functions && npx tsc --noEmit

# デプロイ
firebase deploy --only hosting    # フロントエンド
firebase deploy --only functions  # Cloud Functions
```

### 環境変数（Cloud Functions）

```
SLACK_BOT_TOKEN
SLACK_CHANNEL_INTERNAL
GOOGLE_SERVICE_ACCOUNT_KEY
GOOGLE_CALENDAR_ID
NOTION_TOKEN
```

---

## 📝 関連ドキュメント

| ファイル | 内容 |
|---------|------|
| `docs/VUE_MIGRATION_SPEC_V2.md` | 元の移行仕様書（旧バックエンド構成記載） |
| `docs/COMPLETE_SYSTEM_SPECIFICATION.md` | システム全体仕様 |
| `docs/VUE_IMPLEMENTATION_INSTRUCTIONS.md` | 実装指示書 |
| `docs/CART_WORKFLOW_SPEC.md` | カートワークフロー仕様 |
| `SLACK_NOTIFICATION_SPEC.md` | Slack通知仕様 |
| `VUE_BEHAVIOR_CORRECTIONS.md` | 動作修正メモ |
