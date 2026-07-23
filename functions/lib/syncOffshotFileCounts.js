"use strict";
/**
 * Cloud Functions - オフショットDriveのファイル数同期
 *
 * 各案件フォルダ（projects.driveFolderUrl）を Drive API で覗き、中のファイル数を数える。
 * ※ 旧 offshotDrive (GAS スプレッドシート同期) は 2026-05 に停止したため、稼働中の
 *    projects.driveFolderUrl（Notion 直接同期 CF が更新）を参照元にしている。
 *
 * フロー:
 *   1. projects コレクション全件取得（driveFolderUrl = 案件ルートフォルダ）
 *   2. ルートから 02_広報/01_撮影オフショット を辿りオフショットフォルダを解決、直下のファイル数をカウント
 *   3. projects に offshotFileCount / offshotFileCountCheckedAt（+ 空なら offshotUrl）を保存
 *   4. projectId が一致する castings に makingFileCount / makingUrl を伝搬
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
exports.scheduledRemindOffshotUnfilled = exports.syncOffshotFileCounts = exports.scheduledSyncOffshotFileCounts = void 0;
exports.getDriveClient = getDriveClient;
exports.extractFolderId = extractFolderId;
exports.countFilesInFolder = countFilesInFolder;
exports.resolveOffshotFolderId = resolveOffshotFolderId;
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
 * 親フォルダ直下のサブフォルダから、名前が regex にマッチする最初のフォルダ ID を返す。
 */
async function findChildFolder(drive, parentId, regex) {
    const res = await drive.files.list({
        q: `'${parentId}' in parents and trashed = false and mimeType = '${FOLDER_MIME}'`,
        fields: "files(id, name)",
        pageSize: 200,
        supportsAllDrives: true,
        includeItemsFromAllDrives: true,
        corpora: "allDrives",
    });
    const hit = (res.data.files || []).find((f) => regex.test(f.name || ""));
    return hit?.id ?? null;
}
/**
 * 案件ルートフォルダ配下の「02_広報（…）/01_撮影オフショット（…）」を辿って
 * オフショットフォルダの ID を返す。テンプレ構造に依存（全角/半角カッコ揺れは正規表現で吸収）。
 * GAS の extractOffshotToFirestore と同等の解決を CF 内でリアルタイムに行う。
 */
async function resolveOffshotFolderId(drive, rootFolderId) {
    const kouhouId = await findChildFolder(drive, rootFolderId, /広報/);
    if (!kouhouId)
        return null;
    return await findChildFolder(drive, kouhouId, /撮影オフショット|オフショット/);
}
/**
 * 本体処理。scheduled / onCall の両方から呼ぶ。
 */
async function performOffshotFileCountSync(serviceAccountKey) {
    const db = admin.firestore();
    const drive = getDriveClient(serviceAccountKey);
    // 参照元: projects.driveFolderUrl（Notion 直接同期 CF が更新する稼働中の案件ルートフォルダ）。
    // ルートから 02_広報/01_撮影オフショット を辿ってオフショットフォルダを解決する。
    // 旧 offshotDrive (GAS スプレッドシート同期) は 2026-05 に停止したため使用しない。
    const projectsSnap = await db.collection("projects").get();
    if (projectsSnap.empty) {
        return { drivesProcessed: 0, drivesFailed: 0, castingsUpdated: 0 };
    }
    // projectId（ハイフン除去・小文字）-> { fileCount, offshotUrl } のマップ
    const infoByProjectId = new Map();
    let drivesProcessed = 0;
    let drivesFailed = 0;
    for (const doc of projectsSnap.docs) {
        const data = doc.data();
        const rootLink = data.driveFolderUrl;
        if (!rootLink)
            continue;
        const rootId = extractFolderId(rootLink);
        if (!rootId) {
            drivesFailed++;
            console.warn(`[offshotFileCounts] folderId 抽出失敗: project=${doc.id} link=${rootLink}`);
            continue;
        }
        try {
            // 既に offshotUrl があればそのフォルダ、無ければルートから辿って解決
            let offshotFolderId = data.offshotUrl ? extractFolderId(data.offshotUrl) : null;
            if (!offshotFolderId) {
                offshotFolderId = await resolveOffshotFolderId(drive, rootId);
            }
            if (!offshotFolderId) {
                drivesFailed++;
                console.warn(`[offshotFileCounts] オフショットフォルダ未検出: project=${doc.id}`);
                continue;
            }
            const fileCount = await countFilesInFolder(drive, offshotFolderId);
            const offshotUrl = data.offshotUrl || `https://drive.google.com/drive/folders/${offshotFolderId}`;
            const projUpdate = {
                offshotFileCount: fileCount,
                offshotFileCountCheckedAt: admin.firestore.FieldValue.serverTimestamp(),
            };
            // 日次 GAS を待たずに projects.offshotUrl を埋める（空のときのみ）
            if (!data.offshotUrl)
                projUpdate.offshotUrl = offshotUrl;
            await doc.ref.update(projUpdate);
            drivesProcessed++;
            // projects の doc id はハイフン無し notion page id
            infoByProjectId.set(doc.id.replace(/-/g, "").toLowerCase(), { fileCount, offshotUrl });
        }
        catch (e) {
            drivesFailed++;
            const msg = e instanceof Error ? e.message : String(e);
            console.error(`[offshotFileCounts] カウント失敗: project=${doc.id} root=${rootId}: ${msg}`);
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
        const info = infoByProjectId.get(normalizedId);
        if (!info)
            continue;
        // makingFileCount は変化時のみ、makingUrl は未設定時のみ書き込む
        const update = {};
        if (contact.makingFileCount !== info.fileCount)
            update.makingFileCount = info.fileCount;
        if (!contact.makingUrl || String(contact.makingUrl).trim() === "")
            update.makingUrl = info.offshotUrl;
        if (Object.keys(update).length === 0)
            continue;
        batch.update(contactDoc.ref, update);
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
/**
 * オフショット未格納リマインド（定期実行: 毎日 10:00 JST）
 *
 * sendSlackOffshot で通知済み（offshotNotifications.status='sent'）のうち、
 * 撮影日の曜日で決まる判定日（月火撮影→同週金曜 / 水〜日撮影→翌週火曜）を迎えたものに
 * ついて、オフショットフォルダの件数を確認し:
 *   - 0 件         → 元の Slack スレッドに再メンションでリマインドを投稿
 *   - 1 件以上格納 → 元のスレッドに「格納ありがとうございます」＋追加時の一報依頼を投稿
 * どちらも 1 回のみ。
 *
 * 冪等性: offshotReminded=true で二重投稿を防止（お礼を送った場合も true にする）。
 */
/**
 * リマインド/お礼の判定日を撮影日の曜日から決める。
 *   月・火 の撮影 → 同じ週の金曜日
 *   水〜日 の撮影 → 翌週の火曜日
 * 判定日を過ぎても未チェックの場合、CATCH_UP_DAYS 日間は追いかけて判定する
 * （実行失敗時の取りこぼし防止）。それより古いものは対象外（スパム防止）。
 */
function reminderTargetYmd(shootYmd) {
    const d = new Date(`${shootYmd}T00:00:00+09:00`);
    if (isNaN(d.getTime()))
        return "";
    const dow = new Date(d.getTime() + 9 * 3600 * 1000).getUTCDay(); // JSTの曜日
    // 月(1)→+4=金, 火(2)→+3=金, 水(3)→+6=翌火, 木(4)→+5, 金(5)→+4, 土(6)→+3, 日(0)→+2
    const addDays = dow === 1 ? 4 : dow === 2 ? 3 : dow === 3 ? 6 : dow === 4 ? 5 : dow === 5 ? 4 : dow === 6 ? 3 : 2;
    const t = new Date(d.getTime() + addDays * 86400 * 1000 + 9 * 3600 * 1000);
    return t.toISOString().slice(0, 10);
}
const CATCH_UP_DAYS = 4;
exports.scheduledRemindOffshotUnfilled = (0, scheduler_1.onSchedule)({
    schedule: "0 10 * * *",
    timeZone: "Asia/Tokyo",
    secrets: [SECRET, "SLACK_OFFSHOT_BOT_TOKEN", "SLACK_CHANNEL_OFFSHOT"],
    memory: "512MiB",
    timeoutSeconds: 300,
    maxInstances: 1,
}, async () => {
    const key = process.env[SECRET];
    const slackToken = process.env.SLACK_OFFSHOT_BOT_TOKEN;
    const slackChannel = process.env.SLACK_CHANNEL_OFFSHOT;
    if (!key || !slackToken || !slackChannel) {
        console.error("[remindOffshot] 必要な secret が未設定 (SA/SLACK_OFFSHOT_BOT_TOKEN/SLACK_CHANNEL_OFFSHOT)");
        return;
    }
    const db = admin.firestore();
    const drive = getDriveClient(key);
    // 今日の日付（JST）
    const todayYmd = new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);
    const snap = await db.collection("offshotNotifications").where("status", "==", "sent").get();
    let checked = 0;
    let reminded = 0;
    let alreadyFilled = 0;
    for (const doc of snap.docs) {
        const n = doc.data();
        if (n.offshotReminded === true)
            continue;
        // 撮影日の曜日で判定日を決定（月火→金曜 / 水〜日→翌週火曜）
        const sentAt = n.sentAt;
        const shootYmd = String(n.shootingDate || "").slice(0, 10)
            || (sentAt?.toDate ? new Date(sentAt.toDate().getTime() + 9 * 3600 * 1000).toISOString().slice(0, 10) : "");
        if (!shootYmd)
            continue;
        const targetYmd = reminderTargetYmd(shootYmd);
        if (!targetYmd)
            continue;
        if (todayYmd < targetYmd)
            continue; // まだ判定日前
        // 判定日から CATCH_UP_DAYS 日を過ぎた古いものは対象外（スパム防止）
        const limit = new Date(new Date(`${targetYmd}T00:00:00Z`).getTime() + CATCH_UP_DAYS * 86400 * 1000).toISOString().slice(0, 10);
        if (todayYmd > limit)
            continue;
        const slackTs = n.slackTs || "";
        if (!slackTs)
            continue; // スレッド親が無いと返信できない
        // オフショットフォルダを解決。
        // ⚠️ offshotUrlAtSend は信用しない: 通知送信時に shootings.driveUrl（作品ルート）へ
        //    フォールバックしていた時期があり、ルート直下の自動生成スプレッドシート（香盤等）を
        //    数えて「格納ありがとう」を誤送信する原因になった。
        //    必ず projects.offshotUrl（＝オフショットサブフォルダ）→ ルートからの走査で解決する。
        let folderId = null;
        let resolvedOffshotUrl = "";
        let rootFolderId = null;
        try {
            const projDoc = await db.collection("projects").doc(doc.id.replace(/-/g, "").toLowerCase()).get();
            const pd = projDoc.exists ? projDoc.data() : {};
            rootFolderId = pd.driveFolderUrl ? extractFolderId(pd.driveFolderUrl) : null;
            folderId = pd.offshotUrl ? extractFolderId(pd.offshotUrl) : null;
            if (folderId && rootFolderId && folderId === rootFolderId)
                folderId = null; // ルートを指していたら不採用
            if (!folderId && rootFolderId) {
                folderId = await resolveOffshotFolderId(drive, rootFolderId);
            }
            if (folderId)
                resolvedOffshotUrl = `https://drive.google.com/drive/folders/${folderId}`;
        }
        catch (e) {
            console.warn(`[remindOffshot] folder 解決失敗 pageId=${doc.id}:`, e);
        }
        // 最後の手段: offshotUrlAtSend（ただしルートと同一なら不採用）
        if (!folderId && n.offshotUrlAtSend) {
            const atSendId = extractFolderId(n.offshotUrlAtSend);
            if (atSendId && atSendId !== rootFolderId) {
                folderId = atSendId;
                resolvedOffshotUrl = n.offshotUrlAtSend;
            }
        }
        if (!folderId)
            continue;
        checked++;
        let fileCount = 0;
        try {
            fileCount = await countFilesInFolder(drive, folderId);
        }
        catch (e) {
            console.warn(`[remindOffshot] カウント失敗 pageId=${doc.id}:`, e);
            continue; // 次回に再試行（フラグは立てない）
        }
        if (fileCount > 0) {
            // 既に格納済み → スレッドにお礼を投稿して以降のチェックを止める
            const mentionIds = Array.isArray(n.resolvedMentionIds) ? n.resolvedMentionIds : [];
            const mentionStr = mentionIds.map((id) => `<@${id}>`).join(" ");
            const thanksText = [
                mentionStr,
                "`オフショットの格納を確認しました。ありがとうございます！`",
                `（現在 ${fileCount}件 格納されています）`,
                "オフショットを新たに追加するときは、こちらで一報ご連絡ください。",
            ].filter(Boolean).join("\n");
            try {
                const res = await fetch("https://slack.com/api/chat.postMessage", {
                    method: "POST",
                    headers: { Authorization: `Bearer ${slackToken}`, "Content-Type": "application/json" },
                    body: JSON.stringify({
                        channel: slackChannel,
                        thread_ts: slackTs,
                        text: thanksText,
                        link_names: true,
                        unfurl_links: false,
                    }),
                });
                const data = await res.json();
                if (!data.ok) {
                    console.warn(`[remindOffshot] お礼投稿失敗 pageId=${doc.id}: ${data.error}`);
                    continue; // フラグは立てず次回再試行
                }
            }
            catch (e) {
                console.warn(`[remindOffshot] お礼投稿例外 pageId=${doc.id}:`, e);
                continue;
            }
            await doc.ref.update({
                offshotReminded: true,
                offshotThanked: true,
                offshotFileCountAtCheck: fileCount,
                offshotThankedAt: admin.firestore.FieldValue.serverTimestamp(),
            });
            alreadyFilled++;
            continue;
        }
        // 0 件 → スレッドにリマインド返信（URL は解決済みのオフショットフォルダを使う）
        const mentionIds = Array.isArray(n.resolvedMentionIds) ? n.resolvedMentionIds : [];
        const mentionStr = mentionIds.map((id) => `<@${id}>`).join(" ");
        const url = resolvedOffshotUrl || n.offshotUrlAtSend || "";
        const text = [
            mentionStr,
            "`【リマインド】オフショットがまだ格納されていません。`",
            "撮影から2日以上経過していますが、Drive内が0件です。オフショットの格納をお願いします。",
            url,
        ].filter(Boolean).join("\n");
        try {
            const res = await fetch("https://slack.com/api/chat.postMessage", {
                method: "POST",
                headers: { Authorization: `Bearer ${slackToken}`, "Content-Type": "application/json" },
                body: JSON.stringify({
                    channel: slackChannel,
                    thread_ts: slackTs,
                    text,
                    link_names: true,
                    unfurl_links: false,
                }),
            });
            const data = await res.json();
            if (!data.ok) {
                console.warn(`[remindOffshot] Slack 返信失敗 pageId=${doc.id}: ${data.error}`);
                continue; // フラグは立てず次回再試行
            }
            await doc.ref.update({
                offshotReminded: true,
                offshotRemindedAt: admin.firestore.FieldValue.serverTimestamp(),
            });
            reminded++;
        }
        catch (e) {
            console.warn(`[remindOffshot] Slack 返信例外 pageId=${doc.id}:`, e);
        }
    }
    console.log(`[remindOffshot] Done checked=${checked} reminded=${reminded} alreadyFilled=${alreadyFilled}`);
});
//# sourceMappingURL=syncOffshotFileCounts.js.map