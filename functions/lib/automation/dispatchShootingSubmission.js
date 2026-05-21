"use strict";
/**
 * =========================================================================
 * automation/dispatchShootingSubmission.ts
 *
 * shootingSubmissions/{docId} onWrite トリガ
 * - 冪等性チェック (status === 'submitted' のみ処理)
 * - shootings/{pageId} 更新 (title, fdNames, outTime)
 * - shootingEvents/{compositeId} を rows から生成
 * - Cloud Tasks で Slack通知を outDateTime+10分に予約
 * - 処理後 status='processed' + rows削除(機密保護)
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
exports.dispatchShootingSubmission = void 0;
const firestore_1 = require("firebase-functions/v2/firestore");
const admin = __importStar(require("firebase-admin"));
const tasks_1 = require("@google-cloud/tasks");
const _helpers_1 = require("./_helpers");
const PROJECT_ID = "gokko-casty";
const LOCATION = "asia-northeast1";
const TASKS_QUEUE = "offshot-slack-queue";
const CF_URL_SEND_SLACK = `https://${LOCATION}-${PROJECT_ID}.cloudfunctions.net/sendSlackOffshot`;
exports.dispatchShootingSubmission = (0, firestore_1.onDocumentWritten)({
    document: "shootingSubmissions/{docId}",
    region: "asia-northeast1",
    secrets: [],
}, async (event) => {
    const after = event.data?.after.data();
    const docRef = event.data?.after.ref;
    const pageId = event.params.docId;
    if (!after || !docRef) {
        console.log("No after data (deleted?), skip");
        return;
    }
    // 冪等性: processed / processing / failed は再処理しない
    if (after.status !== "submitted") {
        console.log(`[dispatch] Skip: status=${after.status}, pageId=${pageId}`);
        return;
    }
    const db = admin.firestore();
    // 排他取得(トランザクションで status を processing に)
    try {
        await db.runTransaction(async (tx) => {
            const snap = await tx.get(docRef);
            const data = snap.data();
            if (!data || data.status !== "submitted") {
                throw new Error(`status changed: ${data?.status}`);
            }
            tx.update(docRef, {
                status: "processing",
                updatedAt: admin.firestore.FieldValue.serverTimestamp(),
            });
        });
    }
    catch (e) {
        console.log(`[dispatch] Already being processed: ${pageId}`, e);
        return;
    }
    try {
        await processSubmission(pageId, after, docRef);
    }
    catch (err) {
        console.error(`[dispatch] Error for ${pageId}:`, err);
        await docRef.update({
            status: "failed",
            errorMessage: String(err?.message || err),
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        }).catch(e => console.error("Failed to mark failed:", e));
    }
});
async function processSubmission(pageId, data, docRef) {
    const db = admin.firestore();
    const team = data.team || "";
    const shootingDate = data.shootingDate || "";
    const title = data.title || "";
    const fdNames = Array.isArray(data.fdNames) ? data.fdNames : [];
    const maxOutTime = data.maxOutTime || "";
    const outDateTimeISO = data.outDateTimeISO || "";
    const rows = Array.isArray(data.rows) ? data.rows : [];
    const rowCount = rows.length;
    console.log(`[dispatch] Processing ${pageId}: team=${team}, rows=${rowCount}, fd=${fdNames.length}`);
    // ── 1. shootings/{pageId} を更新 ──
    const shootingsUpdates = {
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    };
    if (title) {
        shootingsUpdates.title = title;
        shootingsUpdates.titleFromNotion = true;
    }
    if (fdNames.length > 0)
        shootingsUpdates.fdNames = fdNames;
    if (maxOutTime)
        shootingsUpdates.outTime = maxOutTime;
    if (outDateTimeISO) {
        shootingsUpdates.outDateTime = admin.firestore.Timestamp.fromDate(new Date(outDateTimeISO));
    }
    await db.doc(`shootings/${pageId}`).set(shootingsUpdates, { merge: true });
    console.log(`[dispatch] shootings updated: ${pageId}`);
    // ── 2. shootingEvents を rows から生成 ──
    let eventCount = 0;
    if (rows.length > 0) {
        const eventBatch = db.batch();
        const staffGroups = new Map();
        for (const r of rows) {
            const target = r.target || "";
            if (target !== "カレンダー" && target !== "両方")
                continue;
            const group = (r.group || "").trim();
            const staff = (r.staff || "").trim();
            const inTime = r.inTime || "";
            const outTime = r.outTime || "";
            const location = r.location || "";
            if (!group || !inTime || !outTime)
                continue;
            if (group === "キャスト") {
                // キャストは1人1イベント
                const staffKey = staff.replace(/\s+/g, "");
                if (!staffKey)
                    continue;
                const docId = `${pageId}_cast_${staffKey}`;
                eventBatch.set(db.doc(`shootingEvents/${docId}`), {
                    notionPageId: pageId,
                    team,
                    group,
                    shootingDate,
                    inTime,
                    outTime,
                    location,
                    staffNames: [staff],
                    isIndividualEvent: true,
                    calendarStatus: "pending",
                    sourceSheetUrl: data.koubanSheetUrl || "",
                    createdAt: admin.firestore.FieldValue.serverTimestamp(),
                    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
                });
                eventCount++;
            }
            else {
                // スタッフ系は group+time+location でまとめる
                const key = `${group}|${inTime}|${outTime}|${location}`;
                if (!staffGroups.has(key)) {
                    staffGroups.set(key, {
                        notionPageId: pageId,
                        team,
                        group,
                        shootingDate,
                        inTime,
                        outTime,
                        location,
                        staffNames: [],
                        isIndividualEvent: false,
                        calendarStatus: "pending",
                        sourceSheetUrl: data.koubanSheetUrl || "",
                        createdAt: admin.firestore.FieldValue.serverTimestamp(),
                        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
                    });
                }
                const entry = staffGroups.get(key);
                if (staff && !entry.staffNames.includes(staff)) {
                    entry.staffNames.push(staff);
                }
            }
        }
        // グループイベントをbatchに追加
        staffGroups.forEach((ev) => {
            const timeKey = `${ev.inTime}${ev.outTime}`.replace(/:/g, "");
            const locHash = (0, _helpers_1.simpleHash)(ev.location || "");
            const groupKey = ev.group.replace(/\s+/g, "");
            const eventDocId = `${pageId}_${groupKey}_${timeKey}_${locHash}`;
            eventBatch.set(db.doc(`shootingEvents/${eventDocId}`), ev);
            eventCount++;
        });
        if (eventCount > 0) {
            await eventBatch.commit();
            console.log(`[dispatch] shootingEvents created: ${eventCount}`);
        }
    }
    // ── 3. Slack通知を Cloud Tasks で予約 ──
    if (fdNames.length > 0 && outDateTimeISO) {
        try {
            await scheduleOffshotSlack(pageId, team, shootingDate, fdNames, outDateTimeISO);
        }
        catch (e) {
            console.error("[dispatch] Slack schedule failed (continue):", e);
        }
    }
    else {
        console.log(`[dispatch] Slack skip: fd=${fdNames.length}, outISO=${outDateTimeISO}`);
    }
    // ── 4. 完了マーク + rows削除 ──
    await docRef.update({
        status: "processed",
        processedAt: admin.firestore.FieldValue.serverTimestamp(),
        rows: admin.firestore.FieldValue.delete(),
        rowCount,
        shootingEventCount: eventCount,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        errorMessage: "",
    });
    console.log(`[dispatch] ✅ Processed: ${pageId} (events=${eventCount}, rows deleted)`);
}
/**
 * Cloud Tasks で Slack通知を outDateTime+10分にスケジュール
 */
async function scheduleOffshotSlack(pageId, team, shootingDate, fdNames, outDateTimeISO) {
    const client = new tasks_1.CloudTasksClient();
    const queuePath = client.queuePath(PROJECT_ID, LOCATION, TASKS_QUEUE);
    // OUT + 10分
    const scheduleTime = new Date(new Date(outDateTimeISO).getTime() + 10 * 60 * 1000);
    const now = Date.now();
    const targetMs = Math.max(scheduleTime.getTime(), now + 30000); // 最低30秒後
    // 予約前に offshotNotifications にレコードを作成
    const db = admin.firestore();
    await db.doc(`offshotNotifications/${pageId}`).set({
        notionPageId: pageId,
        team,
        shootingDate,
        fdNames,
        outDateTimeISO,
        scheduledAt: admin.firestore.Timestamp.fromMillis(targetMs),
        status: "scheduled",
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });
    // Cloud Task 作成
    const serviceAccountEmail = `${PROJECT_ID}@appspot.gserviceaccount.com`;
    const body = Buffer.from(JSON.stringify({ pageId })).toString("base64");
    const [response] = await client.createTask({
        parent: queuePath,
        task: {
            httpRequest: {
                httpMethod: "POST",
                url: CF_URL_SEND_SLACK,
                body,
                headers: { "Content-Type": "application/json" },
                oidcToken: { serviceAccountEmail, audience: CF_URL_SEND_SLACK },
            },
            scheduleTime: {
                seconds: Math.floor(targetMs / 1000),
            },
        },
    });
    // Task名を書き戻し(キャンセル用)
    await db.doc(`offshotNotifications/${pageId}`).update({
        taskName: response.name || "",
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    const delayMinutes = Math.round((targetMs - now) / 60000);
    console.log(`[scheduleOffshotSlack] ✅ Task created: ${response.name} (fires in ${delayMinutes}min)`);
}
//# sourceMappingURL=dispatchShootingSubmission.js.map