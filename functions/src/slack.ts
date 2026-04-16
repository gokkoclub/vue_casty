/**
 * Slack API ヘルパー
 * Cloud Functions から Slack Bot API を呼び出す
 * ファイルアップロードは @slack/web-api SDK を使用（V1のPython slack_sdkと同等）
 */
import { WebClient } from "@slack/web-api";

interface SlackPostResult {
    ok: boolean;
    ts?: string;
    permalink?: string;
}

interface SlackBlock {
    type: string;
    text?: { type: string; text: string; emoji?: boolean };
    fields?: { type: string; text: string }[];
    elements?: { type: string; text: string }[];
}

/**
 * Slack にメッセージを投稿
 */
export async function postToSlack(
    token: string,
    channel: string,
    text: string,
    blocks?: SlackBlock[],
    threadTs?: string
): Promise<SlackPostResult> {
    const payload: Record<string, unknown> = {
        channel,
        text,
        mrkdwn: true,
    };

    if (blocks) payload.blocks = blocks;
    if (threadTs) payload.thread_ts = threadTs;

    try {
        const response = await fetch("https://slack.com/api/chat.postMessage", {
            method: "POST",
            headers: {
                "Authorization": `Bearer ${token}`,
                "Content-Type": "application/json",
            },
            body: JSON.stringify(payload),
        });

        const result = await response.json() as { ok: boolean; ts?: string; error?: string };

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
            const plResult = await plResponse.json() as { permalink?: string };
            permalink = plResult.permalink || "";
        } catch (e) {
            console.warn("Failed to get permalink:", e);
        }

        return { ok: true, ts: result.ts, permalink };
    } catch (error) {
        console.error("Slack post error:", error);
        throw new Error(`Slack post failed: ${error}`);
    }
}

/**
 * Slack にファイル付きメッセージを投稿
 * @slack/web-api の filesUploadV2 を使用（V1 の Python slack_sdk.files_upload_v2 と同等）
 * SDK がリダイレクト処理・リトライを内部的に処理するため安定動作する
 */
export async function uploadFileToSlack(
    token: string,
    channel: string,
    text: string,
    fileBase64: string,
    fileName: string,
    threadTs?: string
): Promise<SlackPostResult> {
    try {
        const fileBuffer = Buffer.from(fileBase64, "base64");
        console.log("[SLACK SDK] Uploading file:", fileName, "size:", fileBuffer.length);

        const client = new WebClient(token);

        // filesUploadV2 でファイル + メッセージを同時投稿
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const uploadOptions: any = {
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
        const resultAny = uploadResult as any;
        const files = resultAny.files as Array<{
            id: string;
            shares?: Record<string, Record<string, Array<{ ts: string }>>>;
        }> | undefined;

        if (files?.[0]?.shares) {
            for (const shareType of Object.values(files[0].shares)) {
                for (const channelShares of Object.values(shareType)) {
                    if (channelShares?.[0]?.ts) {
                        ts = channelShares[0].ts;
                        break;
                    }
                }
                if (ts) break;
            }
        }

        // ts が取れない場合は files.info で再取得
        if (!ts && files?.[0]?.id) {
            console.log("[SLACK SDK] No ts from shares, trying files.info...");
            try {
                const infoResult = await client.files.info({ file: files[0].id });
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                const infoShares = (infoResult.file as any)?.shares as Record<string, Record<string, Array<{ ts: string }>>> | undefined;
                if (infoShares) {
                    for (const shareType of Object.values(infoShares)) {
                        for (const channelShares of Object.values(shareType)) {
                            if (channelShares?.[0]?.ts) {
                                ts = channelShares[0].ts;
                                break;
                            }
                        }
                        if (ts) break;
                    }
                }
            } catch (infoErr) {
                console.warn("[SLACK SDK] files.info failed:", infoErr);
            }
        }

        // ── ts 検証 & フォールバック ──
        // ts が取れている場合: getPermalink で存在確認
        // ts が空 or getPermalink 失敗: conversations.history から正しい ts を取得
        let tsVerified = false;
        if (ts) {
            try {
                const plResult = await client.chat.getPermalink({
                    channel,
                    message_ts: ts,
                });
                permalink = plResult.permalink || "";
                tsVerified = true;
            } catch (plErr) {
                console.warn("[SLACK SDK] getPermalink failed for ts:", ts, "— ts may be invalid");
                ts = "";  // リセットしてフォールバックへ
            }
        }

        // ts が空（shares/files.info から取得失敗、またはgetPermalink検証失敗）
        // → conversations.history で直近のファイル付きメッセージから ts を取得
        if (!ts) {
            console.log("[SLACK SDK] ts empty, falling back to conversations.history...");
            try {
                const history = await client.conversations.history({
                    channel,
                    limit: 5,
                });
                // ファイル名が一致するメッセージ、またはBot投稿の直近メッセージを探す
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                const botMsg = (history.messages || []).find((m: any) =>
                    (m.files && m.files.length > 0 && m.files.some((f: any) => f.name === fileName)) ||
                    (m.bot_id && m.text && m.text.includes(text.substring(0, 50)))
                );
                if (botMsg?.ts) {
                    console.log("[SLACK SDK] Found ts from history:", botMsg.ts);
                    ts = botMsg.ts;
                    // permalink 取得
                    try {
                        const plResult2 = await client.chat.getPermalink({ channel, message_ts: ts });
                        permalink = plResult2.permalink || "";
                    } catch { /* ignore */ }
                    tsVerified = true;
                } else {
                    console.warn("[SLACK SDK] Could not find message in history");
                }
            } catch (histErr) {
                console.warn("[SLACK SDK] conversations.history fallback failed:", histErr);
            }
        }

        console.log("[SLACK SDK] File uploaded, ts:", ts, "permalink:", permalink, "verified:", tsVerified);
        return { ok: true, ts, permalink };

    } catch (error) {
        console.error("[SLACK SDK] File upload error:", error);
        // Fallback to text-only
        return await postToSlack(token, channel, text, undefined, threadTs);
    }
}

/**
 * 特別オーダー（外部案件/社内イベント）のSlackメッセージを構築
 * ORDER_INTEGRATION_GUIDE セクション4・5準拠
 */
export function buildSpecialOrderMessage(params: {
    mode: "external" | "internal";
    title: string;
    dateRanges: string[];
    startTime?: string;
    endTime?: string;
    items: Array<{
        castName: string;
        castType: string;
        slackMentionId?: string;
        conflictInfo?: string;
    }>;
    ccMention?: string; // 作成者のSlackメンション or 名前
    ordererName?: string;
    castingIds?: string[];
}): string {
    const lines: string[] = [];

    // ヘッダー（オーダー主名を含む）
    const ordererSuffix = params.ordererName ? `（${params.ordererName}からオーダー）` : "";
    if (params.mode === "external") {
        lines.push(`【外部案件】${ordererSuffix}`);
    } else {
        lines.push(`【社内イベント】${ordererSuffix}`);
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

    // キャスティング ID（スレッド紐付け用）
    if (params.castingIds && params.castingIds.length > 0) {
        lines.push("");
        lines.push(`\`casting\` ${params.castingIds.join(", ")}`);
    }

    return lines.join("\n");
}

/**
 * 連続した日付をレンジにまとめる
 * 入力: ["2026/03/19", "2026/03/20", "2026/03/21", "2026/03/24", "2026/03/25"]
 * 出力: ["3/19〜3/21", "3/24〜3/25"]
 */
function compactDateRanges(dates: string[]): string[] {
    if (dates.length === 0) return [];
    if (dates.length === 1) {
        return [toShortDate(dates[0]!)];
    }

    // Parse and sort
    const parsed = dates
        .map(d => {
            const parts = d.split("/");
            if (parts.length === 3) {
                return { raw: d, y: parseInt(parts[0]!), m: parseInt(parts[1]!), d: parseInt(parts[2]!) };
            }
            return null;
        })
        .filter(Boolean) as Array<{ raw: string; y: number; m: number; d: number }>;

    if (parsed.length === 0) return dates.map(toShortDate);

    parsed.sort((a, b) => {
        if (a.y !== b.y) return a.y - b.y;
        if (a.m !== b.m) return a.m - b.m;
        return a.d - b.d;
    });

    // Group consecutive dates
    const ranges: Array<{ start: typeof parsed[0]; end: typeof parsed[0] }> = [];
    let rangeStart = parsed[0]!;
    let rangeEnd = parsed[0]!;

    for (let i = 1; i < parsed.length; i++) {
        const prev = rangeEnd;
        const curr = parsed[i]!;
        // Check if consecutive (simple day+1 check, handles month wrap via Date)
        const prevDate = new Date(prev.y, prev.m - 1, prev.d);
        const currDate = new Date(curr.y, curr.m - 1, curr.d);
        const diffDays = (currDate.getTime() - prevDate.getTime()) / (1000 * 60 * 60 * 24);

        if (diffDays === 1) {
            rangeEnd = curr;
        } else {
            ranges.push({ start: rangeStart, end: rangeEnd });
            rangeStart = curr;
            rangeEnd = curr;
        }
    }
    ranges.push({ start: rangeStart, end: rangeEnd });

    return ranges.map(r => {
        const s = `${r.start.m}/${r.start.d}`;
        if (r.start.raw === r.end.raw) return s;
        const e = `${r.end.m}/${r.end.d}`;
        return `${s}〜${e}`;
    });
}

function toShortDate(dateStr: string): string {
    const parts = dateStr.split("/");
    if (parts.length === 3) {
        return `${parseInt(parts[1]!)}/${parseInt(parts[2]!)}`;
    }
    return dateStr;
}

/**
 * オーダー通知メッセージを構築
 */
export function buildOrderMessage(params: {
    accountName: string;
    projectName: string;
    dateRanges: string[];
    items: Array<{
        castName: string;
        roleName: string;
        rank: number;
        castType: string;
        mainSub: string;
        slackMentionId?: string;
        projectName: string;
        conflictInfo?: string;
        selectedDates?: string[];
    }>;
    projectId?: string;
    hasInternal: boolean;
    mode?: string;
    mentionGroupId?: string;
    ccString?: string;
    ordererName?: string;
    castingIds?: string[];
}): string {
    const isShooting = params.mode === "shooting" || !params.mode;
    const dateLabel = isShooting ? "撮影日" : "日程";
    const lines: string[] = [];

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

    // ヘッダー（オーダー主名を含む）
    const ordererSuffix = params.ordererName ? `（${params.ordererName}からオーダー）` : "";
    if (isShooting) {
        lines.push(`キャスティングオーダーがありました。${ordererSuffix}`);
    } else if (params.mode === "external") {
        lines.push(`外部案件のオーダーがありました。${ordererSuffix}`);
    } else {
        lines.push(`社内イベントのオーダーがありました。${ordererSuffix}`);
    }

    if (params.hasInternal) {
        lines.push("*内部キャストはスタンプで反応ください*");
    }

    // 撮影日/日程
    lines.push("");
    lines.push(`\`${dateLabel}\``);
    const compactedTopDates = compactDateRanges(params.dateRanges);
    compactedTopDates.forEach((d) => lines.push(`・${d}`));

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
    const grouped: Record<string, Record<string, typeof params.items>> = {};
    params.items.forEach((item) => {
        if (!grouped[item.projectName]) grouped[item.projectName] = {};
        const pg = grouped[item.projectName]!;
        if (!pg[item.roleName]) pg[item.roleName] = [];
        pg[item.roleName]!.push(item);
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

    // 📅 日付ごとのスケジュール（撮影日が複数ある場合のみ表示）
    const hasPerCastDates = params.items.some(i => i.selectedDates && i.selectedDates.length > 0);
    const hasMultipleDates = params.dateRanges.length > 1;
    if (hasPerCastDates && hasMultipleDates) {
        lines.push("");
        lines.push("`スケジュール`");

        // 全日付を収集してソート
        const allDates = new Set<string>();
        params.items.forEach(item => {
            const dates = item.selectedDates && item.selectedDates.length > 0
                ? item.selectedDates
                : params.dateRanges;
            dates.forEach(d => allDates.add(d));
        });
        const sortedDates = [...allDates].sort();

        // キャストごとの参加日をレンジにまとめて表示
        // まず役ごと → キャストごとの日付をグループ化
        const castDateMap: Record<string, string[]> = {}; // key: roleName_rank_castName
        const castInfoMap: Record<string, { roleName: string; rank: number; mention: string }> = {};

        for (const item of params.items) {
            const dates = item.selectedDates && item.selectedDates.length > 0
                ? item.selectedDates
                : params.dateRanges;
            const key = `${item.roleName}_${item.rank}_${item.castName}`;
            castDateMap[key] = dates;
            const mention = item.slackMentionId ? `<@${item.slackMentionId}>` : item.castName;
            castInfoMap[key] = { roleName: item.roleName, rank: item.rank, mention };
        }

        // 役ごとにグループ化して表示
        const roleOrder: Record<string, Array<{ key: string; rank: number }>> = {};
        for (const [key, info] of Object.entries(castInfoMap)) {
            if (!roleOrder[info.roleName]) roleOrder[info.roleName] = [];
            roleOrder[info.roleName]!.push({ key, rank: info.rank });
        }

        for (const [roleName, entries] of Object.entries(roleOrder)) {
            entries.sort((a, b) => a.rank - b.rank);
            for (const entry of entries) {
                const info = castInfoMap[entry.key]!;
                const dates = castDateMap[entry.key] || [];
                const compacted = compactDateRanges(dates).join("、");
                lines.push(`  ${roleName} 第${info.rank}候補: ${info.mention}（${compacted}）`);
            }
        }
    }

    // Notionリンク
    if (params.projectId) {
        lines.push("");
        lines.push("`Notionリンク`");
        lines.push(`https://www.notion.so/${params.projectId.replace(/-/g, "")}`);
    }

    // キャスティング ID（スレッド紐付け用）
    if (params.castingIds && params.castingIds.length > 0) {
        lines.push("");
        lines.push(`\`casting\` ${params.castingIds.join(", ")}`);
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
export function buildAdditionalOrderMessage(params: {
    items: Array<{
        castName: string;
        roleName: string;
        rank: number;
        castType: string;
        mainSub: string;
        slackMentionId?: string;
        projectName: string;
    }>;
    hasInternal: boolean;
    mentionGroupId?: string;
    castingIds?: string[];
}): string {
    const lines: string[] = [];

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
    const grouped: Record<string, Record<string, typeof params.items>> = {};
    params.items.forEach((item) => {
        if (!grouped[item.projectName]) grouped[item.projectName] = {};
        const pg = grouped[item.projectName]!;
        if (!pg[item.roleName]) pg[item.roleName] = [];
        pg[item.roleName]!.push(item);
    });

    for (const [projectName, roles] of Object.entries(grouped)) {
        lines.push(`【${projectName}】`);
        for (const [roleName, casts] of Object.entries(roles)) {
            // 候補を / で区切って横並び表示
            const castList = casts
                .sort((a, b) => a.rank - b.rank)
                .map((c) =>
                    c.slackMentionId ? `<@${c.slackMentionId}>` : c.castName
                )
                .join(" / ");
            lines.push(`${roleName}：${castList}`);
        }
        lines.push("");
    }

    // キャスティング ID（スレッド紐付け用）
    if (params.castingIds && params.castingIds.length > 0) {
        lines.push(`\`casting\` ${params.castingIds.join(", ")}`);
    }

    return lines.join("\n").trim();
}

/**
 * オーダー内容変更通知メッセージを構築
 */
export function buildOrderUpdateMessage(params: {
    castName: string;
    projectName: string;
    changes: {
        startDate?: { from: string; to: string };
        endDate?: { from: string; to: string };
        startTime?: { from: string; to: string };
        endTime?: { from: string; to: string };
        projectName?: { from: string; to: string };
    };
}): string {
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
export function buildStatusMessage(params: {
    castName: string;
    projectName: string;
    oldStatus: string;
    newStatus: string;
    cost?: number;
    extraMessage?: string;
}): string {
    let emoji = "📝";
    if (params.newStatus === "OK") emoji = "✅";
    if (params.newStatus === "決定") emoji = "🎉";
    if (params.newStatus === "NG") emoji = "❌";
    if (params.newStatus === "キャンセル") emoji = "🚫";
    if (params.newStatus === "条件つきOK") emoji = "🟡";

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
export async function sendDmToUser(
    token: string,
    userId: string,
    text: string,
    blocks?: unknown[]
): Promise<SlackPostResult> {
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
        const openResult = await openRes.json() as {
            ok: boolean;
            channel?: { id: string };
            error?: string;
        };

        if (!openResult.ok || !openResult.channel?.id) {
            console.error("conversations.open failed:", openResult.error);
            return { ok: false };
        }

        const dmChannelId = openResult.channel.id;

        // 2. DM にメッセージ送信
        const payload: Record<string, unknown> = {
            channel: dmChannelId,
            text,
            mrkdwn: true,
        };
        if (blocks) payload.blocks = blocks;

        const postRes = await fetch("https://slack.com/api/chat.postMessage", {
            method: "POST",
            headers: {
                "Authorization": `Bearer ${token}`,
                "Content-Type": "application/json",
            },
            body: JSON.stringify(payload),
        });
        const postResult = await postRes.json() as {
            ok: boolean;
            ts?: string;
            error?: string;
        };

        if (!postResult.ok) {
            console.error("DM send failed:", postResult.error);
            return { ok: false };
        }

        console.log(`[DM] Sent to ${userId}, ts: ${postResult.ts}`);
        return { ok: true, ts: postResult.ts };
    } catch (error) {
        console.error("sendDmToUser error:", error);
        return { ok: false };
    }
}

/**
 * 既存のSlackメッセージを更新（ボタン → 結果テキストに差し替え等）
 */
export async function updateSlackMessage(
    token: string,
    channel: string,
    ts: string,
    text: string,
    blocks?: unknown[]
): Promise<boolean> {
    try {
        const payload: Record<string, unknown> = {
            channel,
            ts,
            text,
        };
        if (blocks) payload.blocks = blocks;

        const res = await fetch("https://slack.com/api/chat.update", {
            method: "POST",
            headers: {
                "Authorization": `Bearer ${token}`,
                "Content-Type": "application/json",
            },
            body: JSON.stringify(payload),
        });
        const result = await res.json() as { ok: boolean; error?: string };
        if (!result.ok) {
            console.error("chat.update failed:", result.error);
        }
        return result.ok;
    } catch (error) {
        console.error("updateSlackMessage error:", error);
        return false;
    }
}

/**
 * 内部キャスト向けDM用 Block Kit ブロック構築
 * ボタンの value に castingId と slackThreadTs を埋め込み、
 * webhook で受信時にステータス更新 + スレッド返信が可能
 */
export function buildCastOrderDmBlocks(params: {
    castName: string;
    projectName: string;
    roleName: string;
    dateRanges: string[];
    accountName: string;
    castingId: string;
    slackThreadTs: string;
    slackChannel: string;
    permalink: string;
}): unknown[] {
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
