/**
 * =========================================================================
 * automation/sendSlackOffshot.ts
 *
 * Cloud Tasks から呼ばれる HTTP エンドポイント
 * 発火タイミング: OUT時間 + 10分
 *
 * 処理:
 * - offshotNotifications/{pageId} を読む
 * - 冪等性チェック (status='scheduled' のみ)
 * - shootings.offshotUrl or driveFolderUrl を取得
 * - fdNames → slackMentionId 解決 (staffMentions)
 * - Slack に @mention 付きメッセージ投稿
 * - status='sent' に更新
 * =========================================================================
 */

import { onRequest } from "firebase-functions/v2/https";
import * as admin from "firebase-admin";
import { resolveSlackMentionsByNames } from "./_helpers";
import { getDriveClient, extractFolderId, resolveOffshotFolderId } from "../syncOffshotFileCounts";

export const sendSlackOffshot = onRequest(
    {
        region: "asia-northeast1",
        secrets: ["SLACK_OFFSHOT_BOT_TOKEN", "SLACK_CHANNEL_OFFSHOT", "GOOGLE_SERVICE_ACCOUNT_KEY"],
        // Cloud Tasks からのみ呼ばれる。公開なので認証はOIDCで検証するのが望ましいが、
        // 冪等性と処理内容でバリデーションされるので当面スキップ。
        invoker: "public",
    },
    async (req, res) => {
        try {
            const { pageId } = req.body as { pageId?: string };
            if (!pageId) {
                res.status(400).json({ error: "pageId required" });
                return;
            }

            const db = admin.firestore();

            // offshotNotifications 取得
            const notifRef = db.doc(`offshotNotifications/${pageId}`);
            const notifSnap = await notifRef.get();
            if (!notifSnap.exists) {
                console.warn(`[sendSlackOffshot] Notification not found: ${pageId}`);
                res.status(404).json({ error: "notification not found", pageId });
                return;
            }

            const notif = notifSnap.data()!;

            // 冪等性: 既に送信済み or キャンセル済みなら skip
            if (notif.status === "sent") {
                console.log(`[sendSlackOffshot] Already sent: ${pageId}`);
                res.json({ ok: true, skipped: "already sent" });
                return;
            }
            if (notif.status === "canceled") {
                console.log(`[sendSlackOffshot] Canceled: ${pageId}`);
                res.json({ ok: true, skipped: "canceled" });
                return;
            }

            // ── オフショットフォルダ URL の解決 ──
            // ⚠️ 旧実装は shootings.driveUrl（作品ルートフォルダ）にフォールバックしていたため、
            //    親フォルダのリンクが通知され、リマインドがルート直下の自動生成スプレッドシートを
            //    数えて誤動作する原因になった。ルート URL は絶対に採用しない。
            // 優先順: shootings.offshotUrl → projects.offshotUrl → Drive走査(ルート→02_広報→01_撮影オフショット)
            const shootingsSnap = await db.doc(`shootings/${pageId}`).get();
            const shData = shootingsSnap.exists ? shootingsSnap.data()! : {};
            const projDocId = String(pageId).replace(/-/g, "").toLowerCase();
            const projSnap = await db.doc(`projects/${projDocId}`).get();
            const projData = projSnap.exists ? projSnap.data()! : {};

            const rootUrl: string = projData.driveFolderUrl || shData.driveUrl || "";
            const rootId = rootUrl ? extractFolderId(rootUrl) : null;
            const notRoot = (url: string): boolean => {
                const id = url ? extractFolderId(url) : null;
                return !!id && id !== rootId;
            };

            let offshotUrl = "";
            if (shData.offshotUrl && notRoot(shData.offshotUrl)) {
                offshotUrl = shData.offshotUrl;
            } else if (projData.offshotUrl && notRoot(projData.offshotUrl)) {
                offshotUrl = projData.offshotUrl;
            } else if (rootId && process.env.GOOGLE_SERVICE_ACCOUNT_KEY) {
                // Drive を実走査してオフショットサブフォルダを解決（日次ジョブを待たない）
                try {
                    const drive = getDriveClient(process.env.GOOGLE_SERVICE_ACCOUNT_KEY);
                    const offshotFolderId = await resolveOffshotFolderId(drive, rootId);
                    if (offshotFolderId) {
                        offshotUrl = `https://drive.google.com/drive/folders/${offshotFolderId}`;
                        // 次回以降のために書き戻し（projects / shootings 両方）
                        await Promise.all([
                            projSnap.exists ? projSnap.ref.update({ offshotUrl }).catch(() => {}) : Promise.resolve(),
                            shootingsSnap.exists ? shootingsSnap.ref.update({ offshotUrl }).catch(() => {}) : Promise.resolve(),
                        ]);
                        console.log(`[sendSlackOffshot] offshot folder resolved via Drive: ${offshotUrl}`);
                    }
                } catch (e) {
                    console.warn(`[sendSlackOffshot] Drive 走査失敗 pageId=${pageId}:`, e);
                }
            }
            const team: string = notif.team || shData.team || "";
            const shootingDate: string = notif.shootingDate || shData.shootDate || "";
            // メンション対象 = FD/SD + 制作。新形式 mentionNames を優先、無ければ旧 fdNames にフォールバック。
            const mentionNames: string[] = Array.isArray(notif.mentionNames)
                ? notif.mentionNames
                : (Array.isArray(notif.fdNames) ? notif.fdNames : []);

            // 名前 → slackMentionId 解決（FD/SD・制作とも同じ経路）
            const mentionIds = await resolveSlackMentionsByNames(mentionNames);
            console.log(`[sendSlackOffshot] Resolved mentions: ${mentionIds.length}/${mentionNames.length}`);

            // メッセージ組み立て
            const mentionStr = mentionIds.map(id => `<@${id}>`).join(" ");
            const dateStr = formatMD(shootingDate);

            const text = [
                mentionStr,
                "`オフショット格納の連絡です。`",
                `以下Driveに、${dateStr}_${team}撮影のオフショットを格納してください。`,
                offshotUrl || "(オフショットURLがまだ設定されていません)",
            ].filter(Boolean).join("\n");

            // Slack 送信
            const slackToken = process.env.SLACK_OFFSHOT_BOT_TOKEN;
            const slackChannel = process.env.SLACK_CHANNEL_OFFSHOT;
            if (!slackToken || !slackChannel) {
                throw new Error("SLACK_OFFSHOT_BOT_TOKEN or SLACK_CHANNEL_OFFSHOT not set");
            }

            const slackRes = await fetch("https://slack.com/api/chat.postMessage", {
                method: "POST",
                headers: {
                    Authorization: `Bearer ${slackToken}`,
                    "Content-Type": "application/json",
                },
                body: JSON.stringify({
                    channel: slackChannel,
                    text,
                    link_names: true,
                    unfurl_links: false,
                }),
            });
            const slackData = await slackRes.json() as { ok: boolean; ts?: string; error?: string };

            if (!slackData.ok) {
                throw new Error(`Slack API error: ${slackData.error}`);
            }

            // 成功マーク
            await notifRef.update({
                status: "sent",
                sentAt: admin.firestore.FieldValue.serverTimestamp(),
                slackTs: slackData.ts || "",
                resolvedMentionIds: mentionIds,
                offshotUrlAtSend: offshotUrl,
                updatedAt: admin.firestore.FieldValue.serverTimestamp(),
            });

            console.log(`[sendSlackOffshot] ✅ Sent: ${pageId}, ts=${slackData.ts}`);
            res.json({ ok: true, ts: slackData.ts, mentions: mentionIds.length });
        } catch (err: any) {
            console.error("[sendSlackOffshot] Error:", err);
            // Cloud Tasks にリトライさせるため 500 を返す
            res.status(500).json({ error: String(err?.message || err) });
        }
    }
);

function formatMD(dateStr: string): string {
    if (!dateStr) return "";
    const m = String(dateStr).match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (m) return `${parseInt(m[2]!, 10)}/${parseInt(m[3]!, 10)}`;
    return dateStr;
}
