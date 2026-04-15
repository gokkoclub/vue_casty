# Casty レビュー所見と改善提案

`CASTY_FEATURE_OVERVIEW.md` と併せて読む資料。
全体を横断して見て気になった点を **「影響度 × 確度」** で分類し、
それぞれに「どう直すか」まで書いた。

最終更新: 2026-04-15

---

## 凡例

- **影響度**: Critical（データ破損・情報漏洩） / High（業務で詰まる） / Medium（気づいたら直したい） / Low（余裕があれば）
- **確度**: 高（コードを読んだだけで明白） / 中（運用で刺さりそう） / 低（要調査）
- **工数**: S（30 分未満） / M（半日） / L（1 日以上）

---

## 🔴 Critical

### C-1. `serviceAccountKey.json` がリポジトリに含まれている

- **場所**: `/serviceAccountKey.json`、`scripts/serviceAccountKey.json`
- **問題**: Firebase Admin SDK の秘密鍵。リポジトリが仮に公開されたり、第三者にローカルクローンされたりすると、Firestore 全件を読み書きできる権限を渡すことになる。
- **対処（工数 S）**:
  1. `.gitignore` に `serviceAccountKey.json` を追加
  2. `git rm --cached serviceAccountKey.json scripts/serviceAccountKey.json`
  3. 既に push 済みなら Firebase Console で **鍵をローテート**（新しいサービスアカウントキーを発行、古いのを revoke）
  4. `scripts/*.cjs` 側では環境変数 `GOOGLE_APPLICATION_CREDENTIALS` からロードする形に統一
- **確度**: 高

### C-2. `VITE_SLACK_BOT_TOKEN` をフロントで使うフォールバックが残っている

- **場所**: `src/composables/useOrders.ts :: sendSlackNotificationDirect`
- **問題**: CF 呼び出し失敗時のフォールバックとして `fetch('https://slack.com/api/chat.postMessage')` を `VITE_SLACK_BOT_TOKEN` 付きで直接叩いている。
  Vite のビルド時に `.env.local` 側の値がバンドルに埋め込まれる仕様なので、**本番ビルドに Bot Token が混ざる** 可能性がある。
- **対処（工数 S）**:
  - フォールバック自体を削除。CF 失敗時は Firestore に残っているのでユーザーにリトライを促すだけにする。
  - あるいは `import.meta.env.DEV` のときだけ実行、かつビルド時には除去されるようガードを入れる（`if (import.meta.env.DEV) { ... }`）。
  - `.env.local` は `.gitignore` 済みだが、もしリポに入っていれば即削除。
- **確度**: 高

---

## 🟠 High

### H-1. オーダー送信 / ステータス変更で「Firestore だけ更新されて Slack/カレンダーに反映されない」問題

- **状況**: 既に発生事例あり（社内イベント/外部案件の toast error）。構造的には CF 呼び出しが throw すると
  `castings` は batch 書き込み済み、通知は届いていない状態になる。
- **どう認識するか**:
  - `castings.slackThreadTs` が空
  - `castings.calendarEventId` が空
  - Slack を見ても投稿がない
- **対処案**:
  - **案 A（工数 M）**: CF 側に「未通知キャスティング」を探す自動リトライを仕込む（onSchedule で 5 分毎に `slackThreadTs=""` の直近 24h ドキュメントを検索 → 通知を再送）
  - **案 B（工数 S）**: UI に「このキャスティングは Slack 未通知」のバッジを出して、手動で再送ボタンを押せるようにする（既に `repairCastingThread` / `regenerateCalendarEvent` があるので、似た `resendOrderNotification` を足せば UI はほぼ流用できる）
- **推奨**: まず B、運用が大変そうなら A。
- **確度**: 高

### H-2. `useCastings.ts` が巨大で更新ロジックが密結合（1197 行）

- **場所**: `src/composables/useCastings.ts`
- **問題**:
  - `updateCastingStatus()` 1 個で「Firestore 更新 + Slack 通知 + Calendar 連動 + shootingContacts 追加 + castMaster 追加 + 競合の自動キャンセル + 次候補昇格」を担っている。
  - 新しい状態遷移ルールを入れるたびに副作用の組み合わせが爆発しうる。
- **対処（工数 L）**:
  - 「純粋な状態遷移」→ Firestore 書き込み → Cloud Function 委譲 の 3 層に分け、**副作用は CF 側に集約**。
  - 具体的には、`updateCastingStatus` は `status` の update だけ行い、CF 側 onDocumentUpdate トリガーで Slack / Calendar / Notion / 自動化を束ねる設計に寄せる。
- **確度**: 中
- **補足**: 現状でも動いてはいる。短期的な痛みが少ないなら優先度下げて OK。

### H-3. `useShootings` が全件取得＋クライアントフィルタ

- **場所**: `src/composables/useShootings.ts :: fetchShootingsByDates`
- **問題**: `shootings` コレクション全件を `getDocs` で取って、JS 側で日付フィルタしている。`shootings` は gokko-sam からの同期で増え続けるため、数年運用すると数千件になる。毎オープン数秒ラグ + ネットワーク負荷。
- **対処（工数 S）**: Firestore のクエリに `where('shootDate', '>=', startStr).where('shootDate', '<=', endStr)` を付ける。`shootDate` が YYYY-MM-DD の文字列なのでそのまま範囲クエリ可能（単一 where なら index 自動、複合なら Firestore Console で作成）。
- **確度**: 高

### H-4. `.env.local` の Slack トークン混入（再掲）と Calendar ID の扱い

- 上記 C-2 と重なる。Calendar ID もフロントから参照しているが、これは秘密情報ではないので問題なし。ただし **`VITE_CALENDAR_ID_INTERNAL` の値と CF 側 `GOOGLE_CALENDAR_ID` が一致している前提**で動いており、どこかで片方だけ変えるとバグる。**一箇所で定義したい**（どちらも環境変数で `.env` に統合する等）。

---

## 🟡 Medium

### M-1. 日付フォーマットが 3 種類混在（YYYY-MM-DD / YYYY/MM/DD / Timestamp）

- **場所**: `useOrders.ts`（/）、`useShootings.ts`（-）、`utils/dateUtils.ts`（Timestamp 変換）
- **問題**: コレクションごとに形式が違い、変換コードが複数箇所にコピペされている。タイムゾーン境界バグが出やすい。
- **対処（工数 M）**:
  - 内部表現は **Timestamp** に統一。表示用の変換（`formatForInput` / `formatForDisplay`）を `utils/dateUtils.ts` に集約し、それ以外の場所では日付を文字列で持たない。
- **確度**: 中

### M-2. `normalizeName` と名前マッチングの甘さ

- **場所**: `functions/src/index.ts :: normalizeName`、`shootingDetails.ts :: normalizeCastName`
- **問題**: 2 箇所で「名前正規化」ルールが**違う**実装になっている（index.ts は敬称を末尾のみ、shootingDetails は `[様さんサン]+$` の 1 種類のみ）。片方のバグは片方に波及しない。
- **対処（工数 S）**:
  - `functions/src/utils/normalize.ts` を作って `normalizeName` を共通化
  - 併せてカナ/半カナ/Unicode 正規化（NFKC）を入れると精度が上がる:
    ```ts
    name.normalize("NFKC").replace(/\s+/g, "").replace(/(様|さま|さん|殿|氏|ちゃん|君|くん)$/u, "").toLowerCase()
    ```
- **確度**: 高

### M-3. `useToast()` を async 内で呼んでいないかの恒常監視

- **場所**: 今は `useOrders.ts` 1 箇所だけ直したが、類似のパターンが増えたときに気付けない。
- **対処（工数 S）**: ESLint カスタムルール or grep で CI に 1 行入れる:
  ```bash
  ! grep -rP 'await.*\n.*useToast|use(Shooting|Cast|Slack|Email|Pdf|Notion|Admins)' src/composables src/views --include='*.ts' --include='*.vue' -U
  ```
  CLAUDE.md / TROUBLESHOOTING.md にルールは書いた。

### M-4. `castingData: any` で Firestore write

- **場所**: `useOrders.ts:470`
- **問題**: 型チェックが効かない。`shootingDates` や `competitionType` の追加プロパティでタイポするとランタイム失敗。
- **対処（工数 S）**: `Casting` 型に Optional プロパティを足して、`Partial<Casting>` で受ける形にする。

### M-5. `functions/src/index.ts` が 1700 行超

- **問題**: 可読性が落ちている。同じ復旧ロジックが `notifyOrderCreated` / `notifyStatusUpdate` / `repairCastingThread` の 3 箇所に近い形でコピーされている。
- **対処（工数 M）**:
  - `functions/src/` の下に `lib/slackThreadRecovery.ts`、`lib/mentionLookup.ts` を作って切り出し
  - 各 onCall の本体は 50 行程度に収める
- **確度**: 高

### M-6. トランザクション不在による複数 collection 更新の不整合

- **場所**:
  - `notifyStatusUpdate` で Notion 同期後に `shootingContacts` 追加
  - `notifyOrderUpdated` で `castMaster` と `shootingContacts` の cascade update
- **問題**: 片方が失敗すると **Notion には反映されたのに DB には反映されていない** 状態が残る。catch で握りつぶしているのでユーザーは気付けない。
- **対処（工数 M）**:
  - Firestore 内の write は `runTransaction` で atomic にまとめる
  - 外部 API（Notion）は別レイヤーにして「成功したら Firestore を `notionSyncedAt: serverTimestamp()` でマーク」
  - 失敗時のアラートチャンネルを Slack に 1 本用意して、握りつぶさず通知を飛ばす

### M-7. Slack ボタンの cast_ok が即座に 200 を返して後続をバックグラウンド実行

- **場所**: `functions/src/slackInteraction.ts`
- **問題**: Slack の 3 秒タイムアウト対策で 200 即返しは正しいが、後続の Firestore 更新失敗時に **ユーザーは成功したと誤認する**。
- **対処（工数 M）**:
  - 失敗時に Slack に ephemeral メッセージで "処理に失敗しました" と返す
  - 失敗ログを監視用チャンネルへ自動で流す

---

## 🔵 Low

### L-1. 未使用のファイルが散らばっている

- `src/views/StatusView.vue` — プレースホルダ
- `src/components/HelloWorld.vue` — vite のスカフォールド残骸
- `src/components/status/StatusChangeDialog.vue` — 現状 `StatusChangeModal` しか使っていない？
- `src/composables/useGoogleCalendar.ts` の `createEvent` / `updateEventTitle` / `deleteEvent` — no-op（CF 経由が正）
- `src/stores/cartStore.ts` — `orderStore` に完全移行していれば削除候補
- **対処**: 半日かけて消すと読みやすくなる。

### L-2. Calendar attendees 比較の大文字小文字

- **場所**: `useGoogleCalendar.ts :: addAttendeeToCalendarEvent`
- **問題**: `a.email === castEmail` で完全一致。Google は大文字小文字区別しないが、重複検出時だけ微妙にズレる可能性。
- **対処**: `.toLowerCase()` で比較。

### L-3. Calendar API のリトライ未実装

- **場所**: `functions/src/calendar.ts`
- **問題**: 一時的なネットワークエラーで失敗したら即諦める。
- **対処**: googleapis クライアント自体の retry オプションを有効化、または `p-retry` で包む。

### L-4. 非 null アサーション（`!`）が多い

- `useOrders.ts` / `useCastings.ts` の配列アクセスで `castingIds[i]!` のような使い方が多い。TypeScript 的には安全だが、将来のリファクタで事故る元。`if (!id) continue;` で早期脱出に変えた方が安全。

### L-5. Firestore インデックス未整理

- クエリの中に「projectId + slackThreadTs != ''」のような複合条件が出てきたら、必ず Console に複合 index を作る必要がある。
  現状は「projectId だけで取ってクライアント側でフィルタ」するワークアラウンドが目立つ。意図的ならコメント、そうでなければインデックスを切る。

### L-6. バンドル肥大化

- `CastingView.vue` (332KB / 105KB gzip) と `ShootingContactView.vue` (632KB / 186KB gzip) が突出。
- **対処**: 動的 import での route-level code splitting は既にできている（chunk 分割されている）ので、主犯は内部依存の巨大ライブラリ（jsPDF / html2canvas）。PDF 生成関連の lazy import で ShootingContact は 3 割カットできる。

---

## 🟢 取り組み順の推奨

**今週中（S/M, 高リスク）**
1. C-1: serviceAccountKey.json を Git から除去 & 鍵ローテ
2. C-2: `sendSlackNotificationDirect` フォールバックを dev-only ガード or 削除
3. H-3: `useShootings` に Firestore 範囲クエリを入れる

**今月中（M）**
4. M-1: 日付フォーマット統一
5. M-5: `functions/src/index.ts` 切り出し（まず Slack 復旧ロジックの共通化）
6. M-6: Notion 同期の成功/失敗マーキング

**余裕があるとき（L）**
7. H-2: `useCastings.ts` の責務分解（onDocumentUpdate トリガー化）
8. L-1: 未使用ファイル削除
9. L-6: PDF 生成の lazy import

---

## 🔄 並行して運用したいこと

- **Firestore バックアップの定期化**（Cloud Storage に毎日スナップショット）
- **監視用 Slack チャンネル**を作り、CF の握りつぶし catch から `chat.postMessage` で通知
- **Functions のログ**（`firebase functions:log`）を Stackdriver → Looker Studio に可視化、
  `[CF FAILED]` / `[CALENDAR]` / `[lookup]` の失敗件数をダッシュボード化
