/**
 * Slack Interactive Messages Webhook Handler
 *
 * Slackのボタン押下イベントを受信して処理する。
 * - cast_ok: 出演OKボタン → Firestoreステータス更新 + スレッド返信 + DM更新
 * - cast_view_thread: スレッドを見るボタン → URL遷移のみ（Slack側で処理）
 */

import { onRequest } from "firebase-functions/v2/https";
import * as admin from "firebase-admin";
import * as crypto from "crypto";
import { postToSlack, updateSlackMessage } from "./slack";

// ──────────────────────────────────────
// Slack署名検証
// ──────────────────────────────────────
function verifySlackSignature(
    signingSecret: string,
    timestamp: string,
    body: string,
    signature: string
): boolean {
    // リプレイ攻撃防止（5分以内）
    const now = Math.floor(Date.now() / 1000);
    if (Math.abs(now - parseInt(timestamp, 10)) > 300) {
        console.warn("[SlackInteraction] Timestamp too old");
        return false;
    }

    const sigBasestring = `v0:${timestamp}:${body}`;
    const mySignature = "v0=" + crypto
        .createHmac("sha256", signingSecret)
        .update(sigBasestring, "utf8")
        .digest("hex");

    return crypto.timingSafeEqual(
        Buffer.from(mySignature, "utf8"),
        Buffer.from(signature, "utf8")
    );
}

// ──────────────────────────────────────
// Webhook Handler
// ──────────────────────────────────────
export const handleSlackInteraction = onRequest(
    {
        region: "asia-northeast1",
        maxInstances: 10,
        secrets: [
            "SLACK_BOT_TOKEN",
            "SLACK_SIGNING_SECRET",
            "SLACK_CHANNEL_INTERNAL",
        ],
    },
    async (req, res) => {
        console.log("[SlackInteraction] Request received");

        // POST のみ受付
        if (req.method !== "POST") {
            res.status(405).send("Method Not Allowed");
            return;
        }

        // ── Slack署名検証 ──
        const signingSecret = (process.env.SLACK_SIGNING_SECRET || "").trim();
        const timestamp = req.headers["x-slack-request-timestamp"] as string || "";
        const signature = req.headers["x-slack-signature"] as string || "";

        // rawBody を取得（2nd gen では req.rawBody が undefined の場合がある）
        let rawBody = "";
        if (req.rawBody) {
            rawBody = req.rawBody.toString("utf8");
        } else if (typeof req.body === "string") {
            rawBody = req.body;
        } else if (req.body && typeof req.body === "object") {
            // Express が application/x-www-form-urlencoded をパース済みの場合
            rawBody = new URLSearchParams(req.body as Record<string, string>).toString();
        }

        console.log("[SlackInteraction] Debug:", {
            hasSigningSecret: !!signingSecret,
            hasTimestamp: !!timestamp,
            hasSignature: !!signature,
            hasRawBody: !!rawBody,
            rawBodyLength: rawBody.length,
            hasReqRawBody: !!req.rawBody,
        });

        if (signingSecret && signature && !verifySlackSignature(signingSecret, timestamp, rawBody, signature)) {
            console.error("[SlackInteraction] Signature verification failed");
            res.status(401).send("Unauthorized");
            return;
        }

        // ── ペイロード解析 ──
        let payload: {
            type: string;
            actions?: Array<{
                action_id: string;
                value?: string;
            }>;
            user?: { id: string; name: string };
            message?: { ts: string };
            channel?: { id: string };
            response_url?: string;
        };

        try {
            const body = req.body;
            const payloadStr = typeof body === "string"
                ? new URLSearchParams(body).get("payload") || body
                : body.payload || JSON.stringify(body);
            payload = JSON.parse(payloadStr);
        } catch (e) {
            console.error("[SlackInteraction] Failed to parse payload:", e);
            res.status(400).send("Bad Request");
            return;
        }

        // URL verification（Slack App設定時）
        if (payload.type === "url_verification") {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            res.json({ challenge: (payload as any).challenge });
            return;
        }

        // block_actions のみ処理
        if (payload.type !== "block_actions" || !payload.actions?.length) {
            console.log("[SlackInteraction] Ignoring non-action payload:", payload.type);
            res.status(200).send("ok");
            return;
        }

        const action = payload.actions[0]!;
        console.log("[SlackInteraction] action_id:", action.action_id);

        // ── cast_ok: 出演OKボタン ──
        if (action.action_id === "cast_ok") {
            // すぐに200を返す（Slack 3秒タイムアウト対策）
            res.status(200).send("");

            try {
                const valueData = JSON.parse(action.value || "{}") as {
                    castingId: string;
                    castName: string;
                    projectName: string;
                    slackThreadTs: string;
                    slackChannel: string;
                };

                const slackToken = process.env.SLACK_BOT_TOKEN || "";
                const db = admin.firestore();

                // 1. Firestore ステータス更新
                const castingRef = db.collection("castings").doc(valueData.castingId);
                const castingSnap = await castingRef.get();

                if (!castingSnap.exists) {
                    console.error("[SlackInteraction] Casting not found:", valueData.castingId);
                    return;
                }

                const castingData = castingSnap.data()!;
                const oldStatus = castingData.status || "仮キャスティング";

                // 決定ステータス以降は変更しない（決定→OKへの逆戻り防止）
                const terminalStatuses = ["決定", "NG", "キャンセル", "削除済み"];
                if (terminalStatuses.includes(oldStatus)) {
                    console.log(`[SlackInteraction] Status change skipped: ${valueData.castingId} is already "${oldStatus}"`);

                    // DM のボタンを更新して現状のステータスを表示
                    const dmChannel = payload.channel?.id;
                    const messageTs = payload.message?.ts;
                    if (dmChannel && messageTs) {
                        const statusText = oldStatus === "決定"
                            ? "✅ すでに *決定済み* です"
                            : `ℹ️ 現在のステータスは *${oldStatus}* です`;
                        const updatedBlocks = [
                            {
                                type: "header",
                                text: {
                                    type: "plain_text",
                                    text: "📋 撮影オーダーのお知らせ",
                                    emoji: true,
                                },
                            },
                            {
                                type: "section",
                                text: {
                                    type: "mrkdwn",
                                    text: `*${valueData.projectName}*`,
                                },
                            },
                            {
                                type: "section",
                                text: {
                                    type: "mrkdwn",
                                    text: statusText,
                                },
                            },
                        ];
                        await updateSlackMessage(
                            slackToken,
                            dmChannel,
                            messageTs,
                            statusText.replace(/\*/g, ""),
                            updatedBlocks
                        );
                    }
                    return;
                }

                await castingRef.update({
                    status: "OK",
                    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
                    updatedBy: "Slack応答",
                });
                console.log(`[SlackInteraction] Status updated: ${valueData.castingId} → OK`);

                // 2. オーダースレッドにBOT返信
                const threadChannel = valueData.slackChannel || process.env.SLACK_CHANNEL_INTERNAL || "";
                if (threadChannel && valueData.slackThreadTs) {
                    const replyText = `✅ *${valueData.castName}* が出演OKしました（${valueData.projectName}）\n\`${oldStatus}\` → \`OK\``;
                    await postToSlack(
                        slackToken,
                        threadChannel,
                        replyText,
                        undefined,
                        valueData.slackThreadTs
                    );
                    console.log("[SlackInteraction] Thread reply posted");
                }

                // 3. DM のボタンを更新（ボタンを消して結果テキストに差し替え）
                const dmChannel = payload.channel?.id;
                const messageTs = payload.message?.ts;
                if (dmChannel && messageTs) {
                    const updatedBlocks = [
                        {
                            type: "header",
                            text: {
                                type: "plain_text",
                                text: "📋 撮影オーダーのお知らせ",
                                emoji: true,
                            },
                        },
                        {
                            type: "section",
                            text: {
                                type: "mrkdwn",
                                text: `*${valueData.projectName}*`,
                            },
                        },
                        {
                            type: "section",
                            text: {
                                type: "mrkdwn",
                                text: "✅ *出演OKを送信しました* ありがとうございます！",
                            },
                        },
                    ];
                    await updateSlackMessage(
                        slackToken,
                        dmChannel,
                        messageTs,
                        "出演OKを送信しました",
                        updatedBlocks
                    );
                    console.log("[SlackInteraction] DM updated");
                }

            } catch (error) {
                console.error("[SlackInteraction] cast_ok error:", error);
            }
            return;
        }

        // ── cast_view_thread: URLボタン → Slackが自動処理するので何もしない ──
        if (action.action_id === "cast_view_thread") {
            res.status(200).send("");
            return;
        }

        // 未知のアクション
        console.log("[SlackInteraction] Unknown action:", action.action_id);
        res.status(200).send("ok");
    }
);
