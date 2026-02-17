"use strict";
/**
 * Slack API ヘルパー
 * Cloud Functions から Slack Bot API を呼び出す
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.postToSlack = postToSlack;
exports.uploadFileToSlack = uploadFileToSlack;
exports.buildSpecialOrderMessage = buildSpecialOrderMessage;
exports.buildOrderMessage = buildOrderMessage;
exports.buildAdditionalOrderMessage = buildAdditionalOrderMessage;
exports.buildOrderUpdateMessage = buildOrderUpdateMessage;
exports.buildStatusMessage = buildStatusMessage;
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
 * Slack にファイル付きメッセージを投稿（files.uploadV2 相当）
 * 1. files.getUploadURLExternal でアップロードURL取得
 * 2. PUT でファイルアップロード
 * 3. files.completeUploadExternal で完了 + メッセージ投稿
 */
async function uploadFileToSlack(token, channel, text, fileBase64, fileName, threadTs) {
    try {
        const fileBuffer = Buffer.from(fileBase64, "base64");
        const fileSize = fileBuffer.length;
        // Step 1: Get upload URL
        const getUrlResponse = await fetch("https://slack.com/api/files.getUploadURLExternal", {
            method: "POST",
            headers: {
                "Authorization": `Bearer ${token}`,
                "Content-Type": "application/x-www-form-urlencoded",
            },
            body: `filename=${encodeURIComponent(fileName)}&length=${fileSize}`,
        });
        const getUrlResult = await getUrlResponse.json();
        if (!getUrlResult.ok || !getUrlResult.upload_url || !getUrlResult.file_id) {
            console.error("Failed to get upload URL:", getUrlResult.error);
            // Fallback: テキストのみ送信
            return await postToSlack(token, channel, text, undefined, threadTs);
        }
        // Step 2: Upload file
        await fetch(getUrlResult.upload_url, {
            method: "PUT",
            headers: { "Content-Type": "application/pdf" },
            body: fileBuffer,
        });
        // Step 3: Complete upload with message
        const completePayload = {
            files: [{ id: getUrlResult.file_id, title: fileName }],
            channel_id: channel,
            initial_comment: text,
        };
        if (threadTs) {
            completePayload.thread_ts = threadTs;
        }
        const completeResponse = await fetch("https://slack.com/api/files.completeUploadExternal", {
            method: "POST",
            headers: {
                "Authorization": `Bearer ${token}`,
                "Content-Type": "application/json",
            },
            body: JSON.stringify(completePayload),
        });
        const completeResult = await completeResponse.json();
        if (!completeResult.ok) {
            console.error("Failed to complete upload:", completeResult.error);
            return await postToSlack(token, channel, text, undefined, threadTs);
        }
        // Extract thread ts from file shares
        let ts = "";
        let permalink = "";
        const fileShares = completeResult.files?.[0]?.shares;
        if (fileShares) {
            // shares structure: { public: { channelId: [{ ts }] }, private: { ... } }
            for (const shareType of Object.values(fileShares)) {
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
        // If no ts from shares, wait and use files.info
        if (!ts) {
            console.log("No ts from shares, trying files.info...");
            await new Promise(resolve => setTimeout(resolve, 2000));
            const infoResponse = await fetch(`https://slack.com/api/files.info?file=${getUrlResult.file_id}`, {
                headers: { "Authorization": `Bearer ${token}` },
            });
            const infoResult = await infoResponse.json();
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
        // Get permalink if we have ts
        if (ts) {
            try {
                const plResponse = await fetch("https://slack.com/api/chat.getPermalink", {
                    method: "POST",
                    headers: {
                        "Authorization": `Bearer ${token}`,
                        "Content-Type": "application/json",
                    },
                    body: JSON.stringify({ channel, message_ts: ts }),
                });
                const plResult = await plResponse.json();
                permalink = plResult.permalink || "";
            }
            catch (e) {
                console.warn("Failed to get permalink:", e);
            }
        }
        console.log("File uploaded successfully, ts:", ts);
        return { ok: true, ts, permalink };
    }
    catch (error) {
        console.error("File upload error:", error);
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
//# sourceMappingURL=slack.js.map