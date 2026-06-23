/**
 * Google Calendar ヘルパー
 * サービスアカウントを使用してカレンダーイベントを操作
 */
import { google } from "googleapis";



// "0700" / "7:00" / "07:00" などの表記ゆれを RFC3339 dateTime で使える "HH:MM" に正規化する。
// 既存データ（SAM / Notion 由来）はコロンなしで保存されているものがあり、そのままだと
// Calendar API が 400 Bad Request を返す。正規化できない値は null（= 時間指定なし扱い）。
function normalizeTimeToHHMM(input?: string): string | null {
    if (!input) return null;
    const trimmed = String(input).trim();
    if (!trimmed) return null;
    const colonMatch = trimmed.match(/^(\d{1,2}):(\d{2})$/);
    if (colonMatch) {
        const h = Number(colonMatch[1]);
        const m = Number(colonMatch[2]);
        if (h >= 0 && h <= 23 && m >= 0 && m <= 59) {
            return `${String(h).padStart(2, "0")}:${colonMatch[2]}`;
        }
        return null;
    }
    const digitsOnly = trimmed.replace(/\D/g, "");
    if (digitsOnly.length === 4) {
        const h = Number(digitsOnly.slice(0, 2));
        const m = Number(digitsOnly.slice(2, 4));
        if (h >= 0 && h <= 23 && m >= 0 && m <= 59) {
            return `${digitsOnly.slice(0, 2)}:${digitsOnly.slice(2, 4)}`;
        }
    }
    if (digitsOnly.length === 3) {
        const h = Number(digitsOnly.slice(0, 1));
        const m = Number(digitsOnly.slice(1, 3));
        if (h >= 0 && h <= 9 && m >= 0 && m <= 59) {
            return `0${digitsOnly.slice(0, 1)}:${digitsOnly.slice(1, 3)}`;
        }
    }
    return null;
}

/**
 * Calendar APIクライアントを取得
 */
function getCalendarClient(serviceAccountKey: string) {
    const credentials = JSON.parse(serviceAccountKey);
    const auth = new google.auth.GoogleAuth({
        credentials,
        scopes: ["https://www.googleapis.com/auth/calendar"],
    });

    return google.calendar({ version: "v3", auth });
}

/**
 * カレンダーイベントを作成
 * ガイド仕様に準拠:
 *   summary: {アカウント名}_{候補順位}候補_仮キャスティング
 *   description: キャスティング詳細情報
 *   attendees: キャストメール + 追加招待メール
 * @returns イベントID
 */
export async function createCalendarEvent(params: {
    serviceAccountKey: string;
    calendarId: string;
    castName: string;
    projectName: string;
    accountName: string;
    roleName?: string;
    rank?: string;
    mainSub?: string;
    castEmail?: string;
    castingId?: string;
    status?: string;
    startDate: string;
    endDate?: string;
    startTime?: string;
    endTime?: string;
    isProvisional: boolean;
}): Promise<string | null> {
    try {
        const credentials = JSON.parse(params.serviceAccountKey);
        console.log("Calendar: SA email from key:", credentials.client_email);
        console.log("Calendar: target calendarId:", params.calendarId);

        const auth = new google.auth.GoogleAuth({
            credentials,
            scopes: ["https://www.googleapis.com/auth/calendar"],
        });
        const calendar = google.calendar({ version: "v3", auth });

        // Pre-check: カレンダーにアクセスできるか確認
        try {
            const calInfo = await calendar.calendars.get({ calendarId: params.calendarId });
            console.log("Calendar: calendars.get SUCCESS -", calInfo.data.summary);
        } catch (getErr: unknown) {
            const getMsg = getErr instanceof Error ? getErr.message : String(getErr);
            console.error("Calendar: calendars.get FAILED:", getMsg);
            throw new Error(`Calendar access check failed: ${getMsg}`);
        }

        // ガイド仕様: {作品名}_{アカウント名}_{候補順位}候補_{ステータス}
        const rankPart = params.rank ? `_${params.rank}候補` : "";
        const statusLabel = params.status || (params.isProvisional ? "仮キャスティング" : "決定キャスティング");
        const projectPart = params.projectName ? `${params.projectName}_` : "";
        const summary = params.isProvisional
            ? `${projectPart}${params.accountName}${rankPart}_${statusLabel}`
            : `${projectPart}${params.accountName}_決定キャスティング`;

        // ガイド仕様の説明文テンプレート
        const description = [
            "【キャスティング仮ホールド】",
            "",
            `・アカウント: ${params.accountName}`,
            `・作品名: ${params.projectName}`,
            `・役名: ${params.roleName || "出演"}`,
            `・区分: ${params.mainSub || "その他"}`,
            `・キャスト: ${params.castName}`,
            params.castingId ? `・キャスティングID: ${params.castingId}` : "",
            `・ステータス: ${statusLabel}`,
            "",
            "この予定はキャスティング管理システムから自動作成されています。",
            "ステータス変更時にはシステム側で更新される場合があります。",
        ].filter(Boolean).join("\n");

        let startObj: Record<string, string>;
        let endObj: Record<string, string>;

        const normalizedStart = normalizeTimeToHHMM(params.startTime);
        const normalizedEnd = normalizeTimeToHHMM(params.endTime);
        if (params.startTime && params.endTime && (!normalizedStart || !normalizedEnd)) {
            console.warn(
                `[createCalendarEvent] time normalization failed: startTime="${params.startTime}" endTime="${params.endTime}" → fallback to all-day`,
            );
        }

        if (normalizedStart && normalizedEnd) {
            // 時間指定あり → dateTime形式
            startObj = {
                dateTime: `${params.startDate}T${normalizedStart}:00`,
                timeZone: "Asia/Tokyo",
            };
            const endDateStr = params.endDate || params.startDate;
            endObj = {
                dateTime: `${endDateStr}T${normalizedEnd}:00`,
                timeZone: "Asia/Tokyo",
            };
        } else {
            // 時間指定なし → 終日イベント
            // Calendar API の end.date は排他的（exclusive）
            const endDateStr = params.endDate || params.startDate;
            const endDateObj = new Date(endDateStr + "T00:00:00");
            endDateObj.setDate(endDateObj.getDate() + 1);
            const exclusiveEnd = endDateObj.toISOString().split("T")[0]!;

            startObj = { date: params.startDate };
            endObj = { date: exclusiveEnd };
        }

        console.log("Creating calendar event:", {
            summary,
            start: startObj,
            end: endObj,
            calendarId: params.calendarId,
        });

        const requestBody: Record<string, unknown> = {
            summary,
            description,
            start: startObj,
            end: endObj,
        };

        // NOTE: サービスアカウントでは attendees 追加に Domain-Wide Delegation が必要
        // attendees はフロント側のユーザーOAuthで追加する

        const result = await calendar.events.insert({
            calendarId: params.calendarId,
            requestBody,
        });

        const eventId = result.data.id || null;
        console.log("Calendar event created:", eventId);

        return eventId;
    } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : String(error);
        const stack = error instanceof Error ? error.stack : "";
        console.error("Calendar create error:", msg, stack);
        throw new Error(`Calendar API error: ${msg}`);
    }
}

/**
 * カレンダーイベントのタイトルを更新
 */
export async function updateCalendarEventTitle(params: {
    serviceAccountKey: string;
    calendarId: string;
    eventId: string;
    castName: string;
    projectName: string;
    isProvisional: boolean;
}): Promise<boolean> {
    try {
        const calendar = getCalendarClient(params.serviceAccountKey);

        const summary = params.isProvisional
            ? `[仮] ${params.castName} / ${params.projectName}`
            : `${params.castName} / ${params.projectName}`;

        await calendar.events.patch({
            calendarId: params.calendarId,
            eventId: params.eventId,
            requestBody: { summary },
        });

        console.log("Calendar event updated:", params.eventId);
        return true;
    } catch (error) {
        console.error("Calendar update error:", error);
        return false;
    }
}

/**
 * カレンダーイベントを削除
 */
export async function deleteCalendarEvent(params: {
    serviceAccountKey: string;
    calendarId: string;
    eventId: string;
}): Promise<boolean> {
    try {
        const calendar = getCalendarClient(params.serviceAccountKey);

        await calendar.events.delete({
            calendarId: params.calendarId,
            eventId: params.eventId,
        });

        console.log("Calendar event deleted:", params.eventId);
        return true;
    } catch (error) {
        console.error("Calendar delete error:", error);
        return false;
    }
}

/**
 * カレンダーイベントの日時を更新
 */
export async function updateCalendarEventTime(params: {
    serviceAccountKey: string;
    calendarId: string;
    eventId: string;
    startDate: string;
    startTime?: string;
    endTime?: string;
}): Promise<boolean> {
    try {
        const calendar = getCalendarClient(params.serviceAccountKey);

        const requestBody: Record<string, unknown> = {};

        const normalizedStart = normalizeTimeToHHMM(params.startTime);
        const normalizedEnd = normalizeTimeToHHMM(params.endTime);

        if (normalizedStart && normalizedEnd) {
            // 時間指定あり → dateTime形式
            requestBody.start = {
                dateTime: `${params.startDate}T${normalizedStart}:00`,
                timeZone: "Asia/Tokyo",
            };
            requestBody.end = {
                dateTime: `${params.startDate}T${normalizedEnd}:00`,
                timeZone: "Asia/Tokyo",
            };
        } else {
            // 時間指定なし → 終日イベント
            // Calendar API の end.date は排他的（exclusive）。同日にすると 400 になるため翌日にする。
            const endDateObj = new Date(params.startDate + "T00:00:00");
            endDateObj.setDate(endDateObj.getDate() + 1);
            const exclusiveEnd = endDateObj.toISOString().split("T")[0]!;
            requestBody.start = { date: params.startDate };
            requestBody.end = { date: exclusiveEnd };
        }

        await calendar.events.patch({
            calendarId: params.calendarId,
            eventId: params.eventId,
            requestBody,
        });

        console.log("Calendar event time updated:", params.eventId);
        return true;
    } catch (error) {
        console.error("Calendar time update error:", error);
        return false;
    }
}

/**
 * ステータス変更に応じたカレンダー処理
 */
export async function handleCalendarStatusChange(params: {
    serviceAccountKey: string;
    calendarId: string;
    eventId: string;
    castName: string;
    projectName: string;
    newStatus: string;
}): Promise<void> {
    switch (params.newStatus) {
        case "OK":
        case "決定":
            // [仮] を削除
            await updateCalendarEventTitle({
                ...params,
                isProvisional: false,
            });
            break;

        case "仮キャスティング":
        case "仮押さえ":
        case "打診中":
        case "オーダー待ち":
        case "条件つきOK":
            // [仮] を再付与
            await updateCalendarEventTitle({
                ...params,
                isProvisional: true,
            });
            break;

        case "NG":
        case "キャンセル":
            // イベント削除
            await deleteCalendarEvent(params);
            break;

        default:
            break;
    }
}
