# Slack通知メッセージ仕様書

## 📋 目次

1. [通知の種類](#1-通知の種類)
2. [新規オーダー通知](#2-新規オーダー通知)
3. [追加オーダー通知](#3-追加オーダー通知)
4. [ステータス更新通知](#4-ステータス更新通知)
5. [特別オーダー通知](#5-特別オーダー通知外部案件社内イベント)
6. [実装コード例](#6-実装コード例)
7. [環境変数設定](#7-環境変数設定)

---

## 1. 通知の種類

システムは以下の4種類のSlack通知を送信します：

| 通知タイプ | トリガー | 送信先チャンネル | スレッド |
|---|---|---|---|
| 新規オーダー | カート送信時 | orderTypeに応じて選択 | 新規投稿 |
| 追加オーダー | 既存案件への追加 | 元のスレッド | スレッド返信 |
| ステータス更新 | 管理者がステータス変更 | 元のスレッド | スレッド返信 |
| 特別オーダー | 外部案件/社内イベント | DEFAULT_CHANNEL | 新規投稿 |

---

## 2. 新規オーダー通知

### 2.1 メッセージ構造

```
<!subteam^{MENTION_GROUP_ID}>
cc: {CCメンション}

キャスティングオーダーがありました。
*内部キャストはスタンプで反応ください*

`撮影日`
・2024-12-25
・2024-12-26

`アカウント`
サンプルアカウント

`作品名`
サンプルCM

`役名`
【サンプルCM】
  主役
    第1候補：<@U12345678>
    第2候補：田中太郎
    🚨 同日に別の撮影があります
  脇役
    第1候補：<@U87654321>

`Notionリンク`
https://www.notion.so/xxxxxxxxxxxxx

--------------------------------------------------
```

### 2.2 仕様詳細

**ヘッダー部分:**
- グループメンション (`<!subteam^{MENTION_GROUP_ID}>`)
  - 環境変数 `SLACK_MENTION_GROUP_ID` から取得
  - 設定されていない場合は省略
  
- CC欄 (`cc: {CCメンション}`)
  - ユーザーがCCとして選択した人々のSlackメンション
  - オーダー作成者を含む
  - 省略可能

- タイトル
  - "キャスティングオーダーがありました。"

- 内部キャスト通知
  - `*内部キャストはスタンプで反応ください*` (太字)
  - オーダーに内部キャストが含まれる場合のみ表示

**本文部分:**
- 撮影日: バッククォートでラベル、箇条書きで日付列挙
- アカウント: バッククォートでラベル
- 作品名: 複数作品がある場合は `/` 区切り
- 役名: 作品別・役名別に階層構造
  - 【作品名】
  - 　役名
  - 　　第N候補: @メンション または 名前
  - 競合情報があれば 🚨 マークで警告表示
- Notionリンク: ハイフンを除去したURL

**フッター:**
- 区切り線 (`--------------------------------------------------`)

### 2.3 内部キャストのメンション

```typescript
// Slackメンション ID がある場合
cast_disp = `<@${slackUserId}>`;

// Slackメンション ID がない場合
cast_disp = castName;
```

---

## 3. 追加オーダー通知

### 3.1 メッセージ構造

```
<!subteam^{MENTION_GROUP_ID}>

追加オーダーのお知らせ
*内部キャストはスタンプで反応ください*

【サンプルCM】
主役：<@U12345678> / 田中太郎
  🚨 同日に別の撮影があります

【別作品】
脇役：<@U87654321>
```

### 3.2 仕様詳細

**特徴:**
- 既存のSlackスレッドに返信として投稿
- 簡略化されたフォーマット
- 作品名・役名ごとにキャストを列挙
- 候補順位は `/` で区切って横並び表示

**フォーマット:**
```
【作品名】
役名：第1候補 / 第2候補 / 第3候補
  🚨 競合情報がある場合
```

---

## 4. ステータス更新通知

### 4.1 メッセージ構造

```
ステータスが *決定* に変更されました。

【追加情報】
金額: ¥50,000

【追加メッセージ】
ご確認の上、よろしくお願いいたします。
```

### 4.2 仕様詳細

**基本形式:**
```
ステータスが *{newStatus}* に変更されました。
```

**追加情報 (オプション):**
- 金額が入力されている場合、カンマ区切りで表示
- 追加メッセージがある場合、そのまま表示

**特殊ステータス:**
- 「追加オーダー」の場合は専用フォーマット:
  ```
  追加オーダーが登録されました。
  {extraMessage}
  ```

---

## 5. 特別オーダー通知（外部案件/社内イベント）

### 5.1 メッセージ構造

```
<@U12345678>
CC: <@U87654321>

【外部案件】
`タイトル`
サンプルイベント

`日時`
2024/12/25, 2024/12/26

`時間`
10:00 ~ 18:00
```

### 5.2 仕様詳細

**対象キャストごとに個別投稿:**
- 各キャストに対して1つずつメッセージを送信
- スレッドは作らず、独立した投稿

**メンション:**
- 1行目: 対象キャスト (`<@{slack_id}>` または 名前)
- 2行目: CC (オーダー作成者)

**本文:**
- 案件種別: 【外部案件】または【社内イベント】
- タイトル
- 日時 (カンマ区切り、ハイフンをスラッシュに置換)
- 時間帯

**内部キャストの場合:**
- Googleカレンダーに仮ホールドイベントを作成
- キャスティングリストに「仮キャスティング」ステータスで保存

**外部キャストの場合:**
- キャスティングリストに「決定」ステータスで保存

---

## 6. 実装コード例

### 6.1 Cloud Functions: 新規オーダー通知

**ファイル:** `functions/src/slack/notifyOrder.ts`

```typescript
import * as functions from 'firebase-functions';
import { WebClient } from '@slack/web-api';

const slack = new WebClient(process.env.SLACK_BOT_TOKEN);

interface OrderPayload {
  accountName: string;
  projectName: string;
  projectId: string;
  dateRanges: string[];
  items: OrderItem[];
  hasInternal: boolean;
  ccString?: string;
  isAdditional?: boolean;
  slackThreadTs?: string;
}

interface OrderItem {
  projectName: string;
  roleName: string;
  castName: string;
  rank: number;
  slackUserId?: string;
  conflictInfo?: string;
}

export const notifyOrderCreated = functions
  .region('asia-northeast1')
  .https.onCall(async (data: OrderPayload, context) => {
    if (!context.auth) {
      throw new functions.https.HttpsError('unauthenticated', 'Not authenticated');
    }

    const CHANNEL = process.env.SLACK_DEFAULT_CHANNEL!;
    const MENTION_GROUP = process.env.SLACK_MENTION_GROUP_ID;
    
    const message = buildOrderMessage(data, MENTION_GROUP);
    
    const result = await slack.chat.postMessage({
      channel: CHANNEL,
      text: message,
      thread_ts: data.slackThreadTs // 追加オーダーの場合はスレッド返信
    });
    
    // パーマリンク取得
    const permalink = await slack.chat.getPermalink({
      channel: CHANNEL,
      message_ts: result.ts!
    });
    
    return { 
      ts: result.ts, 
      permalink: permalink.permalink 
    };
  });

function buildOrderMessage(payload: OrderPayload, mentionGroup?: string): string {
  const lines: string[] = [];
  
  // 追加オーダーの場合
  if (payload.isAdditional) {
    if (mentionGroup) {
      lines.push(`<!subteam^${mentionGroup}>`);
    }
    lines.push('追加オーダーのお知らせ');
    if (payload.hasInternal) {
      lines.push('*内部キャストはスタンプで反応ください*');
    }
    lines.push('');
    
    // プロジェクト・役ごとにグループ化
    const grouped = groupByProjectAndRole(payload.items);
    for (const [projectName, roles] of Object.entries(grouped)) {
      lines.push(`【${projectName}】`);
      for (const [roleName, casts] of Object.entries(roles)) {
        const castList = casts.map(c => 
          c.slackUserId ? `<@${c.slackUserId}>` : c.castName
        ).join(' / ');
        lines.push(`${roleName}：${castList}`);
        
        // 競合情報
        casts.forEach(c => {
          if (c.conflictInfo) {
            lines.push(`  🚨 ${c.conflictInfo}`);
          }
        });
      }
      lines.push('');
    }
    
    return lines.join('\n').trim();
  }
  
  // 新規オーダーの場合
  if (mentionGroup) {
    lines.push(`<!subteam^${mentionGroup}>`);
  }
  
  if (payload.ccString) {
    lines.push(`cc: ${payload.ccString}`);
  }
  
  lines.push('キャスティングオーダーがありました。');
  
  if (payload.hasInternal) {
    lines.push('*内部キャストはスタンプで反応ください*');
  }
  
  lines.push('');
  lines.push('`撮影日`');
  payload.dateRanges.forEach(d => lines.push(`・${d}`));
  
  lines.push('');
  lines.push('`アカウント`');
  lines.push(payload.accountName || '未入力');
  
  lines.push('');
  lines.push('`作品名`');
  const projects = [...new Set(payload.items.map(i => i.projectName))];
  lines.push(projects.join('/') || '未定');
  
  lines.push('');
  lines.push('`役名`');
  const grouped = groupByProjectAndRole(payload.items);
  for (const [projectName, roles] of Object.entries(grouped)) {
    lines.push(`【${projectName}】`);
    for (const [roleName, casts] of Object.entries(roles)) {
      lines.push(`  ${roleName}`);
      casts.sort((a, b) => a.rank - b.rank);
      casts.forEach(c => {
        const mention = c.slackUserId ? `<@${c.slackUserId}>` : c.castName;
        lines.push(`    第${c.rank}候補：${mention}`);
        if (c.conflictInfo) {
          lines.push(`    🚨 ${c.conflictInfo}`);
        }
      });
    }
  }
  
  lines.push('');
  lines.push('`Notionリンク`');
  if (payload.projectId) {
    lines.push(`https://www.notion.so/${payload.projectId.replace(/-/g, '')}`);
  } else {
    lines.push('未設定');
  }
  
  lines.push('');
  lines.push('--------------------------------------------------');
  
  return lines.join('\n').trim();
}

function groupByProjectAndRole(items: OrderItem[]): Record<string, Record<string, OrderItem[]>> {
  const result: Record<string, Record<string, OrderItem[]>> = {};
  
  items.forEach(item => {
    if (!result[item.projectName]) {
      result[item.projectName] = {};
    }
    if (!result[item.projectName][item.roleName]) {
      result[item.projectName][item.roleName] = [];
    }
    result[item.projectName][item.roleName].push(item);
  });
  
  return result;
}
```

### 6.2 Cloud Functions: ステータス更新通知

**ファイル:** `functions/src/slack/notifyStatusUpdate.ts`

```typescript
export const notifyStatusUpdate = functions
  .region('asia-northeast1')
  .https.onCall(async (data, context) => {
    if (!context.auth) {
      throw new functions.https.HttpsError('unauthenticated', 'Not authenticated');
    }

    const { castingId, newStatus, cost, extraMessage } = data;
    
    // Castingドキュメント取得
    const castingDoc = await admin.firestore()
      .collection('castings')
      .doc(castingId)
      .get();
      
    if (!castingDoc.exists) {
      throw new functions.https.HttpsError('not-found', 'Casting not found');
    }
    
    const casting = castingDoc.data()!;
    
    // メッセージ構築
    let message = `ステータスが *${newStatus}* に変更されました。`;
    
    if (cost) {
      message += `\n\n【追加情報】\n金額: ¥${cost.toLocaleString()}`;
    }
    
    if (extraMessage) {
      message += `\n\n【追加メッセージ】\n${extraMessage}`;
    }
    
    // Slack通知
    if (casting.slackThreadTs) {
      await slack.chat.postMessage({
        channel: process.env.SLACK_DEFAULT_CHANNEL!,
        thread_ts: casting.slackThreadTs,
        text: message
      });
    }
    
    return { ok: true };
  });
```

---

## 7. 環境変数設定

### 7.1 必要な環境変数

```bash
# Slack設定
SLACK_BOT_TOKEN=xoxb-...
SLACK_DEFAULT_CHANNEL=C01234567
SLACK_CHANNEL_TYPE_A=C01234567  # Pattern A用
SLACK_CHANNEL_TYPE_B=C98765432  # Pattern B用
SLACK_MENTION_GROUP_ID=S01234567  # グループメンション

# カレンダー設定
CALENDAR_ID_INTERNAL_HOLD=internal-hold@group.calendar.google.com

# Notion設定
NOTION_API_KEY=secret_...
NOTION_SHOOTING_DB_ID=xxxxxxxxxxxxx
```

### 7.2 Firebase Functionsへの設定

```bash
firebase functions:config:set \
  slack.bot_token="xoxb-..." \
  slack.default_channel="C01234567" \
  slack.mention_group_id="S01234567"
```

---

## 8. テスト方法

### 8.1 Slack Workspace設定

1. Slack App作成
2. Bot Token Scopes追加:
   - `chat:write`
   - `files:write`
   - `chat:write.public`
   - `usergroups:read`
3. アプリをワークスペースにインストール
4. チャンネルにアプリを招待

### 8.2 メッセージフォーマットテスト

```typescript
// テスト用のダミーデータ
const testPayload = {
  accountName: 'テストアカウント',
  projectName: 'テストCM',
  projectId: '12345-67890',
  dateRanges: ['2024-12-25', '2024-12-26'],
  items: [
    {
      projectName: 'テストCM',
      roleName: '主役',
      castName: '山田太郎',
      rank: 1,
      slackUserId: 'U12345678',
      conflictInfo: '同日に別の撮影があります'
    }
  ],
  hasInternal: true,
  ccString: '<@U87654321>'
};

const message = buildOrderMessage(testPayload, 'S01234567');
console.log(message);
```

---

## 📋 実装チェックリスト

### 新規オーダー通知
- [ ] グループメンションが表示される
- [ ] CC欄が表示される
- [ ] 内部キャスト通知が表示される（内部キャストがいる場合のみ）
- [ ] 撮影日が箇条書きで表示される
- [ ] 役名が階層構造で表示される
- [ ] SlackメンションIDがあればメンション、なければ名前
- [ ] 競合情報があれば🚨マークで表示
- [ ] Notionリンクが正しく生成される

### 追加オーダー通知
- [ ] 既存スレッドに返信される
- [ ] 簡略化されたフォーマットで表示される
- [ ] 複数候補が `/` で区切られる
- [ ] 内部キャスト通知が表示される（内部キャストがいる場合のみ）

### ステータス更新通知
- [ ] ステータスが太字で表示される
- [ ] 金額がカンマ区切りで表示される
- [ ] 追加メッセージが表示される
- [ ] 既存スレッドに返信される

### 特別オーダー通知
- [ ] キャストごとに個別投稿される
- [ ] メンションが正しく表示される
- [ ] CC欄にオーダー作成者が表示される
- [ ] 日時がスラッシュ区切りで表示される
