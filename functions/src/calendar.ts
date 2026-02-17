/**
 * Google Calendar ヘルパー
 * サービスアカウントを使用してカレンダーイベントを操作
 */
import { google } from "googleapis";



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

        // ガイド仕様: {アカウント名}_{候補順位}候補_仮キャスティング
        const rankPart = params.rank ? `_${params.rank}候補` : "";
        const statusLabel = params.status || (params.isProvisional ? "仮キャスティング" : "決定キャスティング");
        const summary = params.isProvisional
            ? `${params.accountName}${rankPart}_${statusLabel}`
            : `${params.accountName}_決定キャスティング`;

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

        if (params.startTime && params.endTime) {
            // 時間指定あり → dateTime形式
            startObj = {
                dateTime: `${params.startDate}T${params.startTime}:00`,
                timeZone: "Asia/Tokyo",
            };
            const endDateStr = params.endDate || params.startDate;
            endObj = {
                dateTime: `${endDateStr}T${params.endTime}:00`,
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

        // 出席者リスト
        const attendees: Array<{ email: string }> = [];
        if (params.castEmail) {
            attendees.push({ email: params.castEmail });
        }

        console.log("Creating calendar event:", {
            summary,
            start: startObj,
            end: endObj,
            calendarId: params.calendarId,
            attendeesCount: attendees.length,
        });

        const requestBody: Record<string, unknown> = {
            summary,
            description,
            start: startObj,
            end: endObj,
        };
        if (attendees.length > 0) {
            requestBody.attendees = attendees;
        }

        const result = await calendar.events.insert({
            calendarId: params.calendarId,
            requestBody,
        });

        console.log("Calendar event created:", result.data.id);
        return result.data.id || null;
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

        if (params.startTime && params.endTime) {
            // 時間指定あり → dateTime形式
            requestBody.start = {
                dateTime: `${params.startDate}T${params.startTime}:00`,
                timeZone: "Asia/Tokyo",
            };
            requestBody.end = {
                dateTime: `${params.startDate}T${params.endTime}:00`,
                timeZone: "Asia/Tokyo",
            };
        } else {
            // 時間指定なし → 終日イベント
            requestBody.start = { date: params.startDate };
            requestBody.end = { date: params.startDate };
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

        case "NG":
        case "キャンセル":
            // イベント削除
            await deleteCalendarEvent(params);
            break;

        default:
            break;
    }
}
