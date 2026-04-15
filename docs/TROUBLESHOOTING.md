# トラブルシューティングガイド

オーダー / Slack / カレンダー / ステータス連携でエラーが出たとき、どこを見ればいいかをまとめたマップ。

---

## 1. オーダー送信の全体フロー

```
ユーザーが「オーダーを送信」クリック
  ↓
CastingView.vue  (src/views/CastingView.vue)
  ├─ handleSubmitOrder()     既存スレッド確認 → executeSubmit
  └─ executeSubmit()         submitOrder を呼ぶだけ
  ↓
useOrders.ts  (src/composables/useOrders.ts) ← オーダー送信の中心
  ├─ prepareOrderPayload()       カート → OrderPayload に変換
  ├─ batch.commit()              Firestore に castings ドキュメント作成
  ├─ （external/internal のみ） shootingContacts / castMaster へ自動追加
  │     ※ addFromCasting / addToCastMaster は setup 段階で取得済み
  │       （= useShootingContact() / useCastMaster() を submitOrder 内で呼ばない）
  └─ httpsCallable('notifyOrderCreated')
        ↓ Cloud Function
        functions/src/index.ts :: notifyOrderCreated
          ├─ Slack 投稿         → functions/src/slack.ts
          ├─ カレンダー作成（内部キャストのみ） → functions/src/calendar.ts :: createCalendarEvent
          └─ castings を update（slackThreadTs / calendarEventId 書き戻し）
        ↓
useOrders.ts が返ってきた calendarResults を使って
  useGoogleCalendar.ts :: addAttendeeToCalendarEvent() で attendees 追加（ユーザーOAuth）
```

**重要:** Firestore 書き込みは submitOrder 側、Slack 投稿とカレンダー作成は Cloud Function 側。
Firestore 書き込みまで成功していても、CF 呼び出しに到達しなかった・失敗した場合は
**DB にオーダーは存在するのに Slack/カレンダーには反映されていない** 状態になる。

---

## 2. エラー → 見るべきファイル

### 「Order submission error: Error: No PrimeVue Toast provided!」

- **原因:** PrimeVue の `useToast()` は Vue の `inject()` ベースで動いており、
  コンポーネントの setup 段階（同期的な初期化フェーズ）でのみ呼び出せる。
  `await` を挟んだ後の非同期コンテキストから呼ぶと「Toast provider がない」と判定される。
- **過去の発生パターン:** `submitOrder` 内の `await batch.commit()` 後に
  `useShootingContact()` / `useCastMaster()` を呼んでいた（この 2 つは内部で `useToast()` を呼ぶ）。
- **症状:** DB にはキャスティングが書き込まれるが、CF 呼び出し前の catch に飛ぶため
  Slack もカレンダーも作成されない。ユーザー画面では「エラー」トーストだけが出る。
- **見るべきファイル:** `src/composables/useOrders.ts` :: `useOrders()`
  setup 段階で `useShootingContact()` / `useCastMaster()` を取得しているか確認。
- **ルール:** `useToast()` を呼ぶ composable は、別の composable / 関数から呼ぶときも
  必ず setup フェーズで destructure してから使うこと。`async` 関数内で `use***()` を呼ばない。

### 「regenerateCalendarEvent failed: FirebaseError: INTERNAL」

- **原因候補:**
  1. Service Account がカレンダーにアクセスできない（`calendars.get` で 403）
  2. Service Account キーまたは `GOOGLE_CALENDAR_ID` が未設定 / 不正
  3. `startDate` が Firestore に保存されていない、あるいは Timestamp ではない
  4. Calendar API の一時的な失敗 / rate limit
- **見るべきファイル:**
  - `functions/src/index.ts` :: `regenerateCalendarEvent`（1157行付近）
  - `functions/src/calendar.ts` :: `createCalendarEvent`
- **確認方法:**
  ```bash
  # CF ログで具体的なエラーを確認
  firebase functions:log --only regenerateCalendarEvent -n 50
  ```
  2026-04 以降は `HttpsError("internal", "カレンダー作成に失敗: ...")` として
  具体的なメッセージがフロント側トーストに出るようになっている。
- **注意:** `castType !== "内部"` のキャスティングでは **そもそも呼び出さない**
  （CF 側で `failed-precondition` を返す）。一括再生成ボタンは内部キャストのみにフィルタしている。

### 「Cross-Origin-Opener-Policy policy would block the window.closed call.」

- これは **エラーではなく警告**。Firebase Auth の `signInWithPopup` が
  OAuth 用ポップアップの閉じ状態をポーリングしようとして、ブラウザの COOP ポリシーに
  ブロックされているだけ。ログイン自体は成功する。
- 無視してよい。

### 「オーダーの送信中にエラーが発生しました」（一般トースト）

- `useOrders.ts :: submitOrder` の catch ブロックがキャッチした例外。
- コンソールに `Order submission error:` で始まる行があるはずなので、その後続メッセージを見る。
- Firestore 書き込み（`batch.commit()`）まで成功しているかは
  Firestore の `castings` コレクションを直接確認すること。
  書き込み済みなら CF 呼び出し前後の失敗、未書き込みなら prepare ～ batch.commit の失敗。

### Slack に通知が飛ばない

- `functions/src/index.ts :: notifyOrderCreated` → `functions/src/slack.ts`
- チャンネルの解決は `resolveSlackChannel` 系のヘルパ。
- シークレット: `SLACK_BOT_TOKEN`, `SLACK_CHANNEL_INTERNAL`, `SLACK_CHANNEL_EXTERNAL` など。
- 投稿失敗しても catch で握りつぶしてカレンダー処理に進む実装なので、
  「Slack だけ飛ばない」ケースは CF ログに `Slack post failed (continuing to calendar):` が残る。

### カレンダーに反映されない（内部キャストのはず）

- 順序立てて確認:
  1. `casting.castType === "内部"` か？（外部キャストはそもそもカレンダーを作らない）
  2. CF が呼ばれたか？ → Firestore の `castings` に `slackThreadTs` が入っていれば呼ばれている。
     空なら CF 呼び出し前に失敗（＝上記「No PrimeVue Toast」パターンなど）。
  3. CF ログで `Calendar check:` / `Calendar event created:` / `Calendar event failed for ...` を確認
  4. 事後復旧: キャスティング一覧の「カレンダー再生成」ボタン（内部 × `calendarEventId` 空のみ）

### ステータス更新が Slack/カレンダーに反映されない

- エントリポイントは `functions/src/index.ts :: notifyStatusUpdate`。
- 過去のデータで `slackThreadTs` が空のときは、スレッド修復機能
  （`repairCastingThread`、一覧の「スレッドts修復」ボタン）を使う。

---

## 3. ファイル責務マップ（重複の見通し）

| レイヤ | ファイル | 責務 |
|---|---|---|
| UI | `src/views/CastingView.vue` | カート・オーダー送信のトリガー |
| UI | `src/views/CastingStatusView.vue` | ステータス一覧・一括操作 |
| UI | `src/components/casting/CastingStatusList.vue` / `Table.vue` | ステータスセル操作・個別再生成ボタン |
| Composable | `src/composables/useOrders.ts` | オーダー送信（Firestore 書き込み + CF 呼び出し） |
| Composable | `src/composables/useCastings.ts` | キャスティングの CRUD・ステータス更新 |
| Composable | `src/composables/useShootingContact.ts` | 撮影連絡DB（外部キャスト決定後フロー） |
| Composable | `src/composables/useCastMaster.ts` | キャスティングマスターDB（履歴） |
| Composable | `src/composables/useGoogleCalendar.ts` | attendees 追加専用（ユーザーOAuth経由） |
| CF | `functions/src/index.ts :: notifyOrderCreated` | 新規オーダーの Slack 投稿 + カレンダー作成 |
| CF | `functions/src/index.ts :: notifyOrderUpdated` | 特別オーダー編集 |
| CF | `functions/src/index.ts :: notifyStatusUpdate` / `notifyBulkStatusUpdate` | ステータス変更通知 + カレンダー更新/削除 |
| CF | `functions/src/index.ts :: regenerateCalendarEvent` | 過去オーダーのカレンダー事後生成 |
| CF | `functions/src/index.ts :: repairCastingThread` | slackThreadTs の事後修復 |
| CF | `functions/src/index.ts :: deleteCastingCleanup` | 削除時のクリーンアップ |
| CF ヘルパ | `functions/src/slack.ts` | Slack API ラッパ |
| CF ヘルパ | `functions/src/calendar.ts` | Google Calendar API ラッパ |

### 注意している重複・近縁ロジック

- **「カレンダー作成」ロジックは `notifyOrderCreated` と `regenerateCalendarEvent` の 2 箇所に存在**
  （どちらも `createCalendarEvent` を呼ぶが、前処理のデータ抽出が独立している）。
  時刻解決・all-day フォールバックの仕様を変える際はどちらも揃えて直すこと。
- **`addFromCasting` / `addToCastMaster` の呼び出し口が複数**:
  - `useOrders.ts`（新規オーダー時、外部モード）
  - `useCastings.ts`（ステータスが「決定」になったとき）
  どちらも「外部キャストが決定ステータスになったら追加」という意図なので、
  変更時は両方を同期すること。
- **`useGoogleCalendar.ts` の `createEvent` / `updateEventTitle` / `deleteEvent` は no-op**
  （コメントにあるとおり CF 側で自動実行される）。実質的に使われているのは
  `addAttendeeToCalendarEvent` のみ。他のメソッドは後方互換用。

---

## 4. 「とりあえずここを見る」チェックリスト

1. **ブラウザのコンソール** に `Order submission error:` / `[CF FAILED]` / `[CF WARNING]` の行があるか
2. **Firestore の `castings` コレクション** でエラー対象のドキュメントを直接開き、
   `slackThreadTs` / `calendarEventId` / `status` が期待値か
3. **Cloud Function のログ** (`firebase functions:log -n 100`) で該当 CF 名を grep
4. シークレット（`SLACK_BOT_TOKEN`, `GOOGLE_SERVICE_ACCOUNT_KEY`, `GOOGLE_CALENDAR_ID` 等）が
   `firebase functions:secrets:access KEY` で取得できるか
