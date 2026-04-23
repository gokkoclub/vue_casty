/**
 * ============================================================================
 * Casty Calendar Invite Proxy (GAS Web App)
 *
 * Service Account で作成済みの Google Calendar イベントに attendee を追加するだけの
 * 最小機能プロキシ。CF (notifyOrderCreated / resendCalendarInvite / retry scheduler)
 * から HTTP POST で呼ばれる。
 *
 * デプロイ手順 (yoyaku.studio505@gokkoclub.jp で実行):
 *   1. Apps Script エディタで Services > "Google Calendar API" を Advanced Service として追加
 *   2. プロジェクトのプロパティ > "スクリプトのプロパティ" に SHARED_SECRET をセット
 *        (32文字以上のランダム文字列。CF 側の Secret Manager にも同じ値を入れる)
 *   3. デプロイ > 新しいデプロイ > 種類: ウェブアプリ
 *        - 次のユーザーとして実行: 自分 (yoyaku.studio505@gokkoclub.jp)
 *        - アクセスできるユーザー: 全員
 *   4. 発行された /exec URL を CF 側の GAS_INVITE_WEBHOOK_URL (Secret) に設定
 *
 * 対象カレンダー (GOOGLE_CALENDAR_ID) に対して、yoyaku.studio505 が
 * 「予定の変更権限」を持っていることを事前に確認すること。
 * ============================================================================
 */

const MAX_TIMESTAMP_SKEW_MS = 5 * 60 * 1000; // 5分以内のリクエストのみ受け付け (replay 対策)

function doPost(e) {
  try {
    if (!e || !e.postData || !e.postData.contents) {
      return json({ ok: false, error: "empty body" });
    }
    const body = JSON.parse(e.postData.contents);

    const secret = PropertiesService.getScriptProperties().getProperty("SHARED_SECRET");
    if (!secret) return json({ ok: false, error: "server misconfigured: SHARED_SECRET not set" });

    const { action, timestamp, signature, calendarId, eventId, attendeeEmail } = body;
    if (!action || !timestamp || !signature || !calendarId || !eventId) {
      return json({ ok: false, error: "missing required fields" });
    }

    // replay 防止
    const now = Date.now();
    const ts = Number(timestamp);
    if (!isFinite(ts) || Math.abs(now - ts) > MAX_TIMESTAMP_SKEW_MS) {
      return json({ ok: false, error: "timestamp out of range" });
    }

    // HMAC 検証 (payload: action|timestamp|calendarId|eventId|attendeeEmail)
    const expected = hmacSha256Hex(
      [action, timestamp, calendarId, eventId, attendeeEmail || ""].join("|"),
      secret
    );
    if (signature !== expected) {
      return json({ ok: false, error: "invalid signature" });
    }

    if (action === "addAttendee") {
      if (!attendeeEmail) return json({ ok: false, error: "attendeeEmail required" });
      return json(addAttendee(calendarId, eventId, attendeeEmail));
    }

    return json({ ok: false, error: "unknown action: " + action });
  } catch (err) {
    return json({ ok: false, error: String(err && err.stack ? err.stack : err) });
  }
}

function addAttendee(calendarId, eventId, attendeeEmail) {
  // SA が作ったばかりのイベントは GAS 側の読み取り伝播に数秒かかることがある → 最大3回リトライ
  let event = null;
  let lastErr = null;
  for (let i = 0; i < 3; i++) {
    try {
      event = Calendar.Events.get(calendarId, eventId);
      break;
    } catch (err) {
      lastErr = err;
      if (i < 2) Utilities.sleep(500 * (i + 1));
    }
  }
  if (!event) {
    return { ok: false, error: "event not found: " + String(lastErr) };
  }

  const existing = (event.attendees || []).slice();
  if (existing.some(function (a) { return (a.email || "").toLowerCase() === attendeeEmail.toLowerCase(); })) {
    return { ok: true, skipped: "already attendee", eventId: event.id };
  }

  existing.push({ email: attendeeEmail });

  // sendUpdates=all で明示的に招待メールを送信
  const updated = Calendar.Events.patch(
    { attendees: existing },
    calendarId,
    eventId,
    { sendUpdates: "all" }
  );

  return { ok: true, eventId: updated.id, attendeeCount: (updated.attendees || []).length };
}

function hmacSha256Hex(message, key) {
  const raw = Utilities.computeHmacSha256Signature(message, key);
  let hex = "";
  for (let i = 0; i < raw.length; i++) {
    const b = raw[i];
    const v = (b < 0 ? b + 256 : b).toString(16);
    hex += v.length === 1 ? "0" + v : v;
  }
  return hex;
}

function json(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

// ===== ローカルテスト用 (GAS エディタから手動実行) =====
// 実行前に SHARED_SECRET / テスト用の eventId を入れて使う
function _test_addAttendee() {
  const calendarId = "YOUR_CALENDAR_ID";
  const eventId = "YOUR_EVENT_ID";
  const result = addAttendee(calendarId, eventId, "test@example.com");
  Logger.log(JSON.stringify(result));
}
