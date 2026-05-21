"use strict";
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
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.onShootingEventCreate = void 0;
const firestore_1 = require("firebase-functions/v2/firestore");
const admin = __importStar(require("firebase-admin"));
const _helpers_1 = require("./_helpers");
exports.onShootingEventCreate = (0, firestore_1.onDocumentCreated)({
    document: "shootingEvents/{docId}",
    region: "asia-northeast1",
    secrets: [
        "GOOGLE_SERVICE_ACCOUNT_KEY",
        "CALENDAR_WEBAPP_URL",
        "CALENDAR_WEBAPP_SECRET",
    ],
}, async (event) => {
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
    }
    catch (err) {
        console.error(`[calendar] Error for ${eventDocId}:`, err);
        await docRef.update({
            calendarStatus: "failed",
            errorMessage: String(err?.message || err),
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        }).catch(e => console.error("Failed to mark failed:", e));
    }
});
async function createCalendarEvent(docId, data, docRef) {
    const team = data.team || "";
    const group = data.group || "";
    const shootingDate = data.shootingDate || "";
    const inTime = data.inTime || "";
    const outTime = data.outTime || "";
    const location = data.location || "";
    const staffNames = Array.isArray(data.staffNames) ? data.staffNames : [];
    const isIndividualEvent = !!data.isIndividualEvent;
    const sourceSheetUrl = data.sourceSheetUrl || "";
    if (!team || !shootingDate || !inTime || !outTime) {
        throw new Error("必須フィールド不足(team/shootingDate/inTime/outTime)");
    }
    // ── 1. email 解決 ──
    const emails = await (0, _helpers_1.resolveEmailsByNames)(staffNames);
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
    if (!serviceAccountKey)
        throw new Error("GOOGLE_SERVICE_ACCOUNT_KEY not set");
    const calendarClient = (0, _helpers_1.buildCalendarClient)(serviceAccountKey);
    const calendarId = await (0, _helpers_1.getOrCreateCalendarId)(team, calendarClient);
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
    const webappData = await webappRes.json();
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
//# sourceMappingURL=onShootingEventCreate.js.map