# Casty 全機能オーバービュー

この資料は Casty（gokko のキャスティング管理 SPA）の機能を横断的に見るためのもの。
「どの画面から何ができるか」「それが裏で何を叩いているか」「どこを見ればデバッグできるか」
を一枚で把握できることを目的にしている。

最終更新: 2026-04-15（Claude による棚卸し）

---

## 0. システム構成（30 秒サマリ）

```
┌──────────────────────────────────────────────────────────────────────┐
│ Vue 3 SPA  (Firebase Hosting: gokko-casty.web.app)                    │
│   ├ views/        画面                                                │
│   ├ composables/  フロント側ロジック（Firestore 直接読み書きの主力）  │
│   └ stores/       Pinia（カート状態 など）                            │
└──────────────────────────────────────────────────────────────────────┘
                     │                          ▲
                     │ Firestore SDK            │ CF httpsCallable
                     ▼                          │
┌─────────────────┐  ┌────────────────────────────────────────────────┐
│  Firestore      │  │  Cloud Functions (asia-northeast1)             │
│  (gokko-casty)  │◀─┤  Slack / Google Calendar / Notion / Drive 連携  │
└─────────────────┘  └────────────────────────────────────────────────┘
                     │
                     ▼
           ┌──────────────────────┐  ┌──────────────────────┐
           │ Slack (bot token)    │  │ gokko-sam (別プロジェクト)│
           │ Google Calendar      │  │ notionSchedule → 同期     │
           │ Notion DB            │  └──────────────────────┘
           └──────────────────────┘
```

- **フロント**: Firestore を直接叩く（ステータスやマスタ管理）／通知系は CF 経由
- **Cloud Functions**: 副作用が外部に出るもの（Slack 投稿、カレンダー作成、Notion 同期、DM）は全部ここ
- **gokko-sam**: 撮影スケジュールのソース。`syncScheduleFromSam` が 2 時間毎に pull

---

## 1. ルート一覧

| パス | 表示名 | View | 権限 | 用途 |
|---|---|---|---|---|
| `/` | — | HomeView | 全員 | ランディング |
| `/casting` | キャストを探す | CastingView | 全員 | **メイン画面** キャスト検索 → カート → オーダー |
| `/casting-status` | キャスティング状況 | CastingStatusView | 全員 | **運用画面** 全キャスティングのステータス管理 |
| `/status` | — | StatusView | 全員 | プレースホルダ（未実装、削除候補） |
| `/shooting-contact` | 撮影連絡DB | ShootingContactView | admin | 外部キャスト決定後の連絡管理（5 段階） |
| `/management` | 管理画面 | ManagementView | admin | メールテンプレ / 履歴 / 管理者 / スタッフメンション |
| `/setup-test` | — | SetupTestView | 全員 | 開発用テストデータ投入 |
| `/help` | ヘルプ | HelpView | 全員 | アコーディオン式の使い方 |

---

## 2. 画面別の機能と裏で動くもの

### 2-1. CastingView（`/casting`）

**ユーザーができること:**
- カレンダーで撮影日を選択
- その日の撮影案件を表示 → 選択 or 新規外部案件 / 社内イベント作成
- キャスト検索（キーワード／性別／事務所／ソート: 出演回数・50音）
- キャスト詳細（画像・年齢・競合情報）、カートへ追加
- 未成年警告、衣装インティマシー警告
- 発注書 PDF アップロード
- オーダー送信（確認ダイアログで親切さ・競合情報を入力）
- 既存オーダーあり → 追加オーダー or 新規スレッド選択ポップオーバー

**裏で動く:**
- `useShootings` → `shootings` コレクション全件取得＋クライアントフィルタ
- `useCasts` → `casts` 全件
- `useAvailability` → 選択日の `castings` を引いて「このキャストはその日すでに他の案件で押さえられている」判定
- **オーダー送信**: `useOrders.submitOrder()` → Firestore `castings` に batch write →
  `notifyOrderCreated` CF → Slack 投稿 + Calendar 作成（内部のみ） + Firestore に `slackThreadTs` / `calendarEventId` 書き戻し →
  OAuth トークンでフロントから Calendar attendees 追加

**外部モード/社内モード時の追加処理:**
- `useOrders` が直接 `shootingContacts` と `castMaster` にも書き込み（外部キャストのみ）

---

### 2-2. CastingStatusView（`/casting-status`）

**ユーザーができること:**
- タブ切替（全て / 撮影 / イベント / フィーチャー）
- 月選択、過去案件表示トグル、オーダー待ちのみ表示
- ビューモード: 日付グループ / プロジェクトグループ
- ステータス変更（条件付きOK時は説明必須）
- 一括選択モードで複数まとめてステータス変更
- 「スレッドts修復」ボタン、「カレンダー再生成」ボタン（個別＋一括）
- オーダー待ちメール送信
- サマリーダイアログ

**裏で動く:**
- `useCastings.fetchCastings()` → `castings` コレクション
- ステータス変更: `useCastings.updateCastingStatus()` → Firestore update → `notifyStatusUpdate` CF →
  Slack 返信 + Calendar 更新 + Notion 同期 + shootingContacts 自動追加（決定時）
- 削除: `deleteCastingCleanup` CF → Calendar 削除 + Slack 削除通知
- 修復: `repairCastingThread` / `regenerateCalendarEvent` CF
- 特別オーダー編集: `notifyOrderUpdated` CF → Slack 返信 + Calendar 更新 + castMaster/shootingContacts cascade

---

### 2-3. ShootingContactView（`/shooting-contact`）

**ユーザーができること:**
- 5 タブ: 香盤連絡待ち / 発注書送信待ち / メイキング共有待ち / 投稿日連絡待ち / 完了
- 日付グループ / プロジェクトグループ表示
- 香盤同期ボタン（`shootingDetails` から IN/OUT/場所を反映）
- メイキング同期ボタン（`offshotDrive` から URL 反映）
- 各行: メール編集・送信、PDF 発注書生成（v1/v2 フォーマット）
- ステータス進行・戻し

**裏で動く:**
- `useShootingContact` → `shootingContacts` コレクション CRUD
- 香盤同期: クライアント側で `shootingDetails` 読み込み → 名前正規化マッチ → update
- メイキング同期: `syncDriveLinksToContacts` CF → Drive リンク取得 → `shootingContacts.makingUrl` 更新
- メール送信: クライアントで mailto スキーム生成（外部メーラー起動）
- PDF: `usePdfGenerator` で jsPDF/html2canvas を使ってクライアント生成

---

### 2-4. ManagementView（`/management`）

5 タブの管理画面（admin 限定）:

| Tab | 名称 | 内容 |
|---|---|---|
| 1 | メールテンプレート | `emailTemplates` CRUD、件名/本文のテンプレ化、デフォルトリセット |
| 2 | キャストマスターDB | `castMaster` 履歴（日付 / プロジェクト別グルーピング）、金額編集 |
| 3 | 撮影日編集 | プロジェクト名検索 → `castings` + `shootingContacts` の撮影日一括変更 |
| 4 | 管理者設定 | `admin` コレクション CRUD、有効/無効切替 |
| 5 | **スタッフメンション**（新） | `staffMentions` コレクション CRUD、CD/FD/P/衣装 などの Slack 辞書 |

**裏で動く:**
- 各 composable → 該当コレクション直接 CRUD
- 金額変更: `castMaster` → `castings` と `shootingContacts` に cascade sync
- 撮影日変更: `castings` と `shootingContacts` 両方にまたがって update（カレンダー連動トリガー）

---

### 2-5. その他の View

- **HomeView**: 2 つのクイックリンクのみ
- **HelpView**: アコーディオンで 6 セクション（使い方ガイド）
- **StatusView**: 中身なし（削除候補）
- **SetupTestView**: 開発用、テストキャスト・テスト管理者投入

---

## 3. 主要モーダル／ダイアログ

| コンポーネント | トリガー | 機能 |
|---|---|---|
| OrderTypeDialog | CastingView / 新規案件 | 外部 vs 社内イベント選択 |
| NewCastModal | CastingView / 「+ キャスト作成」 | 外部キャスト新規（Notion にも同期） |
| CastDetailDialog | CastingView / カード | キャスト詳細・カート追加 |
| OrderConfirmDialog | CastingView / 送信 | 親切さ + 競合 + 未成年確認 |
| StatusChangeModal | CastingStatusView | ステータス単体変更 |
| BulkStatusModal | CastingStatusView 一括モード | 複数まとめて変更 |
| OrderWaitEmailModal | CastingStatusView | オーダー待ちメール |
| SummaryModal | CastingStatusView | 複数キャスティング要約 |
| EmailModal | ShootingContactView | 香盤/発注書メール編集 |
| OrderPdfModal | ShootingContactView | 発注書 PDF 生成 |
| ProgressModal | CF 呼び出し中 | 進捗バー |

---

## 4. 裏で動く全 Cloud Functions

| 関数 | 種別 | 役割 |
|---|---|---|
| `notifyOrderCreated` | onCall | オーダー送信 → Slack + Calendar（内部）+ 書き戻し |
| `notifyStatusUpdate` | onCall | ステータス変更 → Slack 返信 + Calendar 更新 + Notion + shootingContacts |
| `notifyBulkStatusUpdate` | onCall | 一括ステータス変更の Slack 通知 |
| `notifyOrderUpdated` | onCall | 特別オーダー編集 → Slack 返信 + Calendar 更新 + cascade |
| `regenerateCalendarEvent` | onCall | `calendarEventId` 失踪時の再生成（内部キャストのみ） |
| `repairCastingThread` | onCall | `slackThreadTs` 失踪時の復旧（URL 手動 / 兄弟借用 / history検索） |
| `deleteCastingCleanup` | onCall | 削除 → Calendar 削除 + Slack 削除通知 |
| `sendPromotionDm` | onCall | 次候補昇格時の内部キャスト DM |
| `createNotionCast` | onCall | Notion キャスト DB への追加 |
| `getShootingDetails` / `syncShootingDetailsToContacts` | onCall | 香盤 DB 同期 |
| `syncDriveLinksToContacts` | onCall | メイキング Drive リンク同期 |
| `syncScheduleFromSam` | onCall | gokko-sam → shootings 手動同期 |
| `scheduledSyncFromSam` | onSchedule | 同じものを 2 時間毎に自動実行 |
| `handleSlackInteraction` | onRequest | Slack ボタン webhook（cast_ok 等） |

### 共通ヘルパ（CF 内）

- `lookupSlackIdByName(name)` — **検索順**: casts → admin（完全一致）→ admin（正規化全件スキャン）→ **staffMentions（5 分キャッシュ）** → Slack users.list（10 分キャッシュ）
- `normalizeName(name)` — 空白除去 + 末尾敬称除去 + 小文字化
- `splitNameList(str)` — 名前リスト分割（`,`／`、`／`，`／`/`／`／`／`・`／改行／タブ）
- `resolveSlackChannel(casting)` — slackChannel > permalink抽出 > `SLACK_CHANNEL_INTERNAL`
- `fetchSlackUsersCached()` — users.list の 10 分キャッシュ
- `fetchStaffMentionsCached()` — staffMentions の 5 分キャッシュ

---

## 5. Firestore コレクション一覧

| コレクション | 主なドキュメント | 書き手 |
|---|---|---|
| `casts` | キャスト名簿 | admin UI + `createNotionCast` CF + GAS |
| `castings` | 個別キャスティング（作品×キャスト×日付の単位） | `useOrders` + `useCastings` + 各 CF |
| `shootings` | 撮影案件マスタ | `syncScheduleFromSam` CF（gokko-sam → pull） + GAS |
| `shootingContacts` | 撮影連絡DB（外部キャスト決定後） | `useShootingContact` + `useCastings`（自動追加） + `notifyOrderUpdated` |
| `shootingDetails` | 香盤（IN/OUT/場所） | GAS（from Notion） |
| `castMaster` | 決定キャスティングの履歴 | `useCastMaster.addToCastMaster()` + `useOrders`（外部モード） |
| `admin` | 管理者＋ログインユーザー | `useAdmins` |
| `staffMentions` | CD/FD/P/衣装の Slack 辞書（新） | `scripts/import-staff-mentions.cjs` + `useStaffMentions`（UI） |
| `emailTemplates` | メールテンプレ | `useEmailSettings` |
| `offshotDrive` | メイキング Drive リンク | GAS |
| （CF が読む）`gokko-sam.notionSchedule` | 撮影スケジュールのソース | gokko-sam 側で Notion → pull |

---

## 6. データフロー早見表

### オーダー送信（撮影モード）

```
CastingView
  └ useOrders.submitOrder()
      ├ Firestore: castings に batch write                              ← 成功すれば DB に載る
      │
      ├ （外部/社内のみ）shootingContacts + castMaster にも書き込み
      │
      └ CF: notifyOrderCreated
          ├ Slack 投稿（shootingMode で cc 欄に CD/FD/P/衣装 を lookup）
          ├ Calendar 作成（内部キャストのみ、castings.calendarEventId に書き戻し）
          └ Firestore: slackThreadTs / calendarEventId 書き戻し
      ↓
      戻り値で受け取った calendarResults[] を使い
      useGoogleCalendar.addAttendeeToCalendarEvent() で attendees 追加（ユーザーOAuth）
```

### ステータス変更

```
CastingStatusView
  └ useCastings.updateCastingStatus()
      ├ Firestore: castings 単体 update
      └ CF: notifyStatusUpdate
          ├ Slack: 元スレッドに返信（欠落時は history 検索で復旧）
          ├ Calendar: 状態に応じて更新 / 削除
          ├ Notion: OK/決定時にキャスト DB 同期
          └ shootingContacts: 外部 × 決定時に自動追加
```

### 新規外部キャスト作成

```
CastingView → NewCastModal
  └ useCasts.createCast()
      ├ Firestore: casts に create
      └ CF: createNotionCast → Notion キャストDB にページ作成
```

---

## 7. 認証フロー

- **サインイン**: Google OAuth ポップアップ（`signInWithPopup`）
- **admin 判定**: `admin` コレクションで email 完全一致 + `active: true`
- **OAuth アクセストークン**: セッションストレージに保存、1 時間で切れるのでカレンダー attendees 追加時に再取得
  - `getAccessToken()` を呼ぶと再度ポップアップが開く（COOP 警告は無害）

---

## 8. デプロイ

- **フロント**: `npx vite build` → `firebase deploy --only hosting`
  - `vue-tsc` は pre-existing 型エラーで止まるので直接 vite build を使っている
- **Cloud Functions**: `cd functions && npm run build` → `firebase deploy --only functions:関数名`
  - シークレットは Firebase Secret Manager 管理（`firebase functions:secrets:access KEY`）

---

## 9. デバッグ観点（クイックインデックス）

| 症状 | まずここ |
|---|---|
| オーダーが飛ばない | `useOrders.ts :: submitOrder`、ブラウザコンソールで `[CF FAILED]` |
| Slack 投稿は来たのにメンションされない | Firestore の `staffMentions` / `admin` / `casts` に該当者の `slackMentionId` があるか |
| カレンダーイベントが作られない | 内部キャスト？ `castings.calendarEventId` は？ CF ログで `[regenerateCalendar]` / `Calendar check:` |
| ステータスを変えたのに Slack が来ない | `castings.slackThreadTs` が空 → `repairCastingThread` で復旧、または `notifyStatusUpdate` CF の `StatusRecovery` ログ |
| スレッド違いのところに飛んだ | `useOrders.checkExistingProject` のフィルタ（削除済み/キャンセル/NG 除外）と projectId 一致 |
| shootingContacts に入らない | 外部キャスト？ 決定ステータス？ `useCastings.updateCastingStatus()` と `notifyStatusUpdate` CF の auto-add ロジック |

詳細は `docs/TROUBLESHOOTING.md` も参照。

---

## 10. まだ触っていない／整理候補

- `StatusView`（`/status`）— 中身なし。削除か、CastingStatusView へ統合
- `src/stores/cartStore.ts` — レガシーカート。`orderStore` に統合してよいはず
- `useGoogleCalendar.ts` の `createEvent` / `updateEventTitle` / `deleteEvent` — no-op（CF 側で実行）、後方互換コメントあり → 削除してよい
- `HelloWorld.vue` / `StatusChangeDialog.vue` — 未使用の残骸

FB／改善提案の詳細は `docs/REVIEW_FINDINGS.md` を参照。
