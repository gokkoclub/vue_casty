"use strict";
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
exports.sendSlackOffshot = void 0;
const https_1 = require("firebase-functions/v2/https");
const admin = __importStar(require("firebase-admin"));
const _helpers_1 = require("./_helpers");
exports.sendSlackOffshot = (0, https_1.onRequest)({
    region: "asia-northeast1",
    secrets: ["SLACK_OFFSHOT_BOT_TOKEN", "SLACK_CHANNEL_OFFSHOT"],
    // Cloud Tasks からのみ呼ばれる。公開なので認証はOIDCで検証するのが望ましいが、
    // 冪等性と処理内容でバリデーションされるので当面スキップ。
    invoker: "public",
}, async (req, res) => {
    try {
        const { pageId } = req.body;
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
        const notif = notifSnap.data();
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
        // shootings から driveUrl / offshotUrl を取得
        const shootingsSnap = await db.doc(`shootings/${pageId}`).get();
        const shData = shootingsSnap.exists ? shootingsSnap.data() : {};
        const offshotUrl = shData.offshotUrl || shData.driveUrl || "";
        const team = notif.team || shData.team || "";
        const shootingDate = notif.shootingDate || shData.shootDate || "";
        const fdNames = Array.isArray(notif.fdNames) ? notif.fdNames : [];
        // FD名 → slackMentionId 解決
        const mentionIds = await (0, _helpers_1.resolveSlackMentionsByNames)(fdNames);
        console.log(`[sendSlackOffshot] Resolved mentions: ${mentionIds.length}/${fdNames.length}`);
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
        const slackData = await slackRes.json();
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
    }
    catch (err) {
        console.error("[sendSlackOffshot] Error:", err);
        // Cloud Tasks にリトライさせるため 500 を返す
        res.status(500).json({ error: String(err?.message || err) });
    }
});
function formatMD(dateStr) {
    if (!dateStr)
        return "";
    const m = String(dateStr).match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (m)
        return `${parseInt(m[2], 10)}/${parseInt(m[3], 10)}`;
    return dateStr;
}
//# sourceMappingURL=sendSlackOffshot.js.map