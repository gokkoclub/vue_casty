# GAS Calendar Invite Proxy

Service Account で作成された Google Calendar イベントに attendee を追加するための最小 GAS Web App。
CF (`notifyOrderCreated` / `resendCalendarInvite` / retry scheduler) から HMAC 署名付き HTTP POST で呼ばれる。

## デプロイ手順

1. **実行アカウントでログイン**: `yoyaku.studio505@gokkoclub.jp`

2. **新規 Apps Script プロジェクト作成**: https://script.google.com/ → 新しいプロジェクト
   - 名前: `casty-calendar-invite-proxy` など

3. **Code.gs をコピペ**: 本ディレクトリの `Code.gs` 全文を貼り付け

4. **Advanced Service を有効化**:
   - 左メニュー「サービス」 → `+` → `Google Calendar API` を選択 → 識別子 `Calendar` のまま追加

5. **共有シークレットを設定**:
   - プロジェクトの設定（歯車アイコン） → 「スクリプトのプロパティ」 → `SHARED_SECRET` を追加
   - 値は `openssl rand -base64 48` などで生成した 32 文字以上のランダム文字列
   - この値を後ほど CF の Secret Manager にも入れる

6. **カレンダー権限付与**:
   - Google Calendar → `GOOGLE_CALENDAR_ID` のカレンダー設定 → 「特定のユーザーと共有」
   - `yoyaku.studio505@gokkoclub.jp` を追加、権限は「予定の変更権限」
   - **これを忘れると GAS 側で 403 になる**

7. **デプロイ**:
   - 右上「デプロイ」 → 「新しいデプロイ」
   - 種類: **ウェブアプリ**
   - 次のユーザーとして実行: **自分 (yoyaku.studio505@gokkoclub.jp)**
   - アクセスできるユーザー: **全員**
   - デプロイ → 初回のみ OAuth 同意画面（カレンダーへのアクセス許可）

8. **Web App URL をメモ**: `https://script.google.com/a/macros/gokkoclub.jp/s/AKfy.../exec`
   - このURLを CF 側の Secret `GAS_INVITE_WEBHOOK_URL` に設定

## CF 側の Secret 設定

```bash
# Firebase CLI
firebase functions:secrets:set GAS_INVITE_WEBHOOK_URL
# → 上でメモした /exec URL を貼り付け

firebase functions:secrets:set GAS_INVITE_SHARED_SECRET
# → GAS の SHARED_SECRET と全く同じ値を貼り付け
```

## HMAC 署名仕様（CF と GAS で同じ実装）

```
payload  = [action, timestamp, calendarId, eventId, attendeeEmail].join('|')
signature = HMAC-SHA256(payload, SHARED_SECRET)  // hex lowercase
```

リクエスト body (JSON):
```json
{
  "action": "addAttendee",
  "timestamp": "1712345678000",
  "signature": "abc123...",
  "calendarId": "xxx@group.calendar.google.com",
  "eventId": "abcdef123456",
  "attendeeEmail": "cast@example.com"
}
```

レスポンス:
- `{ ok: true, eventId, attendeeCount }` — 追加成功
- `{ ok: true, skipped: "already attendee" }` — 既に追加済み（idempotent）
- `{ ok: false, error: "..." }` — 失敗（CF 側で pending フラグを立ててリトライ）

## ローカル動作確認

Apps Script エディタで `_test_addAttendee` 関数を編集 → 実行で動作確認可能。
