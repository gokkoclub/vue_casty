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

import { onCall, HttpsError } from "firebase-functions/v2/https";
import { onSchedule } from "firebase-functions/v2/scheduler";
import * as admin from "firebase-admin";
import { google, drive_v3 } from "googleapis";

const SECRET = "GOOGLE_SERVICE_ACCOUNT_KEY";
const FOLDER_MIME = "application/vnd.google-apps.folder";

/**
 * Drive APIクライアントを取得（読み取り専用）
 */
export function getDriveClient(serviceAccountKey: string): drive_v3.Drive {
    const credentials = JSON.parse(serviceAccountKey);
    const auth = new google.auth.GoogleAuth({
        credentials,
        scopes: ["https://www.googleapis.com/auth/drive.readonly"],
    });
    return google.drive({ version: "v3", auth });
}

/**
 * Drive フォルダのURLから folderId を抽出する。
 * 例: https://drive.google.com/drive/folders/<ID>?usp=sharing
 *     https://drive.google.com/drive/u/0/folders/<ID>
 *     https://drive.google.com/open?id=<ID>
 */
export function extractFolderId(driveLink: string): string | null {
    if (!driveLink) return null;
    const folderMatch = driveLink.match(/\/folders\/([a-zA-Z0-9_-]+)/);
    if (folderMatch) return folderMatch[1]!;
    const idParam = driveLink.match(/[?&]id=([a-zA-Z0-9_-]+)/);
    if (idParam) return idParam[1]!;
    return null;
}

/**
 * 指定フォルダ直下のファイル数（サブフォルダを除く）を数える。
 * ページネーションで全件取得。共有ドライブにも対応。
 */
export async function countFilesInFolder(drive: drive_v3.Drive, folderId: string): Promise<number> {
    let count = 0;
    let pageToken: string | undefined;

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
async function findChildFolder(drive: drive_v3.Drive, parentId: string, regex: RegExp): Promise<string | null> {
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
export async function resolveOffshotFolderId(drive: drive_v3.Drive, rootFolderId: string): Promise<string | null> {
    const kouhouId = await findChildFolder(drive, rootFolderId, /広報/);
    if (!kouhouId) return null;
    return await findChildFolder(drive, kouhouId, /撮影オフショット|オフショット/);
}

interface SyncResult {
    drivesProcessed: number;
    drivesFailed: number;
    castingsUpdated: number;
}

/**
 * 本体処理。scheduled / onCall の両方から呼ぶ。
 */
async function performOffshotFileCountSync(serviceAccountKey: string): Promise<SyncResult> {
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
    const infoByProjectId = new Map<string, { fileCount: number; offshotUrl: string }>();
    let drivesProcessed = 0;
    let drivesFailed = 0;

    for (const doc of projectsSnap.docs) {
        const data = doc.data();
        const rootLink: string | undefined = data.driveFolderUrl;
        if (!rootLink) continue;

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
            const offshotUrl: string = data.offshotUrl || `https://drive.google.com/drive/folders/${offshotFolderId}`;

            const projUpdate: Record<string, unknown> = {
                offshotFileCount: fileCount,
                offshotFileCountCheckedAt: admin.firestore.FieldValue.serverTimestamp(),
            };
            // 日次 GAS を待たずに projects.offshotUrl を埋める（空のときのみ）
            if (!data.offshotUrl) projUpdate.offshotUrl = offshotUrl;
            await doc.ref.update(projUpdate);
            drivesProcessed++;

            // projects の doc id はハイフン無し notion page id
            infoByProjectId.set(doc.id.replace(/-/g, "").toLowerCase(), { fileCount, offshotUrl });
        } catch (e) {
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
        if (!contact.projectId) continue;

        const normalizedId = String(contact.projectId).replace(/-/g, "").toLowerCase();
        const info = infoByProjectId.get(normalizedId);
        if (!info) continue;

        // makingFileCount は変化時のみ、makingUrl は未設定時のみ書き込む
        const update: Record<string, unknown> = {};
        if (contact.makingFileCount !== info.fileCount) update.makingFileCount = info.fileCount;
        if (!contact.makingUrl || String(contact.makingUrl).trim() === "") update.makingUrl = info.offshotUrl;
        if (Object.keys(update).length === 0) continue;

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
export const scheduledSyncOffshotFileCounts = onSchedule(
    {
        schedule: "0 22 * * *",
        timeZone: "Asia/Tokyo",
        secrets: [SECRET],
        memory: "512MiB",
        timeoutSeconds: 540,
        maxInstances: 1,
    },
    async () => {
        const key = process.env[SECRET];
        if (!key) {
            console.error("[scheduledSyncOffshotFileCounts] GOOGLE_SERVICE_ACCOUNT_KEY が未設定");
            return;
        }
        try {
            const r = await performOffshotFileCountSync(key);
            console.log(
                `[scheduledSyncOffshotFileCounts] Done processed=${r.drivesProcessed} ` +
                `failed=${r.drivesFailed} castingsUpdated=${r.castingsUpdated}`
            );
        } catch (e) {
            console.error("[scheduledSyncOffshotFileCounts] Error:", e);
        }
    }
);

/**
 * 手動実行用（メイキング共有待ちタブの同期ボタンなどから呼べる）
 */
export const syncOffshotFileCounts = onCall(
    {
        secrets: [SECRET],
        memory: "512MiB",
        timeoutSeconds: 540,
        maxInstances: 3,
    },
    async () => {
        const key = process.env[SECRET];
        if (!key) {
            throw new HttpsError("failed-precondition", "GOOGLE_SERVICE_ACCOUNT_KEY が未設定です");
        }
        try {
            const r = await performOffshotFileCountSync(key);
            return { success: true, ...r };
        } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            console.error("[syncOffshotFileCounts] Error:", e);
            throw new HttpsError("internal", "オフショットファイル数の同期に失敗: " + msg);
        }
    }
);

/**
 * オフショット未格納リマインド（定期実行: 毎日 10:00 JST）
 *
 * sendSlackOffshot で通知済み（offshotNotifications.status='sent'）のうち、
 * 送信から 2 日以上経過したものについて、オフショットフォルダの件数を確認し:
 *   - 0 件         → 元の Slack スレッドに再メンションでリマインドを投稿
 *   - 1 件以上格納 → 元のスレッドに「格納ありがとうございます」のお礼を投稿
 * どちらも 1 回のみ。
 *
 * 冪等性: offshotReminded=true で二重投稿を防止（お礼を送った場合も true にする）。
 */
const REMIND_AFTER_MS = 2 * 24 * 60 * 60 * 1000; // 2日: これ以上経過で対象
const REMIND_MAX_AGE_MS = 10 * 24 * 60 * 60 * 1000; // 10日: これ以上古いものは対象外（初回一斉送信・古い案件へのスパム防止）

export const scheduledRemindOffshotUnfilled = onSchedule(
    {
        schedule: "0 10 * * *",
        timeZone: "Asia/Tokyo",
        secrets: [SECRET, "SLACK_OFFSHOT_BOT_TOKEN", "SLACK_CHANNEL_OFFSHOT"],
        memory: "512MiB",
        timeoutSeconds: 300,
        maxInstances: 1,
    },
    async () => {
        const key = process.env[SECRET];
        const slackToken = process.env.SLACK_OFFSHOT_BOT_TOKEN;
        const slackChannel = process.env.SLACK_CHANNEL_OFFSHOT;
        if (!key || !slackToken || !slackChannel) {
            console.error("[remindOffshot] 必要な secret が未設定 (SA/SLACK_OFFSHOT_BOT_TOKEN/SLACK_CHANNEL_OFFSHOT)");
            return;
        }

        const db = admin.firestore();
        const drive = getDriveClient(key);
        const nowMs = Date.now();

        const snap = await db.collection("offshotNotifications").where("status", "==", "sent").get();
        let checked = 0;
        let reminded = 0;
        let alreadyFilled = 0;

        for (const doc of snap.docs) {
            const n = doc.data();
            if (n.offshotReminded === true) continue;

            const sentAt = n.sentAt as admin.firestore.Timestamp | undefined;
            if (!sentAt?.toMillis) continue;
            const ageMs = nowMs - sentAt.toMillis();
            if (ageMs < REMIND_AFTER_MS) continue;   // 2日未満はスキップ
            if (ageMs > REMIND_MAX_AGE_MS) continue;  // 10日超の古い案件はスキップ（スパム防止）

            const slackTs: string = n.slackTs || "";
            if (!slackTs) continue; // スレッド親が無いと返信できない

            // オフショットフォルダを解決。
            // ⚠️ offshotUrlAtSend は信用しない: 通知送信時に shootings.driveUrl（作品ルート）へ
            //    フォールバックしていた時期があり、ルート直下の自動生成スプレッドシート（香盤等）を
            //    数えて「格納ありがとう」を誤送信する原因になった。
            //    必ず projects.offshotUrl（＝オフショットサブフォルダ）→ ルートからの走査で解決する。
            let folderId: string | null = null;
            let resolvedOffshotUrl = "";
            let rootFolderId: string | null = null;
            try {
                const projDoc = await db.collection("projects").doc(doc.id.replace(/-/g, "").toLowerCase()).get();
                const pd = projDoc.exists ? projDoc.data()! : {};
                rootFolderId = pd.driveFolderUrl ? extractFolderId(pd.driveFolderUrl as string) : null;
                folderId = pd.offshotUrl ? extractFolderId(pd.offshotUrl as string) : null;
                if (folderId && rootFolderId && folderId === rootFolderId) folderId = null; // ルートを指していたら不採用
                if (!folderId && rootFolderId) {
                    folderId = await resolveOffshotFolderId(drive, rootFolderId);
                }
                if (folderId) resolvedOffshotUrl = `https://drive.google.com/drive/folders/${folderId}`;
            } catch (e) {
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
            if (!folderId) continue;

            checked++;
            let fileCount = 0;
            try {
                fileCount = await countFilesInFolder(drive, folderId);
            } catch (e) {
                console.warn(`[remindOffshot] カウント失敗 pageId=${doc.id}:`, e);
                continue; // 次回に再試行（フラグは立てない）
            }

            if (fileCount > 0) {
                // 既に格納済み → スレッドにお礼を投稿して以降のチェックを止める
                const mentionIds: string[] = Array.isArray(n.resolvedMentionIds) ? n.resolvedMentionIds : [];
                const mentionStr = mentionIds.map((id) => `<@${id}>`).join(" ");
                const thanksText = [
                    mentionStr,
                    "`オフショットの格納を確認しました。ありがとうございます！`",
                    `（現在 ${fileCount}件 格納されています）`,
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
                    const data = await res.json() as { ok: boolean; error?: string };
                    if (!data.ok) {
                        console.warn(`[remindOffshot] お礼投稿失敗 pageId=${doc.id}: ${data.error}`);
                        continue; // フラグは立てず次回再試行
                    }
                } catch (e) {
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
            const mentionIds: string[] = Array.isArray(n.resolvedMentionIds) ? n.resolvedMentionIds : [];
            const mentionStr = mentionIds.map((id) => `<@${id}>`).join(" ");
            const url: string = resolvedOffshotUrl || n.offshotUrlAtSend || "";
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
                const data = await res.json() as { ok: boolean; error?: string };
                if (!data.ok) {
                    console.warn(`[remindOffshot] Slack 返信失敗 pageId=${doc.id}: ${data.error}`);
                    continue; // フラグは立てず次回再試行
                }
                await doc.ref.update({
                    offshotReminded: true,
                    offshotRemindedAt: admin.firestore.FieldValue.serverTimestamp(),
                });
                reminded++;
            } catch (e) {
                console.warn(`[remindOffshot] Slack 返信例外 pageId=${doc.id}:`, e);
            }
        }

        console.log(`[remindOffshot] Done checked=${checked} reminded=${reminded} alreadyFilled=${alreadyFilled}`);
    }
);
