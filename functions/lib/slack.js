"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.postToSlack = postToSlack;
exports.uploadFileToSlack = uploadFileToSlack;
exports.buildSpecialOrderMessage = buildSpecialOrderMessage;
exports.buildOrderMessage = buildOrderMessage;
exports.buildAdditionalOrderMessage = buildAdditionalOrderMessage;
exports.buildOrderUpdateMessage = buildOrderUpdateMessage;
exports.buildStatusMessage = buildStatusMessage;
exports.sendDmToUser = sendDmToUser;
exports.updateSlackMessage = updateSlackMessage;
exports.buildCastOrderDmBlocks = buildCastOrderDmBlocks;
/**
 * Slack API ヘルパー
 * Cloud Functions から Slack Bot API を呼び出す
 * ファイルアップロードは @slack/web-api SDK を使用（V1のPython slack_sdkと同等）
 */
const web_api_1 = require("@slack/web-api");
/**
 * Slack にメッセージを投稿
 */
async function postToSlack(token, channel, text, blocks, threadTs) {
    const payload = {
        channel,
        text,
        mrkdwn: true,
    };
    if (blocks)
        payload.blocks = blocks;
    if (threadTs)
        payload.thread_ts = threadTs;
    try {
        const response = await fetch("https://slack.com/api/chat.postMessage", {
            method: "POST",
            headers: {
                "Authorization": `Bearer ${token}`,
                "Content-Type": "application/json",
            },
            body: JSON.stringify(payload),
        });
        const result = await response.json();
        if (!result.ok) {
            const errorMsg = result.error || "unknown Slack error";
            console.error("Slack API error:", errorMsg);
            throw new Error(`Slack API error: ${errorMsg}`);
        }
        // パーマリンクを取得
        let permalink = "";
        try {
            const plResponse = await fetch("https://slack.com/api/chat.getPermalink", {
                method: "POST",
                headers: {
                    "Authorization": `Bearer ${token}`,
                    "Content-Type": "application/json",
                },
                body: JSON.stringify({
                    channel,
                    message_ts: result.ts,
                }),
            });
            const plResult = await plResponse.json();
            permalink = plResult.permalink || "";
        }
        catch (e) {
            console.warn("Failed to get permalink:", e);
        }
        return { ok: true, ts: result.ts, permalink };
    }
    catch (error) {
        console.error("Slack post error:", error);
        throw new Error(`Slack post failed: ${error}`);
    }
}
/**
 * Slack にファイル付きメッセージを投稿
 * @slack/web-api の filesUploadV2 を使用（V1 の Python slack_sdk.files_upload_v2 と同等）
 * SDK がリダイレクト処理・リトライを内部的に処理するため安定動作する
 */
async function uploadFileToSlack(token, channel, text, fileBase64, fileName, threadTs) {
    try {
        const fileBuffer = Buffer.from(fileBase64, "base64");
        console.log("[SLACK SDK] Uploading file:", fileName, "size:", fileBuffer.length);
        const client = new web_api_1.WebClient(token);
        // V1と同じ方式: filesUploadV2 でファイル + メッセージを同時投稿
        // SDK が内部で getUploadURLExternal → PUT → completeUploadExternal を処理
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const uploadOptions = {
            channel_id: channel,
            initial_comment: text,
            file: fileBuffer,
            filename: fileName,
            title: fileName,
        };
        if (threadTs) {
            uploadOptions.thread_ts = threadTs;
        }
        const uploadResult = await client.filesUploadV2(uploadOptions);
        console.log("[SLACK SDK] Upload result ok:", uploadResult.ok);
        // ts を取得（filesUploadV2 のレスポンスから）
        let ts = "";
        let permalink = "";
        // files[0].shares からts取得を試みる
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const resultAny = uploadResult;
        const files = resultAny.files;
        if (files?.[0]?.shares) {
            for (const shareType of Object.values(files[0].shares)) {
                for (const channelShares of Object.values(shareType)) {
                    if (channelShares?.[0]?.ts) {
                        ts = channelShares[0].ts;
                        break;
                    }
                }
                if (ts)
                    break;
            }
        }
        // ts が取れない場合は files.info で再取得
        if (!ts && files?.[0]?.id) {
            console.log("[SLACK SDK] No ts from shares, trying files.info...");
            try {
                const infoResult = await client.files.info({ file: files[0].id });
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                const infoShares = infoResult.file?.shares;
                if (infoShares) {
                    for (const shareType of Object.values(infoShares)) {
                        for (const channelShares of Object.values(shareType)) {
                            if (channelShares?.[0]?.ts) {
                                ts = channelShares[0].ts;
                                break;
                            }
                        }
                        if (ts)
                            break;
                    }
                }
            }
            catch (infoErr) {
                console.warn("[SLACK SDK] files.info failed:", infoErr);
            }
        }
        // permalink 取得
        if (ts) {
            try {
                const plResult = await client.chat.getPermalink({
                    channel,
                    message_ts: ts,
                });
                permalink = plResult.permalink || "";
            }
            catch (plErr) {
                console.warn("[SLACK SDK] getPermalink failed:", plErr);
            }
        }
        console.log("[SLACK SDK] File uploaded, ts:", ts, "permalink:", permalink);
        return { ok: true, ts, permalink };
    }
    catch (error) {
        console.error("[SLACK SDK] File upload error:", error);
        // Fallback to text-only
        return await postToSlack(token, channel, text, undefined, threadTs);
    }
}
/**
 * 特別オーダー（外部案件/社内イベント）のSlackメッセージを構築
 * ORDER_INTEGRATION_GUIDE セクション4・5準拠
 */
function buildSpecialOrderMessage(params) {
    const lines = [];
    // ヘッダー
    if (params.mode === "external") {
        lines.push("【外部案件】");
    }
    else {
        lines.push("【社内イベント】");
    }
    // タイトル
    lines.push("`タイトル`");
    lines.push(params.title || "未入力");
    // 日時
    lines.push("`日時`");
    lines.push(params.dateRanges.join(", ") || "未入力");
    // 時間
    if (params.startTime || params.endTime) {
        lines.push("`時間`");
        const timeStr = [params.startTime, params.endTime].filter(Boolean).join(" ~ ");
        lines.push(timeStr);
    }
    // 空行
    lines.push("");
    // キャスト
    lines.push("`キャスト`");
    params.items.forEach((item) => {
        const mention = item.slackMentionId ? `<@${item.slackMentionId}>` : item.castName;
        const typeLabel = params.mode === "internal" && item.castType === "内部" ? " （内部）" : "";
        lines.push(`・${mention}${typeLabel}`);
        if (item.conflictInfo) {
            lines.push(`  🚨 ${item.conflictInfo}`);
        }
    });
    // CC
    if (params.ccMention) {
        lines.push("");
        lines.push(`CC: ${params.ccMention}`);
    }
    return lines.join("\n");
}
/**
 * オーダー通知メッセージを構築
 */
function buildOrderMessage(params) {
    const isShooting = params.mode === "shooting" || !params.mode;
    const dateLabel = isShooting ? "撮影日" : "日程";
    const lines = [];
    // グループメンション
    if (params.mentionGroupId) {
        lines.push(`<!subteam^${params.mentionGroupId}>`);
    }
    // CC欄
    if (params.ccString) {
        lines.push(`cc: ${params.ccString}`);
    }
    // 空行
    if (params.mentionGroupId || params.ccString) {
        lines.push("");
    }
    // ヘッダー
    if (isShooting) {
        lines.push("キャスティングオーダーがありました。");
    }
    else if (params.mode === "external") {
        lines.push("外部案件のオーダーがありました。");
    }
    else {
        lines.push("社内イベントのオーダーがありました。");
    }
    if (params.hasInternal) {
        lines.push("*内部キャストはスタンプで反応ください*");
    }
    // 撮影日/日程
    lines.push("");
    lines.push(`\`${dateLabel}\``);
    params.dateRanges.forEach((d) => lines.push(`・${d}`));
    // アカウント
    lines.push("");
    lines.push("`アカウント`");
    lines.push(params.accountName || "未入力");
    // 作品名
    lines.push("");
    lines.push("`作品名`");
    const projects = [...new Set(params.items.map((i) => i.projectName))];
    lines.push(projects.join("/") || "未定");
    // 役名
    lines.push("");
    lines.push("`役名`");
    // Group by project and role
    const grouped = {};
    params.items.forEach((item) => {
        if (!grouped[item.projectName])
            grouped[item.projectName] = {};
        const pg = grouped[item.projectName];
        if (!pg[item.roleName])
            pg[item.roleName] = [];
        pg[item.roleName].push(item);
    });
    for (const [projectName, roles] of Object.entries(grouped)) {
        lines.push(`【${projectName}】`);
        for (const [roleName, casts] of Object.entries(roles)) {
            lines.push(`  ${roleName}`);
            casts.sort((a, b) => a.rank - b.rank);
            casts.forEach((c) => {
                const mention = c.slackMentionId ? `<@${c.slackMentionId}>` : c.castName;
                lines.push(`    第${c.rank}候補：${mention}`);
                if (c.conflictInfo) {
                    lines.push(`    🚨 ${c.conflictInfo}`);
                }
            });
        }
    }
    // 📅 日付ごとのスケジュール（中長編: selectedDatesを持つアイテムがある場合のみ）
    const hasPerCastDates = params.items.some(i => i.selectedDates && i.selectedDates.length > 0);
    if (hasPerCastDates) {
        lines.push("");
        lines.push("`スケジュール`");
        // 全日付を収集してソート
        const allDates = new Set();
        params.items.forEach(item => {
            const dates = item.selectedDates && item.selectedDates.length > 0
                ? item.selectedDates
                : params.dateRanges;
            dates.forEach(d => allDates.add(d));
        });
        const sortedDates = [...allDates].sort();
        for (const dateStr of sortedDates) {
            // 「2026/03/14」→「3/14」
            const parts = dateStr.split("/");
            const shortDate = parts.length === 3
                ? `${parseInt(parts[1])}/${parseInt(parts[2])}`
                : dateStr;
            lines.push(`📅 ${shortDate}`);
            // この日に参加するキャストを役→候補順でグループ化
            const castsForDate = params.items.filter(item => {
                const dates = item.selectedDates && item.selectedDates.length > 0
                    ? item.selectedDates
                    : params.dateRanges;
                return dates.includes(dateStr);
            });
            // 役ごとにグループ
            const roleGroups = {};
            castsForDate.forEach(c => {
                if (!roleGroups[c.roleName])
                    roleGroups[c.roleName] = [];
                roleGroups[c.roleName].push(c);
            });
            for (const [roleName, casts] of Object.entries(roleGroups)) {
                casts.sort((a, b) => a.rank - b.rank);
                casts.forEach(c => {
                    const mention = c.slackMentionId ? `<@${c.slackMentionId}>` : c.castName;
                    lines.push(`  ${roleName} → 第${c.rank}候補: ${mention}`);
                });
            }
        }
    }
    // Notionリンク
    if (params.projectId) {
        lines.push("");
        lines.push("`Notionリンク`");
        lines.push(`https://www.notion.so/${params.projectId.replace(/-/g, "")}`);
    }
    // フッター
    lines.push("");
    lines.push("--------------------------------------------------");
    return lines.join("\n");
}
/**
 * 追加オーダー通知メッセージを構築
 * SLACK_NOTIFICATION_SPEC §3 準拠
 * 既存スレッドへの返信用 — 簡略化フォーマット
 */
function buildAdditionalOrderMessage(params) {
    const lines = [];
    if (params.mentionGroupId) {
        lines.push(`<!subteam^${params.mentionGroupId}>`);
        lines.push("");
    }
    lines.push("追加オーダーのお知らせ");
    if (params.hasInternal) {
        lines.push("*内部キャストはスタンプで反応ください*");
    }
    lines.push("");
    // プロジェクト・役名ごとにグループ化
    const grouped = {};
    params.items.forEach((item) => {
        if (!grouped[item.projectName])
            grouped[item.projectName] = {};
        const pg = grouped[item.projectName];
        if (!pg[item.roleName])
            pg[item.roleName] = [];
        pg[item.roleName].push(item);
    });
    for (const [projectName, roles] of Object.entries(grouped)) {
        lines.push(`【${projectName}】`);
        for (const [roleName, casts] of Object.entries(roles)) {
            // 候補を / で区切って横並び表示
            const castList = casts
                .sort((a, b) => a.rank - b.rank)
                .map((c) => c.slackMentionId ? `<@${c.slackMentionId}>` : c.castName)
                .join(" / ");
            lines.push(`${roleName}：${castList}`);
        }
        lines.push("");
    }
    return lines.join("\n").trim();
}
/**
 * オーダー内容変更通知メッセージを構築
 */
function buildOrderUpdateMessage(params) {
    let text = `📅 *オーダー内容が変更されました*\nキャスト: ${params.castName}（${params.projectName}）\n`;
    text += "\n`変更内容`\n";
    if (params.changes.projectName) {
        text += `・作品名: ${params.changes.projectName.from} → ${params.changes.projectName.to}\n`;
    }
    if (params.changes.startDate) {
        text += `・日程: ${params.changes.startDate.from} → ${params.changes.startDate.to}\n`;
    }
    if (params.changes.endDate) {
        text += `・終了日: ${params.changes.endDate.from} → ${params.changes.endDate.to}\n`;
    }
    if (params.changes.startTime) {
        text += `・開始時間: ${params.changes.startTime.from} → ${params.changes.startTime.to}\n`;
    }
    if (params.changes.endTime) {
        text += `・終了時間: ${params.changes.endTime.from} → ${params.changes.endTime.to}\n`;
    }
    return text.trim();
}
/**
 * ステータス更新メッセージを構築
 */
function buildStatusMessage(params) {
    let emoji = "📝";
    if (params.newStatus === "OK")
        emoji = "✅";
    if (params.newStatus === "決定")
        emoji = "🎉";
    if (params.newStatus === "NG")
        emoji = "❌";
    if (params.newStatus === "キャンセル")
        emoji = "🚫";
    if (params.newStatus === "条件つきOK")
        emoji = "🟡";
    let text = `${emoji} *${params.castName}* のステータスが変更されました\n`;
    text += `\`${params.oldStatus}\` → \`${params.newStatus}\``;
    if (params.cost) {
        text += `\nギャラ: ¥${params.cost.toLocaleString()}`;
    }
    if (params.extraMessage) {
        text += `\n備考: ${params.extraMessage}`;
    }
    return text;
}
/**
 * Slack DM を送信（Bot → ユーザー）
 * conversations.open でDMチャンネルを取得してから chat.postMessage
 */
async function sendDmToUser(token, userId, text, blocks) {
    try {
        // 1. DM チャンネルを開く
        const openRes = await fetch("https://slack.com/api/conversations.open", {
            method: "POST",
            headers: {
                "Authorization": `Bearer ${token}`,
                "Content-Type": "application/json",
            },
            body: JSON.stringify({ users: userId }),
        });
        const openResult = await openRes.json();
        if (!openResult.ok || !openResult.channel?.id) {
            console.error("conversations.open failed:", openResult.error);
            return { ok: false };
        }
        const dmChannelId = openResult.channel.id;
        // 2. DM にメッセージ送信
        const payload = {
            channel: dmChannelId,
            text,
            mrkdwn: true,
        };
        if (blocks)
            payload.blocks = blocks;
        const postRes = await fetch("https://slack.com/api/chat.postMessage", {
            method: "POST",
            headers: {
                "Authorization": `Bearer ${token}`,
                "Content-Type": "application/json",
            },
            body: JSON.stringify(payload),
        });
        const postResult = await postRes.json();
        if (!postResult.ok) {
            console.error("DM send failed:", postResult.error);
            return { ok: false };
        }
        console.log(`[DM] Sent to ${userId}, ts: ${postResult.ts}`);
        return { ok: true, ts: postResult.ts };
    }
    catch (error) {
        console.error("sendDmToUser error:", error);
        return { ok: false };
    }
}
/**
 * 既存のSlackメッセージを更新（ボタン → 結果テキストに差し替え等）
 */
async function updateSlackMessage(token, channel, ts, text, blocks) {
    try {
        const payload = {
            channel,
            ts,
            text,
        };
        if (blocks)
            payload.blocks = blocks;
        const res = await fetch("https://slack.com/api/chat.update", {
            method: "POST",
            headers: {
                "Authorization": `Bearer ${token}`,
                "Content-Type": "application/json",
            },
            body: JSON.stringify(payload),
        });
        const result = await res.json();
        if (!result.ok) {
            console.error("chat.update failed:", result.error);
        }
        return result.ok;
    }
    catch (error) {
        console.error("updateSlackMessage error:", error);
        return false;
    }
}
/**
 * 内部キャスト向けDM用 Block Kit ブロック構築
 * ボタンの value に castingId と slackThreadTs を埋め込み、
 * webhook で受信時にステータス更新 + スレッド返信が可能
 */
function buildCastOrderDmBlocks(params) {
    const dateText = params.dateRanges.join(", ");
    return [
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
            fields: [
                { type: "mrkdwn", text: `*📅 撮影日*\n${dateText}` },
                { type: "mrkdwn", text: `*🏢 アカウント*\n${params.accountName || "未入力"}` },
            ],
        },
        {
            type: "section",
            fields: [
                { type: "mrkdwn", text: `*🎬 作品名*\n${params.projectName}` },
                { type: "mrkdwn", text: `*🎭 役名*\n${params.roleName || "未定"}` },
            ],
        },
        {
            type: "divider",
        },
        {
            type: "actions",
            elements: [
                {
                    type: "button",
                    text: {
                        type: "plain_text",
                        text: "✅ 出演OK",
                        emoji: true,
                    },
                    style: "primary",
                    action_id: "cast_ok",
                    value: JSON.stringify({
                        castingId: params.castingId,
                        castName: params.castName,
                        projectName: params.projectName,
                        slackThreadTs: params.slackThreadTs,
                        slackChannel: params.slackChannel,
                    }),
                },
                {
                    type: "button",
                    text: {
                        type: "plain_text",
                        text: "🔗 スレッドを見る",
                        emoji: true,
                    },
                    action_id: "cast_view_thread",
                    url: params.permalink,
                },
            ],
        },
    ];
}
//# sourceMappingURL=slack.js.map