"use strict";
/**
 * Cloud Functions - オフショットDriveのファイル数同期
 *
 * オフショットの大元フォルダ配下にある各案件フォルダ（offshotDrive.driveLink）を
 * Drive API で覗き、中のファイル数を数える。
 *
 * フロー:
 *   1. offshotDrive コレクション全件取得
 *   2. driveLink から folderId を抽出し、folder 直下のファイル数をカウント
 *   3. offshotDrive ドキュメントに fileCount / fileCountCheckedAt を保存
 *   4. projectId が一致する castings に makingFileCount を伝搬
 *
 * 認証: GOOGLE_SERVICE_ACCOUNT_KEY（Calendar と共用）を drive.readonly スコープで使用。
 *       サービスアカウント firebase-adminsdk-fbsvc@gokko-casty.iam.gserviceaccount.com を
 *       オフショット大元フォルダに「閲覧者」として共有しておくこと。
 *
 * スケジュール: 毎日 22:00 JST。手動実行用に onCall 版も併設。
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
exports.syncOffshotFileCounts = exports.scheduledSyncOffshotFileCounts = void 0;
exports.extractFolderId = extractFolderId;
const https_1 = require("firebase-functions/v2/https");
const scheduler_1 = require("firebase-functions/v2/scheduler");
const admin = __importStar(require("firebase-admin"));
const googleapis_1 = require("googleapis");
const SECRET = "GOOGLE_SERVICE_ACCOUNT_KEY";
const FOLDER_MIME = "application/vnd.google-apps.folder";
/**
 * Drive APIクライアントを取得（読み取り専用）
 */
function getDriveClient(serviceAccountKey) {
    const credentials = JSON.parse(serviceAccountKey);
    const auth = new googleapis_1.google.auth.GoogleAuth({
        credentials,
        scopes: ["https://www.googleapis.com/auth/drive.readonly"],
    });
    return googleapis_1.google.drive({ version: "v3", auth });
}
/**
 * Drive フォルダのURLから folderId を抽出する。
 * 例: https://drive.google.com/drive/folders/<ID>?usp=sharing
 *     https://drive.google.com/drive/u/0/folders/<ID>
 *     https://drive.google.com/open?id=<ID>
 */
function extractFolderId(driveLink) {
    if (!driveLink)
        return null;
    const folderMatch = driveLink.match(/\/folders\/([a-zA-Z0-9_-]+)/);
    if (folderMatch)
        return folderMatch[1];
    const idParam = driveLink.match(/[?&]id=([a-zA-Z0-9_-]+)/);
    if (idParam)
        return idParam[1];
    return null;
}
/**
 * 指定フォルダ直下のファイル数（サブフォルダを除く）を数える。
 * ページネーションで全件取得。共有ドライブにも対応。
 */
async function countFilesInFolder(drive, folderId) {
    let count = 0;
    let pageToken;
    do {
        const res = await drive.files.list({
            q: `'${folderId}' in parents and trashed = false and mimeType != '${FOLDER_MIME}'`,
            fields: "nextPageToken, files(id)",
            pageSize: 1000,
            supportsAllDrives: true,
            includeItemsFromAllDrives: true,
            corpora: "allDrives",
            pageToken,
        });
        count += res.data.files?.length ?? 0;
        pageToken = res.data.nextPageToken ?? undefined;
    } while (pageToken);
    return count;
}
/**
 * 本体処理。scheduled / onCall の両方から呼ぶ。
 */
async function performOffshotFileCountSync(serviceAccountKey) {
    const db = admin.firestore();
    const drive = getDriveClient(serviceAccountKey);
    const driveSnap = await db.collection("offshotDrive").get();
    if (driveSnap.empty) {
        return { drivesProcessed: 0, drivesFailed: 0, castingsUpdated: 0 };
    }
    // notionPageId（複数正規化形式）-> fileCount のマップ
    const countByProjectId = new Map();
    let drivesProcessed = 0;
    let drivesFailed = 0;
    for (const doc of driveSnap.docs) {
        const data = doc.data();
        const driveLink = data.driveLink;
        const notionPageId = data.notionPageId;
        const folderId = driveLink ? extractFolderId(driveLink) : null;
        if (!folderId) {
            drivesFailed++;
            console.warn(`[offshotFileCounts] folderId 抽出失敗: doc=${doc.id} link=${driveLink}`);
            continue;
        }
        try {
            const fileCount = await countFilesInFolder(drive, folderId);
            await doc.ref.update({
                fileCount,
                fileCountCheckedAt: admin.firestore.FieldValue.serverTimestamp(),
            });
            drivesProcessed++;
            if (notionPageId) {
                const raw = String(notionPageId);
                countByProjectId.set(raw, fileCount);
                countByProjectId.set(raw.replace(/-/g, "").toLowerCase(), fileCount);
                countByProjectId.set(raw.toLowerCase(), fileCount);
            }
        }
        catch (e) {
            drivesFailed++;
            const msg = e instanceof Error ? e.message : String(e);
            console.error(`[offshotFileCounts] カウント失敗: doc=${doc.id} folder=${folderId}: ${msg}`);
        }
    }
    // castings へ伝搬（contactStatus が設定済みのもののみ）
    const contactsSnap = await db
        .collection("castings")
        .where("contactStatus", "!=", null)
        .get();
    let castingsUpdated = 0;
    let batch = db.batch();
    let batchOps = 0;
    for (const contactDoc of contactsSnap.docs) {
        const contact = contactDoc.data();
        if (!contact.projectId)
            continue;
        const normalizedId = String(contact.projectId).replace(/-/g, "").toLowerCase();
        const fileCount = countByProjectId.get(normalizedId);
        if (fileCount === undefined)
            continue;
        // 値が変わらないものは書き込まない
        if (contact.makingFileCount === fileCount)
            continue;
        batch.update(contactDoc.ref, { makingFileCount: fileCount });
        castingsUpdated++;
        batchOps++;
        // Firestore バッチは 500 件まで
        if (batchOps >= 450) {
            await batch.commit();
            batch = db.batch();
            batchOps = 0;
        }
    }
    if (batchOps > 0) {
        await batch.commit();
    }
    return { drivesProcessed, drivesFailed, castingsUpdated };
}
/**
 * 定期実行: 毎日 22:00 JST
 */
exports.scheduledSyncOffshotFileCounts = (0, scheduler_1.onSchedule)({
    schedule: "0 22 * * *",
    timeZone: "Asia/Tokyo",
    secrets: [SECRET],
    memory: "512MiB",
    timeoutSeconds: 540,
    maxInstances: 1,
}, async () => {
    const key = process.env[SECRET];
    if (!key) {
        console.error("[scheduledSyncOffshotFileCounts] GOOGLE_SERVICE_ACCOUNT_KEY が未設定");
        return;
    }
    try {
        const r = await performOffshotFileCountSync(key);
        console.log(`[scheduledSyncOffshotFileCounts] Done processed=${r.drivesProcessed} ` +
            `failed=${r.drivesFailed} castingsUpdated=${r.castingsUpdated}`);
    }
    catch (e) {
        console.error("[scheduledSyncOffshotFileCounts] Error:", e);
    }
});
/**
 * 手動実行用（メイキング共有待ちタブの同期ボタンなどから呼べる）
 */
exports.syncOffshotFileCounts = (0, https_1.onCall)({
    secrets: [SECRET],
    memory: "512MiB",
    timeoutSeconds: 540,
    maxInstances: 3,
}, async () => {
    const key = process.env[SECRET];
    if (!key) {
        throw new https_1.HttpsError("failed-precondition", "GOOGLE_SERVICE_ACCOUNT_KEY が未設定です");
    }
    try {
        const r = await performOffshotFileCountSync(key);
        return { success: true, ...r };
    }
    catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.error("[syncOffshotFileCounts] Error:", e);
        throw new https_1.HttpsError("internal", "オフショットファイル数の同期に失敗: " + msg);
    }
});
//# sourceMappingURL=syncOffshotFileCounts.js.map