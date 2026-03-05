"use strict";
/**
 * Cloud Functions - gokko-sam の notionSchedule → gokko-casty の shootings 同期
 *
 * gokko-sam プロジェクトの Firestore `notionSchedule` コレクションから
 * 撮影スケジュールデータを読み取り、gokko-casty の `shootings` コレクションに
 * マッピングして書き込む。
 *
 * 前提: gokko-sam の IAM に gokko-casty@appspot.gserviceaccount.com を
 * Cloud Datastore User として追加済み。
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
exports.scheduledSyncFromSam = exports.syncScheduleFromSam = void 0;
const https_1 = require("firebase-functions/v2/https");
const scheduler_1 = require("firebase-functions/v2/scheduler");
const admin = __importStar(require("firebase-admin"));
// ─────────────────────────────────────────────
// gokko-sam 用の Firebase Admin インスタンス
// ─────────────────────────────────────────────
const SAM_PROJECT_ID = "gokko-sam";
let samApp = null;
function getSamApp() {
    if (!samApp) {
        samApp = admin.initializeApp({
            projectId: SAM_PROJECT_ID,
        }, "gokko-sam" // 名前付きインスタンス
        );
    }
    return samApp;
}
function getSamFirestore() {
    return admin.firestore(getSamApp());
}
/**
 * entries 配列からロール別にスタッフをマッピング
 */
function mapEntriesToShootingFields(entries) {
    const roleMap = {};
    const allStaff = [];
    for (const entry of entries) {
        const person = (entry.person || "").trim();
        if (!person)
            continue;
        const role = (entry.role || "").trim();
        // allStaff に全員追加（重複排除）
        if (!allStaff.includes(person)) {
            allStaff.push(person);
        }
        // ロール別に振り分け
        if (!roleMap[role])
            roleMap[role] = [];
        if (!roleMap[role].includes(person)) {
            roleMap[role].push(person);
        }
    }
    const getPersons = (...roles) => {
        const persons = [];
        for (const r of roles) {
            if (roleMap[r]) {
                for (const p of roleMap[r]) {
                    if (!persons.includes(p))
                        persons.push(p);
                }
            }
        }
        return persons.join(", ");
    };
    return {
        cd: getPersons("CD"),
        fd: getPersons("FD/SD", "FD"),
        producer: getPersons("P"),
        chiefProducer: getPersons("制作チーフ"),
        six: getPersons("SIX"),
        camera: getPersons("カメラ"),
        costume: getPersons("衣装"),
        hairMakeup: getPersons("ヘアメイク"),
        allStaff,
    };
}
// ─────────────────────────────────────────────
// 同期メインロジック
// ─────────────────────────────────────────────
async function performSync() {
    const samDb = getSamFirestore();
    const castyDb = admin.firestore(); // デフォルト (gokko-casty)
    // gokko-sam の notionSchedule を全件取得
    const snapshot = await samDb.collection("notionSchedule").get();
    if (snapshot.empty) {
        console.log("[syncFromSam] notionSchedule is empty");
        return { synced: 0, errors: 0 };
    }
    console.log(`[syncFromSam] Found ${snapshot.size} notionSchedule docs`);
    let synced = 0;
    let errors = 0;
    // バッチ書き込み（500件制限対応）
    const batchDocs = [];
    for (const doc of snapshot.docs) {
        try {
            const raw = doc.data();
            if (!raw.notionPageId) {
                console.warn(`[syncFromSam] Skipping doc ${doc.id}: no notionPageId`);
                continue;
            }
            // ドキュメントID: notionPageId をサニタイズ
            const docId = raw.notionPageId
                .replace(/[/.]/g, "_")
                .replace(/^__/, "xx")
                .trim();
            if (!docId)
                continue;
            // entries からロール別マッピング
            const staffFields = mapEntriesToShootingFields(raw.entries || []);
            // shootings ドキュメント形式に変換
            const shootingData = {
                title: raw.title || "",
                shootDate: raw.date || "", // "2026-03-10" 形式（文字列）
                team: raw.team || "",
                notionPageId: raw.notionPageId,
                notionUrl: "https://www.notion.so/" + raw.notionPageId.replace(/-/g, ""),
                ...staffFields,
                syncSource: "gokko-sam", // 同期元の識別子
                updatedAt: admin.firestore.FieldValue.serverTimestamp(),
            };
            batchDocs.push({ docId, data: shootingData });
        }
        catch (e) {
            console.error(`[syncFromSam] Error processing doc ${doc.id}:`, e);
            errors++;
        }
    }
    // Firestore バッチ書き込み（500件ずつ）
    for (let i = 0; i < batchDocs.length; i += 500) {
        const chunk = batchDocs.slice(i, i + 500);
        const batch = castyDb.batch();
        for (const item of chunk) {
            const ref = castyDb.collection("shootings").doc(item.docId);
            batch.set(ref, item.data, { merge: true }); // merge: 既存フィールドを保持
        }
        await batch.commit();
        synced += chunk.length;
        console.log(`[syncFromSam] Batch committed: ${chunk.length} docs (total: ${synced})`);
    }
    console.log(`[syncFromSam] Sync complete: ${synced} synced, ${errors} errors`);
    return { synced, errors };
}
// ─────────────────────────────────────────────
// Exported Cloud Functions
// ─────────────────────────────────────────────
/**
 * 手動トリガー用（onCall）
 * フロントから呼び出したり、Firebase Console から手動実行可能
 */
exports.syncScheduleFromSam = (0, https_1.onCall)({ maxInstances: 1 }, async () => {
    try {
        const result = await performSync();
        return {
            success: true,
            ...result,
        };
    }
    catch (e) {
        console.error("[syncScheduleFromSam] Error:", e);
        throw new https_1.HttpsError("internal", "Sync failed: " + (e instanceof Error ? e.message : String(e)));
    }
});
/**
 * 定期実行用（2時間毎）
 * Cloud Scheduler で自動トリガー
 */
exports.scheduledSyncFromSam = (0, scheduler_1.onSchedule)({
    schedule: "every 2 hours",
    timeZone: "Asia/Tokyo",
    maxInstances: 1,
}, async () => {
    try {
        const result = await performSync();
        console.log(`[scheduledSyncFromSam] Done: ${result.synced} synced, ${result.errors} errors`);
    }
    catch (e) {
        console.error("[scheduledSyncFromSam] Error:", e);
    }
});
//# sourceMappingURL=syncFromSam.js.map