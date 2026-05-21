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
exports.backfillCastingProjectName = exports.consolidateShootingDuplicates = exports.scheduledSyncFromSam = exports.syncScheduleFromSam = void 0;
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
        return { synced: 0, added: 0, updated: 0, errors: 0, dateChanges: 0, deletedMarked: 0, restored: 0 };
    }
    console.log(`[syncFromSam] Found ${snapshot.size} notionSchedule docs`);
    let synced = 0;
    let added = 0;
    let updated = 0;
    let errors = 0;
    let dateChanges = 0;
    let restored = 0;
    // バッチ書き込み（500件制限対応）
    const batchDocs = [];
    // Notion 側に現存する notionPageId 集合（削除検知に使用）
    const incomingNotionIds = new Set();
    for (const doc of snapshot.docs) {
        try {
            const raw = doc.data();
            if (!raw.notionPageId) {
                console.warn(`[syncFromSam] Skipping doc ${doc.id}: no notionPageId`);
                continue;
            }
            incomingNotionIds.add(raw.notionPageId);
            // ドキュメントID: notionPageId をサニタイズ。同 NotionID = 同ドキュメントに統一
            const baseDocId = raw.notionPageId
                .replace(/[/.]/g, "_")
                .replace(/^__/, "xx")
                .trim();
            if (!baseDocId)
                continue;
            // entries からロール別マッピング
            const staffFields = mapEntriesToShootingFields(raw.entries || []);
            const incomingDate = raw.date || ""; // "2026-03-10" 形式
            // title の先頭が "YYYY-MM-DD_" 形式の日付プレフィックスなら除去
            // （古い同期/手入力で混入した分の正規化）
            let cleanTitle = raw.title || "";
            const datePrefixMatch = cleanTitle.match(/^\d{4}-\d{2}-\d{2}_(.+)$/);
            if (datePrefixMatch && datePrefixMatch[1]) {
                cleanTitle = datePrefixMatch[1];
            }
            // 既存ドキュメントをチェックして日付変更を検知
            const existingDoc = await castyDb
                .collection("shootings")
                .doc(baseDocId)
                .get();
            // shootings ドキュメント形式に変換
            const shootingData = {
                title: cleanTitle,
                shootDate: incomingDate,
                team: raw.team || "",
                notionPageId: raw.notionPageId,
                notionUrl: "https://www.notion.so/" + raw.notionPageId.replace(/-/g, ""),
                ...staffFields,
                syncSource: "gokko-sam",
                deleted: false, // Notion に存在する間は常に false（復活も自動反映）
                updatedAt: admin.firestore.FieldValue.serverTimestamp(),
            };
            if (existingDoc.exists) {
                const existingData = existingDoc.data();
                const existingDate = existingData?.shootDate || "";
                if (existingDate && incomingDate && existingDate !== incomingDate) {
                    // 日付変更を検知 → 既存ドキュメントを上書きし、履歴を残す
                    console.log(`[syncFromSam] Date changed for ${raw.notionPageId}: ${existingDate} → ${incomingDate} (in-place update)`);
                    shootingData.dateHistory = admin.firestore.FieldValue.arrayUnion({
                        from: existingDate,
                        to: incomingDate,
                        changedAt: new Date(),
                    });
                    dateChanges++;
                }
                if (existingData?.deleted === true) {
                    restored++;
                }
            }
            const isNew = !existingDoc.exists;
            batchDocs.push({ docId: baseDocId, data: shootingData, isNew });
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
        for (const item of chunk) {
            if (item.isNew)
                added++;
            else
                updated++;
        }
        synced += chunk.length;
        console.log(`[syncFromSam] Batch committed: ${chunk.length} docs (total: ${synced})`);
    }
    // ── 削除検知 ──
    // gokko-sam 由来の shootings のうち、Notion 側に notionPageId が無いものを deleted:true に
    let deletedMarked = 0;
    try {
        // notionPageId を持つ shooting は全て Notion 同期由来とみなす。
        // syncSource フィルタを掛けると古い同期で syncSource=undefined のドキュメントを取りこぼし、
        // 件数差が解消されないため、ここでは notionPageId の有無で判定する。
        // 手動作成の shooting は notionPageId を持たないので影響なし。
        const allShootSnap = await castyDb.collection("shootings").get();
        const toMark = [];
        for (const s of allShootSnap.docs) {
            const sd = s.data();
            const pageId = sd.notionPageId;
            if (!pageId)
                continue;
            if (!incomingNotionIds.has(pageId) && sd.deleted !== true) {
                toMark.push(s.ref);
            }
        }
        for (let i = 0; i < toMark.length; i += 500) {
            const chunk = toMark.slice(i, i + 500);
            const batch = castyDb.batch();
            for (const ref of chunk) {
                batch.update(ref, {
                    deleted: true,
                    deletedAt: admin.firestore.FieldValue.serverTimestamp(),
                });
            }
            await batch.commit();
            deletedMarked += chunk.length;
        }
        if (deletedMarked > 0) {
            console.log(`[syncFromSam] Marked ${deletedMarked} shootings as deleted (Notion removed)`);
        }
    }
    catch (e) {
        console.error("[syncFromSam] Deletion detection failed:", e);
    }
    console.log(`[syncFromSam] Sync complete: ${synced} synced (${added} added, ${updated} updated), ${dateChanges} date changes, ${deletedMarked} marked deleted, ${restored} restored, ${errors} errors`);
    return { synced, added, updated, errors, dateChanges, deletedMarked, restored };
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
/**
 * 既存の `<baseDocId>_<YYYYMMDD>` 形式の重複 shooting ドキュメントを
 * baseDocId 側に集約するための 1 回限りの管理者 onCall。
 *
 * - サフィックス付きドキュメントの最新 shootDate を baseDocId 側にコピー
 * - サフィックス付きドキュメントは deleted:true でマーク
 * - dryRun=true なら集約対象を返すだけで書き込みしない
 */
exports.consolidateShootingDuplicates = (0, https_1.onCall)({ maxInstances: 1 }, async (req) => {
    const dryRun = req.data?.dryRun !== false; // デフォルト dryRun
    const db = admin.firestore();
    const snap = await db.collection("shootings").get();
    const suffixRegex = /^(.+)_(\d{8})$/;
    // baseDocId -> [{docId, shootDate, exists, ref}]
    const groups = new Map();
    const baseExists = new Set();
    for (const doc of snap.docs) {
        const id = doc.id;
        const data = doc.data();
        const shootDate = data.shootDate || "";
        const m = id.match(suffixRegex);
        if (m && m[1]) {
            const base = m[1];
            const arr = groups.get(base) || [];
            arr.push({ docId: id, shootDate, ref: doc.ref });
            groups.set(base, arr);
        }
        else {
            baseExists.add(id);
        }
    }
    const actions = [];
    for (const [base, suffixDocs] of groups.entries()) {
        // 日付の新しい順
        suffixDocs.sort((a, b) => b.shootDate.localeCompare(a.shootDate));
        const latest = suffixDocs[0];
        actions.push({
            base,
            latestSuffixDoc: latest.docId,
            latestDate: latest.shootDate,
            baseDocExists: baseExists.has(base),
            markDeleted: suffixDocs.map(d => d.docId),
        });
    }
    if (dryRun) {
        return { dryRun: true, groups: actions.length, actions };
    }
    // 適用
    let merged = 0;
    let markedDeleted = 0;
    for (const a of actions) {
        const baseRef = db.collection("shootings").doc(a.base);
        // 最新日付を baseDoc 側に書き込む（baseDoc が無い場合は最新サフィックスのデータを丸ごとコピー）
        const latestSuffixSnap = await db.collection("shootings").doc(a.latestSuffixDoc).get();
        const latestData = latestSuffixSnap.data() || {};
        await baseRef.set({
            ...latestData,
            shootDate: a.latestDate,
            deleted: false,
            consolidatedFrom: a.latestSuffixDoc,
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        }, { merge: true });
        merged++;
        // サフィックス付きを全て deleted:true でマーク
        for (const suffixId of a.markDeleted) {
            await db.collection("shootings").doc(suffixId).update({
                deleted: true,
                deletedAt: admin.firestore.FieldValue.serverTimestamp(),
                consolidatedInto: a.base,
            });
            markedDeleted++;
        }
    }
    return { dryRun: false, merged, markedDeleted, actions };
});
/**
 * 既存 casting の projectName を shooting.team で一括上書きするバックフィル onCall。
 *
 * 既にオーダー済みの casting.projectName には、オーダー時点の値（Notion Title = 監督名のことが多い）が
 * コピー保存されている。表示時に「team（作品名）」で出るよう、shooting.team を正として書き戻す。
 *
 * 入力: { dryRun?: boolean (default true), accountFilter?: string }
 * 出力: dryRun=true → { count, updates[:100], totalCount }
 *       dryRun=false → { applied, totalCount }
 */
exports.backfillCastingProjectName = (0, https_1.onCall)({ maxInstances: 1 }, async (req) => {
    const dryRun = req.data?.dryRun !== false;
    const accountFilter = req.data?.accountFilter || undefined;
    const db = admin.firestore();
    // shootings: notionPageId → team
    const shootSnap = await db.collection("shootings").get();
    const teamByNotionId = new Map();
    for (const s of shootSnap.docs) {
        const d = s.data();
        if (d.deleted === true)
            continue;
        const npid = d.notionPageId;
        const team = d.team || "";
        if (!npid || !team)
            continue;
        teamByNotionId.set(npid, team);
    }
    let q = db.collection("castings");
    if (accountFilter)
        q = q.where("accountName", "==", accountFilter);
    const castingSnap = await q.get();
    const updates = [];
    for (const c of castingSnap.docs) {
        const cd = c.data();
        const pid = cd.projectId;
        if (!pid)
            continue;
        const team = teamByNotionId.get(pid);
        if (!team)
            continue;
        const current = cd.projectName || "";
        if (current === team)
            continue;
        updates.push({ id: c.id, from: current, to: team });
    }
    if (dryRun) {
        return {
            dryRun: true,
            totalCount: updates.length,
            preview: updates.slice(0, 100),
        };
    }
    let applied = 0;
    for (let i = 0; i < updates.length; i += 500) {
        const chunk = updates.slice(i, i + 500);
        const batch = db.batch();
        for (const u of chunk) {
            batch.update(db.collection("castings").doc(u.id), {
                projectName: u.to,
                projectNameBackfilledFrom: u.from,
                projectNameBackfilledAt: admin.firestore.FieldValue.serverTimestamp(),
            });
        }
        await batch.commit();
        applied += chunk.length;
    }
    return { dryRun: false, applied, totalCount: updates.length };
});
//# sourceMappingURL=syncFromSam.js.map