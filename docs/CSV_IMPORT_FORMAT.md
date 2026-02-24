# CSVインポートフォーマット

Firestore コレクションにCSVデータをインポートする際のフォーマット仕様。

---

## castings

| フィールド | 型 | 必須 | 説明 |
|---|---|---|---|
| castId | string | ✅ | castsコレクションのドキュメントID |
| castName | string | ✅ | キャスト名 |
| castType | string | ✅ | `内部` or `外部` |
| accountName | string | ✅ | 案件名（チーム名） |
| projectName | string | ✅ | 作品名 |
| projectId | string | | プロジェクトID |
| roleName | string | ✅ | 役名 |
| rank | number | | 順番（1-based） |
| status | string | ✅ | `仮キャスティング`, `オーダー待ち`, `決定`, etc. |
| mode | string | | `shooting`, `external`, `internal` |
| mainSub | string | | `メイン`, `サブ`, `その他` |
| cost | number | | 金額 |
| note | string | | 備考 |
| startDate | date | ✅ | `YYYY-MM-DD` |
| endDate | date | | `YYYY-MM-DD` |
| startTime | string | | `HH:mm` |
| endTime | string | | `HH:mm` |
| slackThreadTs | string | | Slackスレッドのタイムスタンプ |
| slackPermalink | string | | Slackパーマリンク |
| calendarEventId | string | | GoogleカレンダーイベントID |
| dbSentStatus | string | | `済` or 空 |

---

## castMaster

| フィールド | 型 | 必須 | 説明 |
|---|---|---|---|
| **castingId** | string | ✅ | castingsコレクションのドキュメントID（外部キー） |
| castId | string | ✅ | castsコレクションのドキュメントID |
| castName | string | ✅ | キャスト名 |
| castType | string | ✅ | `内部` or `外部` |
| accountName | string | ✅ | 案件名 |
| projectName | string | ✅ | 作品名 |
| roleName | string | ✅ | 役名 |
| mainSub | string | | `メイン`, `サブ`, `その他` |
| shootDate | date | ✅ | `YYYY-MM-DD` |
| endDate | date | | `YYYY-MM-DD` |
| cost | number | | 金額 |
| decidedAt | date | | 決定日時 |
| decidedBy | string | | 決定者メール |

> [!IMPORTANT]
> `castingId` フィールドは castings コレクションとの外部キー。
> 作品名変更時に cascade 更新（`notifyOrderUpdated` CF）で使用。

---

## shootingContacts

| フィールド | 型 | 必須 | 説明 |
|---|---|---|---|
| **castingId** | string | ✅ | castingsコレクションのドキュメントID（外部キー） |
| castName | string | ✅ | キャスト名 |
| castType | string | ✅ | `内部` or `外部` |
| projectName | string | ✅ | 作品名 |
| accountName | string | ✅ | 案件名 |
| roleName | string | ✅ | 役名 |
| shootDate | date | ✅ | `YYYY-MM-DD` |
| inTime | string | | 入り時間 `HH:mm` |
| outTime | string | | 上がり時間 `HH:mm` |
| location | string | | 場所 |
| address | string | | 住所 |
| fee | number | | ギャラ |
| makingUrl | string | | メイキングURL |
| postDate | date | | 投稿日 `YYYY-MM-DD` |
| mainSub | string | | `メイン`, `サブ`, `その他` |
| status | string | ✅ | `香盤連絡待ち`, `発注書送信待ち`, etc. |
| email | string | | メールアドレス |
| orderDocumentId | string | | 発注書ID |
| slackThreadTs | string | | Slackスレッドのタイムスタンプ |

> [!IMPORTANT]
> `castingId` フィールドは castings コレクションとの外部キー。
> 作品名変更時に `castId` + `projectName(旧)` でも検索して cascade 更新される。
