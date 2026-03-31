/**
 * Cloud Functions - エントリーポイント
 *
 * リアルタイム処理:
 *   - notifyOrderCreated: オーダー送信 → Slack通知 + Calendar作成
 *   - notifyStatusUpdate: ステータス変更 → Slack返信 + Calendar更新 + Notion同期
 *   - deleteCastingCleanup: 削除 → Calendar削除 + Slack通知
 *   - getShootingDetails: 香盤DBからIN/OUT/場所取得
 *   - syncShootingDetailsToContacts: 香盤DB → 撮影連絡DB一括反映
 *   - syncDriveLinksToContacts: オフショットDriveリンク → 撮影連絡DB反映
 */

import { onCall, HttpsError } from "firebase-functions/v2/https";
import { setGlobalOptions } from "firebase-functions/v2/options";

// リージョン設定（東京）- MUST be before any function re-exports
setGlobalOptions({ region: "asia-northeast1" });

import * as admin from "firebase-admin";
import { postToSlack, uploadFileToSlack, buildOrderMessage, buildAdditionalOrderMessage, buildSpecialOrderMessage, buildStatusMessage, buildOrderUpdateMessage, sendDmToUser, buildCastOrderDmBlocks } from "./slack";
import { createCalendarEvent, handleCalendarStatusChange, updateCalendarEventTime, updateCalendarEventTitle } from "./calendar";
import { syncCastToNotion, createNotionCastPage } from "./notion";

// Re-export new Cloud Functions
export { getShootingDetails, syncShootingDetailsToContacts } from "./shootingDetails";
export { syncDriveLinksToContacts } from "./driveSync";
export { syncScheduleFromSam, scheduledSyncFromSam } from "./syncFromSam";
export { handleSlackInteraction } from "./slackInteraction";

// ─────────────────────────────────────────────
// createNotionCast: Vue から新規キャストを Notion に登録
// ─────────────────────────────────────────────
export const createNotionCast = onCall(
    {
        secrets: ["NOTION_TOKEN", "NOTION_CAST_DB_ID"],
    },
    async (request) => {
        const { castId, name, gender, agency, email } = request.data;

        if (!castId || !name) {
            throw new HttpsError("invalid-argument", "castId and name are required");
        }

        const notionToken = getEnv("NOTION_TOKEN");
        const databaseId = getEnv("NOTION_CAST_DB_ID");

        if (!notionToken || !databaseId) {
            throw new HttpsError("failed-precondition", "NOTION_TOKEN or NOTION_CAST_DB_ID not configured");
        }

        const pageId = await createNotionCastPage({
            notionToken,
            databaseId,
            castId,
            name,
            gender: gender || undefined,
            agency: agency || undefined,
            email: email || undefined,
        });

        if (!pageId) {
            throw new HttpsError("internal", "Failed to create Notion page");
        }

        return { success: true, notionPageId: pageId };
    });

admin.initializeApp();

// ──────────────────────────────────────
// 環境変数の取得ヘルパー
// ──────────────────────────────────────
function getEnv(key: string): string {
    const value = process.env[key];
    if (!value) {
        console.warn(`Environment variable ${key} is not set`);
        return "";
    }
    return value.trim();
}

/**
 * casting ドキュメントから Slack チャンネルIDを解決
 * 優先順位: slackChannel > slackPermalink から抽出 > SLACK_CHANNEL_INTERNAL
 */
function resolveSlackChannel(casting: { slackChannel?: string; slackPermalink?: string }): string {
    if (casting.slackChannel) return casting.slackChannel;
    // slackPermalink: https://...slack.com/archives/C07DTG63WQ1/p1767599451662959
    if (casting.slackPermalink) {
        const match = casting.slackPermalink.match(/\/archives\/(C[A-Z0-9]+)\//)
        if (match && match[1]) return match[1];
    }
    return getEnv("SLACK_CHANNEL_INTERNAL");
}

/**
 * 名前からSlack IDを検索するヘルパー
 * casts → admins の順に検索
 */
async function lookupSlackIdByName(name: string): Promise<string> {
    if (!name) return "";
    try {
        const firestore = admin.firestore();
        // castsコレクションから名前で検索
        const castSnap = await firestore.collection("casts")
            .where("name", "==", name)
            .limit(1)
            .get();
        if (!castSnap.empty) {
            const data = castSnap.docs[0]!.data();
            if (data.slackMentionId) return data.slackMentionId;
        }

        // adminsコレクションから名前で検索
        const adminSnap = await firestore.collection("admin")
            .where("name", "==", name)
            .limit(1)
            .get();
        if (!adminSnap.empty) {
            const data = adminSnap.docs[0]!.data();
            if (data.slackMentionId) return data.slackMentionId;
        }
    } catch (e) {
        console.warn(`Slack ID lookup failed for name: ${name}`, e);
    }
    return "";
}

// ──────────────────────────────────────
// 1. オーダー送信通知
// ──────────────────────────────────────
export const notifyOrderCreated = onCall(
    {
        maxInstances: 10,
        secrets: [
            "SLACK_BOT_TOKEN",
            "SLACK_CHANNEL_INTERNAL",
            "SLACK_CHANNEL_EXTERNAL",
            "SLACK_MENTION_GROUP_ID",
            "GOOGLE_SERVICE_ACCOUNT_KEY",
            "GOOGLE_CALENDAR_ID",
        ],
    },
    async (request) => {
        const data = request.data;
        console.log("=== notifyOrderCreated v2.2 ===");
        console.log("data keys:", Object.keys(data || {}));

        if (!data || !data.items || data.items.length === 0) {
            throw new HttpsError("invalid-argument", "items is required");
        }

        const slackToken = getEnv("SLACK_BOT_TOKEN");
        const slackChannelInternal = getEnv("SLACK_CHANNEL_INTERNAL");
        const slackChannelExternal = getEnv("SLACK_CHANNEL_EXTERNAL");
        const mentionGroupId = getEnv("SLACK_MENTION_GROUP_ID");

        // チャンネルルーティング: 外部案件 → EXTERNAL, それ以外 → INTERNAL
        const orderMode = data.mode || "shooting";
        const slackChannel = orderMode === "external" ? slackChannelExternal : slackChannelInternal;
        console.log("Channel routing:", orderMode, "→", slackChannel);

        if (!slackToken || !slackChannel) {
            throw new HttpsError("failed-precondition", "Slack configuration missing");
        }

        const db = admin.firestore();

        // ── 追加オーダー自動判定 ──
        // 同じ projectId を持つ既存 casting の slackThreadTs を検索
        let existingThreadTs = "";
        let existingPermalink = "";
        if (data.projectId) {
            const existingSnap = await db.collection("castings")
                .where("projectId", "==", data.projectId)
                .where("slackThreadTs", "!=", "")
                .limit(1)
                .get();

            if (!existingSnap.empty) {
                const existingData = existingSnap.docs[0]!.data();
                existingThreadTs = existingData.slackThreadTs || "";
                existingPermalink = existingData.slackPermalink || "";
            }
        }
        const isAdditional = !!existingThreadTs;

        // ── メッセージ構築 ──
        console.log("Order mode:", orderMode, "isAdditional:", isAdditional);

        // ── CC欄構築（Slack IDメンション解決付き） ──
        let ccString = "";
        if (orderMode === "shooting" && data.shootingData) {
            const ccParts: string[] = [];
            if (data.shootingData.director) {
                const slackId = await lookupSlackIdByName(data.shootingData.director);
                const mention = slackId ? `<@${slackId}>` : data.shootingData.director;
                ccParts.push(`CD: ${mention}`);
            }
            if (data.shootingData.floorDirector) {
                const slackId = await lookupSlackIdByName(data.shootingData.floorDirector);
                const mention = slackId ? `<@${slackId}>` : data.shootingData.floorDirector;
                ccParts.push(`FD: ${mention}`);
            }
            if (data.shootingData.team) {
                const slackId = await lookupSlackIdByName(data.shootingData.team);
                const mention = slackId ? `<@${slackId}>` : data.shootingData.team;
                ccParts.push(`P: ${mention}`);
            }
            ccString = ccParts.join(" / ");
        }

        // ── オーダー主のSlack IDを解決 ──
        // ログインユーザーのメールアドレスからSlack IDを検索
        let orderCreatorMention = "";
        try {
            const userEmail = request.auth?.token?.email;
            if (userEmail) {
                // castsコレクションから検索
                const castSnap = await db.collection("casts")
                    .where("email", "==", userEmail)
                    .limit(1)
                    .get();

                if (!castSnap.empty) {
                    const castData = castSnap.docs[0]!.data();
                    if (castData.slackMentionId) {
                        orderCreatorMention = `<@${castData.slackMentionId}>`;
                    }
                }

                // castsで見つからない場合、adminsから検索
                if (!orderCreatorMention) {
                    const adminSnap = await db.collection("admin")
                        .where("email", "==", userEmail)
                        .limit(1)
                        .get();

                    if (!adminSnap.empty) {
                        const adminData = adminSnap.docs[0]!.data();
                        if (adminData.slackMentionId) {
                            orderCreatorMention = `<@${adminData.slackMentionId}>`;
                        }
                    }
                }

                console.log("Order creator mention resolved:", orderCreatorMention, "from email:", userEmail);
            }
        } catch (e) {
            console.warn("Order creator Slack ID lookup failed:", e);
        }

        // オーダー主をCC末尾に追加
        let resolvedCcMention = data.ccMention || orderCreatorMention || "";
        if (orderCreatorMention && ccString) {
            ccString = ccString + " / オーダー主: " + orderCreatorMention;
        }

        // ── 衝突チェック ──
        // 各キャストの各日付で既存の仮押さえ/決定があるか確認
        const conflictDebug: Array<Record<string, unknown>> = [];
        const itemsWithConflict = await Promise.all(
            (data.items as Array<{
                castId: string;
                castName: string;
                castType: string;
                roleName: string;
                rank: number;
                mainSub: string;
                slackMentionId?: string;
                projectName: string;
            }>).map(async (item) => {
                let conflictInfo = "";
                const debugEntry: Record<string, unknown> = {
                    castId: item.castId,
                    castName: item.castName,
                };
                try {
                    const dateRanges = data.dateRanges || [];
                    debugEntry.dateRanges = dateRanges;
                    for (const dateRange of dateRanges) {
                        const dateStr = dateRange.includes("~")
                            ? dateRange.split("~")[0]!.trim()
                            : dateRange;
                        // YYYY/MM/DD → Date
                        const dateParts = dateStr.split("/");
                        if (dateParts.length !== 3) {
                            debugEntry.skipReason = `dateParts.length=${dateParts.length}`;
                            continue;
                        }
                        const searchDate = new Date(
                            parseInt(dateParts[0]!),
                            parseInt(dateParts[1]!) - 1,
                            parseInt(dateParts[2]!)
                        );
                        const nextDay = new Date(searchDate);
                        nextDay.setDate(nextDay.getDate() + 1);

                        debugEntry.searchDateISO = searchDate.toISOString();
                        debugEntry.nextDayISO = nextDay.toISOString();

                        const conflictSnap = await db.collection("castings")
                            .where("castId", "==", item.castId)
                            .where("startDate", ">=", admin.firestore.Timestamp.fromDate(searchDate))
                            .where("startDate", "<", admin.firestore.Timestamp.fromDate(nextDay))
                            .where("status", "in", ["仮押さえ", "仮キャスティング", "打診中", "オーダー待ち", "決定", "OK"])
                            .limit(10)
                            .get();

                        // 今回のオーダーで作成された casting を除外（自己コンフリクト防止）
                        const currentCastingIds: string[] = data.castingIds || [];
                        const filteredDocs = conflictSnap.docs.filter(
                            d => !currentCastingIds.includes(d.id)
                        );

                        debugEntry.conflictFound = filteredDocs.length > 0;
                        debugEntry.conflictCount = filteredDocs.length;

                        if (filteredDocs.length > 0) {
                            const existing = filteredDocs[0]!.data();
                            conflictInfo = `同日に別の撮影があります（${existing.projectName || "不明"}）`;
                            debugEntry.existingProject = existing.projectName;
                            debugEntry.existingStatus = existing.status;
                            break;
                        }
                    }
                } catch (e) {
                    const errMsg = e instanceof Error ? e.message : String(e);
                    console.warn("Conflict check failed for", item.castName, errMsg);
                    debugEntry.error = errMsg;
                }
                conflictDebug.push(debugEntry);
                return { ...item, conflictInfo: conflictInfo || undefined };
            })
        );

        let message: string;
        if (isAdditional) {
            message = buildAdditionalOrderMessage({
                items: itemsWithConflict,
                hasInternal: data.hasInternal || false,
                mentionGroupId: mentionGroupId || undefined,
            });
        } else if (orderMode === "external" || orderMode === "internal") {
            // 特別オーダー: ORDER_INTEGRATION_GUIDE セクション4・5準拠
            message = buildSpecialOrderMessage({
                mode: orderMode as "external" | "internal",
                title: data.projectName || data.items[0]?.projectName || "",
                dateRanges: data.dateRanges || [],
                startTime: data.startTime,
                endTime: data.endTime,
                items: itemsWithConflict,
                ccMention: resolvedCcMention || undefined,
            });
        } else {
            // 撮影オーダー
            message = buildOrderMessage({
                accountName: data.accountName,
                projectName: data.projectName || data.items[0]?.projectName || "",
                dateRanges: data.dateRanges || [],
                items: itemsWithConflict,
                projectId: data.projectId,
                hasInternal: data.hasInternal || false,
                mode: orderMode,
                mentionGroupId: mentionGroupId || undefined,
                ccString: ccString || undefined,
            });
        }

        // ── Slack送信 ──
        // PDF添付がある場合: Slack SDK でアップロード（V1と同じ方式）
        // 追加オーダー時は既存スレッドに返信
        const threadTsForReply = isAdditional ? existingThreadTs : undefined;
        console.log("PDF check:", {
            hasPdfBase64: !!data.pdfBase64,
            pdfBase64Length: data.pdfBase64?.length || 0,
            pdfFileName: data.pdfFileName || "(none)",
        });

        let slackResult: { ok: boolean; ts?: string; permalink?: string } = { ok: false };
        try {
            slackResult = data.pdfBase64 && data.pdfFileName
                ? await uploadFileToSlack(
                    slackToken,
                    slackChannel,
                    message,
                    data.pdfBase64,
                    data.pdfFileName,
                    threadTsForReply
                )
                : await postToSlack(
                    slackToken,
                    slackChannel,
                    message,
                    undefined,
                    threadTsForReply
                );
            console.log("Slack post completed, ts:", slackResult.ts, "permalink:", slackResult.permalink);
        } catch (slackError) {
            console.error("Slack post failed (continuing to calendar):", slackError);
        }

        // ── カレンダーイベント作成（内部キャストのみ）──
        const serviceAccountKey = getEnv("GOOGLE_SERVICE_ACCOUNT_KEY");
        const calendarId = getEnv("GOOGLE_CALENDAR_ID");
        const calendarResults: Record<string, { eventId: string; castEmail: string }> = {};
        const calendarDebug: Record<string, unknown> = {
            hasServiceAccountKey: !!serviceAccountKey,
            serviceAccountKeyLength: serviceAccountKey?.length || 0,
            hasCalendarId: !!calendarId,
            calendarId: calendarId || "(empty)",
            itemCastTypes: (data.items as Array<{ castType: string }>).map(i => i.castType),
            dateRanges: data.dateRanges,
            receivedStartTime: data.startTime || "(empty)",
            receivedEndTime: data.endTime || "(empty)",
        };

        // Extract SA email from secret for diagnostics
        if (serviceAccountKey) {
            try {
                const parsed = JSON.parse(serviceAccountKey);
                calendarDebug.saEmail = parsed.client_email || "(missing)";
                calendarDebug.saProjectId = parsed.project_id || "(missing)";
            } catch {
                calendarDebug.saParseError = "Failed to parse service account key JSON";
            }
        }

        console.log("Calendar check: serviceAccountKey exists:", !!serviceAccountKey, "length:", serviceAccountKey?.length, "calendarId exists:", !!calendarId, "calendarId:", calendarId);

        if (serviceAccountKey && calendarId) {
            try {
                const internalItems = (data.items as Array<{
                    castName: string;
                    castId: string;
                    projectName: string;
                    castType: string;
                    roleName?: string;
                    rank?: string;
                    mainSub?: string;
                    selectedDates?: string[];
                }>).filter(
                    (item) => item.castType === "内部"
                );

                console.log("Calendar: internalItems count:", internalItems.length);
                console.log("Calendar: dateRanges:", data.dateRanges);
                calendarDebug.internalItemsCount = internalItems.length;

                for (const item of internalItems) {
                    // キャストのメールアドレスを取得（カレンダー招待用）
                    let castEmail = "";
                    try {
                        const castDoc = await db.collection("casts").doc(item.castId).get();
                        if (castDoc.exists) {
                            castEmail = castDoc.data()?.email || "";
                        }
                        console.log(`Calendar: castEmail for ${item.castName}:`, castEmail || "(none)");
                    } catch (e) {
                        console.warn(`Failed to get email for cast ${item.castId}:`, e);
                    }

                    // per-item selectedDates があればそれを使用、なければ全日程
                    const itemDates = item.selectedDates && item.selectedDates.length > 0
                        ? item.selectedDates
                        : (data.dateRanges || []);

                    for (const dateRange of itemDates) {
                        const [startDate] = dateRange.includes("~")
                            ? dateRange.split("~").map((s: string) => s.trim())
                            : [dateRange];

                        // Calendar API requires YYYY-MM-DD format
                        const rawDate = startDate || dateRange;
                        const calendarDate = rawDate.replace(/\//g, "-");
                        console.log("Calendar date:", rawDate, "→", calendarDate);

                        try {
                            const eventId = await createCalendarEvent({
                                serviceAccountKey,
                                calendarId,
                                castName: item.castName,
                                projectName: item.projectName,
                                accountName: data.accountName || "",
                                roleName: item.roleName || "出演",
                                rank: item.rank || "",
                                mainSub: item.mainSub || "その他",
                                castingId: item.castId || "",
                                castEmail: castEmail || undefined,
                                status: "仮キャスティング",
                                startDate: calendarDate,
                                startTime: data.startTime || undefined,
                                endTime: data.endTime || undefined,
                                isProvisional: true,
                            });

                            if (eventId) {
                                const key = `${item.castName}_${startDate || dateRange}`;
                                calendarResults[key] = { eventId, castEmail: castEmail || "" };
                            }
                        } catch (eventError) {
                            const errMsg = eventError instanceof Error ? eventError.message : String(eventError);
                            console.error(`Calendar event failed for ${item.castName}:`, errMsg);
                            calendarDebug.eventError = errMsg;
                            calendarDebug.eventErrorCast = item.castName;
                            calendarDebug.eventErrorDate = calendarDate;
                        }
                    }
                }
            } catch (calendarError) {
                console.error("Calendar creation failed:", calendarError);
                calendarDebug.error = String(calendarError);
            }
        } else {
            console.warn("Calendar skipped: missing serviceAccountKey or calendarId");
        }

        // ── castingIds に Slack 情報を書き戻す ──
        // 追加オーダー時: 既存の threadTs を使用
        // 新規オーダー時: 今回のSlack投稿の ts を使用
        const threadTs = isAdditional ? existingThreadTs : (slackResult.ts || "");
        const permalink = isAdditional ? existingPermalink : (slackResult.permalink || "");

        const castingIds: string[] = data.castingIds || [];
        if (castingIds.length > 0 && threadTs) {
            const batch = db.batch();
            const items = data.items as Array<{
                castName: string;
                castType: string;
                selectedDates?: string[];
            }>;

            for (let i = 0; i < castingIds.length; i++) {
                const updateData: Record<string, string> = {
                    slackThreadTs: threadTs,
                    slackPermalink: permalink,
                    slackChannel: slackChannel,
                };

                // カレンダーイベントIDをマッチして書き戻す
                const item = items[i];
                if (item && item.castType === "内部") {
                    const itemDates = item.selectedDates && item.selectedDates.length > 0
                        ? item.selectedDates
                        : (data.dateRanges || []);
                    for (const dateRange of itemDates) {
                        const startDate = dateRange.includes("~")
                            ? dateRange.split("~")[0]!.trim()
                            : dateRange;
                        const key = `${item.castName}_${startDate}`;
                        if (calendarResults[key]) {
                            updateData.calendarEventId = calendarResults[key]!.eventId;
                            break;
                        }
                    }
                }

                batch.update(db.collection("castings").doc(castingIds[i]!), updateData);
            }

            await batch.commit();
        }

        // ── 内部キャストへ Slack DM 送信 ──
        // 撮影オーダー時のみDM送信（外部案件・社内イベントはスキップ）
        const dmPermalink = permalink || (threadTs ? `https://slack.com/app` : "");
        if (threadTs && (orderMode === "shooting" || !orderMode)) {
            const internalItemsForDm = (data.items as Array<{
                castName: string;
                castId: string;
                castType: string;
                slackMentionId?: string;
                projectName: string;
                roleName?: string;
                rank?: number;
            }>).filter(item =>
                item.castType === "内部" &&
                item.slackMentionId &&
                (item.rank ?? 1) === 1  // 第1候補のみDM送信。第2候補以降はNG時に繰り上がりDMを送る
            );

            for (let i = 0; i < internalItemsForDm.length; i++) {
                const item = internalItemsForDm[i]!;
                // castingId を取得（items と castingIds は同じ順序）
                const allItems = data.items as Array<{ castName: string; castType: string }>;
                const originalIndex = allItems.findIndex(
                    (ai: { castName: string; castType: string }) => ai.castName === item.castName && ai.castType === item.castType
                );
                const castingId = castingIds[originalIndex] || "";

                if (!castingId || !item.slackMentionId) continue;

                try {
                    const dmBlocks = buildCastOrderDmBlocks({
                        castName: item.castName,
                        projectName: item.projectName,
                        roleName: item.roleName || "出演",
                        dateRanges: data.dateRanges || [],
                        accountName: data.accountName || "",
                        castingId,
                        slackThreadTs: threadTs,
                        slackChannel: slackChannel,
                        permalink: dmPermalink,
                    });

                    const dmText = `📋 ${(data.dateRanges || []).join(", ")} 撮影オーダーが来ています（${item.projectName}）`;
                    await sendDmToUser(slackToken, item.slackMentionId, dmText, dmBlocks);
                    console.log(`[DM] Sent order DM to ${item.castName}`);
                } catch (dmError) {
                    console.error(`[DM] Failed for ${item.castName}:`, dmError);
                }
            }
        }

        return {
            ts: threadTs,
            permalink,
            calendarResults,
            calendarDebug,
            conflictDebug,
            isAdditional,
        };
    }
);

// ──────────────────────────────────────
// 2. ステータス変更通知
// ──────────────────────────────────────
export const notifyStatusUpdate = onCall(
    {
        maxInstances: 10,
        secrets: [
            "SLACK_BOT_TOKEN",
            "SLACK_CHANNEL_INTERNAL",
            "GOOGLE_SERVICE_ACCOUNT_KEY",
            "GOOGLE_CALENDAR_ID",
            "NOTION_TOKEN",
        ],
    },
    async (request) => {
        const data = request.data;

        if (!data || !data.castingId || !data.newStatus) {
            throw new HttpsError("invalid-argument", "castingId and newStatus are required");
        }

        const db = admin.firestore();

        // Firestoreからキャスティング情報を取得
        const castingDoc = await db.collection("castings").doc(data.castingId).get();
        if (!castingDoc.exists) {
            throw new HttpsError("not-found", "Casting not found");
        }

        const casting = castingDoc.data()!;
        // フロントエンドから渡された previousStatus を使用
        // （Firestore上のstatusはフロントエンドが先に更新済みのため）
        const oldStatus = data.previousStatus || casting.status || "";
        const slackThreadTs = casting.slackThreadTs || "";

        // Slack通知（スレッド返信）— castings に保存されたチャンネルを優先
        const slackToken = getEnv("SLACK_BOT_TOKEN");
        const slackChannel = resolveSlackChannel(casting);

        if (slackToken && slackChannel && slackThreadTs) {
            const message = buildStatusMessage({
                castName: casting.castName,
                projectName: casting.projectName,
                oldStatus,
                newStatus: data.newStatus,
                cost: data.cost,
                extraMessage: data.extraMessage,
            });

            await postToSlack(slackToken, slackChannel, message, undefined, slackThreadTs);
        }

        // カレンダー更新（内部キャストのみ）
        const serviceAccountKey = getEnv("GOOGLE_SERVICE_ACCOUNT_KEY");
        const calendarId = getEnv("GOOGLE_CALENDAR_ID");

        if (
            serviceAccountKey &&
            calendarId &&
            casting.castType === "内部" &&
            casting.calendarEventId
        ) {
            await handleCalendarStatusChange({
                serviceAccountKey,
                calendarId,
                eventId: casting.calendarEventId,
                castName: casting.castName,
                projectName: casting.projectName,
                newStatus: data.newStatus,
            });
        }

        // Notion同期（OK/決定時）
        if (data.newStatus === "OK" || data.newStatus === "決定") {
            const notionToken = getEnv("NOTION_TOKEN");
            const projectId = casting.projectId;

            if (notionToken && projectId) {
                await syncCastToNotion({
                    notionToken,
                    pageId: projectId,
                    castName: casting.castName,
                    isInternal: casting.castType === "内部",
                    mainSub: casting.mainSub,
                });
            }

            // ── 撮影連絡DB自動追加（外部キャストのみ）──
            if (casting.castType === "外部") {
                try {
                    // 重複チェック
                    const existingContact = await db.collection("shootingContacts")
                        .where("castingId", "==", data.castingId)
                        .limit(1)
                        .get();

                    if (existingContact.empty) {
                        await db.collection("shootingContacts").add({
                            castingId: data.castingId,
                            castName: casting.castName,
                            castType: casting.castType,
                            projectName: casting.projectName,
                            accountName: casting.accountName,
                            roleName: casting.roleName,
                            shootDate: casting.startDate,
                            mainSub: casting.mainSub || "その他",
                            status: "香盤連絡待ち",
                            slackThreadTs: casting.slackThreadTs || "",
                            createdAt: admin.firestore.FieldValue.serverTimestamp(),
                            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
                        });
                        console.log("Added to shootingContacts:", casting.castName);
                    } else {
                        console.log("ShootingContact already exists for:", data.castingId);
                    }
                } catch (e) {
                    console.warn("Failed to add to shootingContacts:", e);
                }
            }
        }

        return { success: true };
    }
);

// ──────────────────────────────────────
// 3. キャスティング削除のクリーンアップ
// ──────────────────────────────────────
export const deleteCastingCleanup = onCall(
    {
        maxInstances: 10,
        secrets: [
            "SLACK_BOT_TOKEN",
            "SLACK_CHANNEL_INTERNAL",
            "GOOGLE_SERVICE_ACCOUNT_KEY",
            "GOOGLE_CALENDAR_ID",
        ],
    },
    async (request) => {
        const data = request.data;

        if (!data || !data.castingId) {
            throw new HttpsError("invalid-argument", "castingId is required");
        }

        const db = admin.firestore();
        const castingDoc = await db.collection("castings").doc(data.castingId).get();

        if (!castingDoc.exists) {
            return { success: true, message: "Casting already deleted" };
        }

        const casting = castingDoc.data()!;

        // カレンダーイベント削除
        const serviceAccountKey = getEnv("GOOGLE_SERVICE_ACCOUNT_KEY");
        const calendarId = getEnv("GOOGLE_CALENDAR_ID");

        if (
            serviceAccountKey &&
            calendarId &&
            casting.castType === "内部" &&
            casting.calendarEventId
        ) {
            await handleCalendarStatusChange({
                serviceAccountKey,
                calendarId,
                eventId: casting.calendarEventId,
                castName: casting.castName,
                projectName: casting.projectName,
                newStatus: "キャンセル", // 削除 = キャンセル扱い
            });
        }

        // Slack通知（スレッドに削除通知）— castings に保存されたチャンネル or permalink から解決
        const slackToken = getEnv("SLACK_BOT_TOKEN");
        const slackChannel = resolveSlackChannel(casting);
        const slackThreadTs = casting.slackThreadTs;

        if (slackToken && slackChannel && slackThreadTs) {
            const text = `🗑️ *${casting.castName}* のキャスティングが削除されました（${casting.projectName}）`;
            await postToSlack(slackToken, slackChannel, text, undefined, slackThreadTs);
        }

        return { success: true };
    }
);

// ──────────────────────────────────────
// 4. オーダー内容変更通知
// ──────────────────────────────────────
export const notifyOrderUpdated = onCall(
    {
        maxInstances: 10,
        secrets: [
            "SLACK_BOT_TOKEN",
            "SLACK_CHANNEL_INTERNAL",
            "GOOGLE_SERVICE_ACCOUNT_KEY",
            "GOOGLE_CALENDAR_ID",
        ],
    },
    async (request) => {
        const data = request.data;

        if (!data || !data.castingId || !data.changes) {
            throw new HttpsError("invalid-argument", "castingId and changes are required");
        }

        const db = admin.firestore();
        const castingRef = db.collection("castings").doc(data.castingId);
        const castingDoc = await castingRef.get();

        if (!castingDoc.exists) {
            throw new HttpsError("not-found", "Casting not found");
        }

        const casting = castingDoc.data()!;
        const changes = data.changes as {
            startDate?: string;
            endDate?: string;
            startTime?: string;
            endTime?: string;
            projectName?: string | { from: string; to: string };
        };

        // 変更前の値を記録 & Firestore更新用オブジェクト構築
        const updateData: Record<string, unknown> = {
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        };
        const changeDetails: Record<string, { from: string; to: string }> = {};

        if (changes.startDate) {
            const oldDate = casting.startDate?.toDate?.();
            const oldStr = oldDate ? oldDate.toISOString().split("T")[0] : "";
            changeDetails.startDate = { from: oldStr || "", to: changes.startDate };
            updateData.startDate = admin.firestore.Timestamp.fromDate(new Date(changes.startDate));
        }
        if (changes.endDate) {
            const oldDate = casting.endDate?.toDate?.();
            const oldStr = oldDate ? oldDate.toISOString().split("T")[0] : "";
            changeDetails.endDate = { from: oldStr || "", to: changes.endDate };
            updateData.endDate = admin.firestore.Timestamp.fromDate(new Date(changes.endDate));
        }
        if (changes.startTime) {
            changeDetails.startTime = { from: casting.startTime || "", to: changes.startTime };
            updateData.startTime = changes.startTime;
        }
        if (changes.endTime) {
            changeDetails.endTime = { from: casting.endTime || "", to: changes.endTime };
            updateData.endTime = changes.endTime;
        }

        // projectName の処理（{from, to} オブジェクト or 文字列に対応）
        let projectNameFrom = "";
        let projectNameTo = "";
        if (changes.projectName) {
            if (typeof changes.projectName === "object" && "from" in changes.projectName && "to" in changes.projectName) {
                projectNameFrom = changes.projectName.from;
                projectNameTo = changes.projectName.to;
            } else if (typeof changes.projectName === "string") {
                projectNameFrom = casting.projectName || "";
                projectNameTo = changes.projectName;
            }
            if (projectNameTo) {
                changeDetails.projectName = { from: projectNameFrom, to: projectNameTo };
                updateData.projectName = projectNameTo;
            }
        }

        // Firestore更新
        await castingRef.update(updateData);

        // ── projectName cascade: castMaster / shootingContacts 更新 ──
        if (projectNameTo && projectNameFrom !== projectNameTo) {
            const castId = casting.castId;
            console.log(`Cascading projectName change for castId=${castId}: "${projectNameFrom}" → "${projectNameTo}"`);

            // castMaster 更新
            try {
                const masterSnap = await db.collection("castMaster")
                    .where("castId", "==", castId)
                    .where("projectName", "==", projectNameFrom)
                    .get();
                const batch1 = db.batch();
                masterSnap.docs.forEach(doc => {
                    batch1.update(doc.ref, {
                        projectName: projectNameTo,
                        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
                    });
                });
                if (!masterSnap.empty) {
                    await batch1.commit();
                    console.log(`Updated ${masterSnap.size} castMaster docs`);
                }
            } catch (e) {
                console.error("castMaster cascade failed:", e);
            }

            // shootingContacts 更新（castingId で検索）
            try {
                const contactSnap = await db.collection("shootingContacts")
                    .where("castingId", "==", data.castingId)
                    .where("projectName", "==", projectNameFrom)
                    .get();
                const batch2 = db.batch();
                contactSnap.docs.forEach(doc => {
                    batch2.update(doc.ref, {
                        projectName: projectNameTo,
                        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
                    });
                });
                if (!contactSnap.empty) {
                    await batch2.commit();
                    console.log(`Updated ${contactSnap.size} shootingContacts docs`);
                }
            } catch (e) {
                console.error("shootingContacts cascade failed:", e);
            }
        }

        // Slack通知（スレッド返信）— castings に保存されたチャンネルを優先
        const slackToken = getEnv("SLACK_BOT_TOKEN");
        const slackChannel = resolveSlackChannel(casting);
        const slackThreadTs = casting.slackThreadTs || "";

        if (slackToken && slackChannel && slackThreadTs) {
            const message = buildOrderUpdateMessage({
                castName: casting.castName,
                projectName: projectNameTo || casting.projectName,
                changes: changeDetails,
            });

            await postToSlack(slackToken, slackChannel, message, undefined, slackThreadTs);
        }

        // カレンダー更新（内部キャストのみ）
        const serviceAccountKey = getEnv("GOOGLE_SERVICE_ACCOUNT_KEY");
        const calendarId = getEnv("GOOGLE_CALENDAR_ID");

        if (
            serviceAccountKey &&
            calendarId &&
            casting.calendarEventId
        ) {
            // 日時変更
            if (changes.startDate || changes.startTime || changes.endTime) {
                const newStartDate = changes.startDate || casting.startDate?.toDate?.()?.toISOString().split("T")[0] || "";
                await updateCalendarEventTime({
                    serviceAccountKey,
                    calendarId,
                    eventId: casting.calendarEventId,
                    startDate: newStartDate,
                    startTime: changes.startTime || casting.startTime,
                    endTime: changes.endTime || casting.endTime,
                });
            }

            // 作品名変更時: カレンダーイベントのタイトル更新
            if (projectNameTo && projectNameFrom !== projectNameTo) {
                try {
                    await updateCalendarEventTitle({
                        serviceAccountKey,
                        calendarId,
                        eventId: casting.calendarEventId,
                        castName: casting.castName,
                        projectName: projectNameTo,
                        isProvisional: ["仮キャスティング", "仮押さえ", "オーダー待ち", "打診中"].includes(casting.status || ""),
                    });
                    console.log("Calendar event title updated for projectName change");
                } catch (e) {
                    console.error("Calendar title update failed:", e);
                }
            }
        }

        return { success: true, changes: changeDetails };
    }
);

/**
 * 次候補昇格時のオーダーDM送信
 * 第1候補がNG/キャンセルになった際に、次 rank の内部キャストへDMを送る
 * フロントエンドの promoteNextRankCandidate() から呼ばれる
 */
export const sendPromotionDm = onCall(
    { secrets: ["SLACK_BOT_TOKEN", "GOOGLE_SERVICE_ACCOUNT_KEY"] },
    async (request) => {
        const { castingId } = request.data as { castingId: string };
        if (!castingId) throw new HttpsError("invalid-argument", "castingId is required");

        const slackToken = process.env.SLACK_BOT_TOKEN;
        if (!slackToken) throw new HttpsError("internal", "SLACK_BOT_TOKEN not set");

        const db = admin.firestore();

        // 1. Casting ドキュメント取得
        const castingDoc = await db.collection("castings").doc(castingId).get();
        if (!castingDoc.exists) throw new HttpsError("not-found", "Casting not found");
        const casting = castingDoc.data()!;

        // 内部キャスト以外はDM不要
        if (casting.castType !== "内部") return { success: true, skipped: true };

        // 2. Cast ドキュメントから slackMentionId を取得
        let slackMentionId = casting.slackMentionId || "";
        if (!slackMentionId && casting.castId) {
            const castDoc = await db.collection("casts").doc(casting.castId).get();
            if (castDoc.exists) {
                slackMentionId = castDoc.data()?.slackMentionId || "";
            }
        }

        if (!slackMentionId) {
            console.warn(`[sendPromotionDm] No slackMentionId for ${casting.castName}`);
            return { success: false, reason: "no_slack_id" };
        }

        // 3. 日程文字列を再構築
        const startDate = casting.startDate?.toDate?.();
        const endDate = casting.endDate?.toDate?.();
        const fmt = (d: Date) =>
            `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, "0")}/${String(d.getDate()).padStart(2, "0")}`;
        const dateRanges: string[] = startDate
            ? [endDate && fmt(startDate) !== fmt(endDate) ? `${fmt(startDate)}~${fmt(endDate)}` : fmt(startDate)]
            : [];

        // 4. DM ブロック構築
        const slackThreadTs = casting.slackThreadTs || "";
        const permalink = casting.slackPermalink || "";
        const dmBlocks = buildCastOrderDmBlocks({
            castName: casting.castName,
            projectName: casting.projectName,
            roleName: casting.roleName || "出演",
            dateRanges,
            accountName: casting.accountName || "",
            castingId,
            slackThreadTs,
            slackChannel: resolveSlackChannel(casting),
            permalink,
        });

        const dmText = `📋 ${dateRanges.join(", ")} 撮影オーダーが来ています（繰り上がり）（${casting.projectName}）`;
        await sendDmToUser(slackToken, slackMentionId, dmText, dmBlocks);
        console.log(`[sendPromotionDm] DM sent to ${casting.castName} (rank ${casting.rank})`);

        return { success: true };
    }
);
