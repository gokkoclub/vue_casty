/**
 * =========================================================================
 * automation/onShootingEventCreate.ts
 *
 * shootingEvents/{docId} onCreate トリガ
 * - 冪等性チェック (calendarStatus='pending')
 * - staffNames → email 解決 (casts + staffMentions)
 * - 全員外部 → skipped_external_only
 * - 内部スタッフ1人以上 → GAS WebApp(kunihito実行) でカレンダー作成
 *   ※ DWD不要で attendees 招待可能な方式
 * =========================================================================
 */

import { onDocumentCreated } from "firebase-functions/v2/firestore";
import * as admin from "firebase-admin";
import { resolveEmailsByNames, buildCalendarClient, getOrCreateCalendarId } from "./_helpers";

export const onShootingEventCreate = onDocumentCreated(
    {
        document: "shootingEvents/{docId}",
        region: "asia-northeast1",
        secrets: [
            "GOOGLE_SERVICE_ACCOUNT_KEY",
            "CALENDAR_WEBAPP_URL",
            "CALENDAR_WEBAPP_SECRET",
        ],
    },
    async (event) => {
        const data = event.data?.data();
        const docRef = event.data?.ref;
        const eventDocId = event.params.docId;

        if (!data || !docRef) {
            console.log("No data, skip");
            return;
        }

        if (data.calendarStatus && data.calendarStatus !== "pending") {
            console.log(`[calendar] Skip: calendarStatus=${data.calendarStatus}, doc=${eventDocId}`);
            return;
        }

        try {
            await docRef.update({
                calendarStatus: "processing",
                updatedAt: admin.firestore.FieldValue.serverTimestamp(),
            });

            await createCalendarEvent(eventDocId, data, docRef);
        } catch (err: any) {
            console.error(`[calendar] Error for ${eventDocId}:`, err);
            await docRef.update({
                calendarStatus: "failed",
                errorMessage: String(err?.message || err),
                updatedAt: admin.firestore.FieldValue.serverTimestamp(),
            }).catch(e => console.error("Failed to mark failed:", e));
        }
    }
);

async function createCalendarEvent(
    docId: string,
    data: FirebaseFirestore.DocumentData,
    docRef: FirebaseFirestore.DocumentReference,
) {
    const team: string = data.team || "";
    const group: string = data.group || "";
    const shootingDate: string = data.shootingDate || "";
    const inTime: string = data.inTime || "";
    const outTime: string = data.outTime || "";
    const location: string = data.location || "";
    const staffNames: string[] = Array.isArray(data.staffNames) ? data.staffNames : [];
    const isIndividualEvent: boolean = !!data.isIndividualEvent;
    const sourceSheetUrl: string = data.sourceSheetUrl || "";

    if (!team || !shootingDate || !inTime || !outTime) {
        throw new Error("必須フィールド不足(team/shootingDate/inTime/outTime)");
    }

    // ── 1. email 解決 ──
    const emails = await resolveEmailsByNames(staffNames);
    console.log(`[calendar] Resolved emails: ${emails.length}/${staffNames.length} for ${docId}`);

    // 全員外部キャスト/スタッフ → カレンダー登録不要
    if (emails.length === 0) {
        console.log(`[calendar] Skip: all external staff: ${staffNames.join(", ")}`);
        await docRef.update({
            calendarStatus: "skipped_external_only",
            resolvedEmails: [],
            unresolvedStaffNames: staffNames,
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
            errorMessage: "",
        });
        return;
    }

    // ── 2. calendarId 解決 ──
    // 既存の calendarConfig から取得。無ければ SA で新規作成
    const serviceAccountKey = process.env.GOOGLE_SERVICE_ACCOUNT_KEY;
    if (!serviceAccountKey) throw new Error("GOOGLE_SERVICE_ACCOUNT_KEY not set");
    const calendarClient = buildCalendarClient(serviceAccountKey);
    const calendarId = await getOrCreateCalendarId(team, calendarClient);

    // ── 3. GAS WebApp (kunihito実行) でイベント作成 ──
    const webappUrl = process.env.CALENDAR_WEBAPP_URL;
    const webappSecret = process.env.CALENDAR_WEBAPP_SECRET;
    if (!webappUrl || !webappSecret) {
        throw new Error("CALENDAR_WEBAPP_URL or CALENDAR_WEBAPP_SECRET not set");
    }

    const body = {
        action: "createCalendarEvent",
        secret: webappSecret,
        calendarId,
        team,
        group,
        shootingDate,
        inTime,
        outTime,
        location,
        staffNames,
        emails,
        isIndividualEvent,
        sourceSheetUrl,
    };

    const webappRes = await fetch(webappUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        redirect: "follow", // GAS は302リダイレクト返すので follow 必須
    });

    if (!webappRes.ok) {
        const txt = await webappRes.text();
        throw new Error(`WebApp HTTP ${webappRes.status}: ${txt.substring(0, 300)}`);
    }

    const webappData = await webappRes.json() as {
        ok: boolean;
        calendarEventId?: string;
        attendees?: string[];
        attendeeCount?: number;
        error?: string;
    };

    if (!webappData.ok) {
        throw new Error(`WebApp error: ${webappData.error || "unknown"}`);
    }

    // ── 4. 書戻し ──
    await docRef.update({
        calendarStatus: "created",
        calendarId,
        calendarEventId: webappData.calendarEventId || "",
        resolvedEmails: emails,
        attendees: webappData.attendees || [],
        attendeeCount: webappData.attendeeCount || 0,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        errorMessage: "",
    });

    console.log(`[calendar] ✅ Event created via WebApp: ${webappData.calendarEventId} (${team}/${group}, attendees=${webappData.attendeeCount})`);
}
