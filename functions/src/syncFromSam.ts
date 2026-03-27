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

import { onCall, HttpsError } from "firebase-functions/v2/https";
import { onSchedule } from "firebase-functions/v2/scheduler";
import * as admin from "firebase-admin";

// ─────────────────────────────────────────────
// gokko-sam 用の Firebase Admin インスタンス
// ─────────────────────────────────────────────
const SAM_PROJECT_ID = "gokko-sam";

let samApp: admin.app.App | null = null;

function getSamApp(): admin.app.App {
    if (!samApp) {
        samApp = admin.initializeApp(
            {
                projectId: SAM_PROJECT_ID,
            },
            "gokko-sam" // 名前付きインスタンス
        );
    }
    return samApp;
}

function getSamFirestore(): admin.firestore.Firestore {
    return admin.firestore(getSamApp());
}

// ─────────────────────────────────────────────
// ロールマッピング
// ─────────────────────────────────────────────
interface NotionScheduleEntry {
    isGokko: boolean;
    person: string;
    role: string;
}

interface NotionScheduleDoc {
    date: string;
    title: string;
    team: string;
    notionPageId: string;
    entries: NotionScheduleEntry[];
}

/**
 * entries 配列からロール別にスタッフをマッピング
 */
function mapEntriesToShootingFields(entries: NotionScheduleEntry[]): {
    cd: string;
    fd: string;
    producer: string;
    chiefProducer: string;
    six: string;
    camera: string;
    costume: string;
    hairMakeup: string;
    allStaff: string[];
} {
    const roleMap: Record<string, string[]> = {};
    const allStaff: string[] = [];

    for (const entry of entries) {
        const person = (entry.person || "").trim();
        if (!person) continue;

        const role = (entry.role || "").trim();

        // allStaff に全員追加（重複排除）
        if (!allStaff.includes(person)) {
            allStaff.push(person);
        }

        // ロール別に振り分け
        if (!roleMap[role]) roleMap[role] = [];
        if (!roleMap[role]!.includes(person)) {
            roleMap[role]!.push(person);
        }
    }

    const getPersons = (...roles: string[]): string => {
        const persons: string[] = [];
        for (const r of roles) {
            if (roleMap[r]) {
                for (const p of roleMap[r]!) {
                    if (!persons.includes(p)) persons.push(p);
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
async function performSync(): Promise<{ synced: number; errors: number; dateChanges: number }> {
    const samDb = getSamFirestore();
    const castyDb = admin.firestore(); // デフォルト (gokko-casty)

    // gokko-sam の notionSchedule を全件取得
    const snapshot = await samDb.collection("notionSchedule").get();

    if (snapshot.empty) {
        console.log("[syncFromSam] notionSchedule is empty");
        return { synced: 0, errors: 0, dateChanges: 0 };
    }

    console.log(`[syncFromSam] Found ${snapshot.size} notionSchedule docs`);

    let synced = 0;
    let errors = 0;
    let dateChanges = 0;

    // バッチ書き込み（500件制限対応）
    const batchDocs: Array<{
        docId: string;
        data: Record<string, unknown>;
    }> = [];

    for (const doc of snapshot.docs) {
        try {
            const raw = doc.data() as NotionScheduleDoc;

            if (!raw.notionPageId) {
                console.warn(`[syncFromSam] Skipping doc ${doc.id}: no notionPageId`);
                continue;
            }

            // ドキュメントID: notionPageId をサニタイズ
            const baseDocId = raw.notionPageId
                .replace(/[/.]/g, "_")
                .replace(/^__/, "xx")
                .trim();

            if (!baseDocId) continue;

            // entries からロール別マッピング
            const staffFields = mapEntriesToShootingFields(raw.entries || []);

            const incomingDate = raw.date || ""; // "2026-03-10" 形式

            // 既存ドキュメントをチェックして日付変更を検知
            const existingDoc = await castyDb
                .collection("shootings")
                .doc(baseDocId)
                .get();

            let docId = baseDocId;

            if (existingDoc.exists) {
                const existingData = existingDoc.data();
                const existingDate = existingData?.shootDate || "";

                if (existingDate && incomingDate && existingDate !== incomingDate) {
                    // 日付が変更された → 旧ドキュメントにマーク + 新しいIDで作成
                    console.log(
                        `[syncFromSam] Date changed for ${raw.notionPageId}: ${existingDate} → ${incomingDate}`
                    );

                    // 旧ドキュメントに日付変更フラグを記録
                    await castyDb
                        .collection("shootings")
                        .doc(baseDocId)
                        .update({
                            dateChanged: true,
                            dateChangedFrom: existingDate,
                            dateChangedTo: incomingDate,
                            dateChangedAt: admin.firestore.FieldValue.serverTimestamp(),
                        });

                    // 新しいドキュメントID: notionPageId_YYYYMMDD
                    const dateSuffix = incomingDate.replace(/-/g, "");
                    docId = `${baseDocId}_${dateSuffix}`;
                    dateChanges++;
                }
            }

            // shootings ドキュメント形式に変換
            const shootingData: Record<string, unknown> = {
                title: raw.title || "",
                shootDate: incomingDate,
                team: raw.team || "",
                notionPageId: raw.notionPageId,
                notionUrl: "https://www.notion.so/" + raw.notionPageId.replace(/-/g, ""),
                ...staffFields,
                syncSource: "gokko-sam",
                updatedAt: admin.firestore.FieldValue.serverTimestamp(),
            };

            batchDocs.push({ docId, data: shootingData });
        } catch (e) {
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

    console.log(
        `[syncFromSam] Sync complete: ${synced} synced, ${dateChanges} date changes, ${errors} errors`
    );
    return { synced, errors, dateChanges };
}

// ─────────────────────────────────────────────
// Exported Cloud Functions
// ─────────────────────────────────────────────

/**
 * 手動トリガー用（onCall）
 * フロントから呼び出したり、Firebase Console から手動実行可能
 */
export const syncScheduleFromSam = onCall(
    { maxInstances: 1 },
    async () => {
        try {
            const result = await performSync();
            return {
                success: true,
                ...result,
            };
        } catch (e) {
            console.error("[syncScheduleFromSam] Error:", e);
            throw new HttpsError("internal", "Sync failed: " + (e instanceof Error ? e.message : String(e)));
        }
    }
);

/**
 * 定期実行用（2時間毎）
 * Cloud Scheduler で自動トリガー
 */
export const scheduledSyncFromSam = onSchedule(
    {
        schedule: "every 2 hours",
        timeZone: "Asia/Tokyo",
        maxInstances: 1,
    },
    async () => {
        try {
            const result = await performSync();
            console.log(`[scheduledSyncFromSam] Done: ${result.synced} synced, ${result.errors} errors`);
        } catch (e) {
            console.error("[scheduledSyncFromSam] Error:", e);
        }
    }
);
