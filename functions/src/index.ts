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
 * 名前のゆれを正規化（空白除去、全角半角統一など）
 */
function normalizeName(name: string): string {
    return name
        .replace(/\s+/g, "")          // 全空白除去
        .replace(/[\u3000]/g, "")    // 全角空白除去
        .toLowerCase();
}

// Slack ユーザー一覧キャッシュ（Cloud Function インスタンス内で使い回す）
let slackUserCache: Array<{ id: string; names: string[] }> | null = null;
let slackUserCacheAt = 0;
const SLACK_USER_CACHE_TTL_MS = 10 * 60 * 1000; // 10分

async function fetchSlackUsersCached(): Promise<Array<{ id: string; names: string[] }>> {
    const now = Date.now();
    if (slackUserCache && now - slackUserCacheAt < SLACK_USER_CACHE_TTL_MS) {
        return slackUserCache;
    }

    const token = getEnv("SLACK_BOT_TOKEN");
    if (!token) return slackUserCache || [];

    const all: Array<{ id: string; names: string[] }> = [];
    let cursor: string | undefined;
    try {
        // Slack users.list は最大1000件/ページ。通常1〜2ページで足りる。
        for (let page = 0; page < 5; page++) {
            const url = "https://slack.com/api/users.list?limit=200" + (cursor ? `&cursor=${encodeURIComponent(cursor)}` : "");
            const res = await fetch(url, {
                headers: { Authorization: `Bearer ${token}` },
            });
            const json = await res.json() as {
                ok: boolean;
                members?: Array<{
                    id: string;
                    deleted?: boolean;
                    is_bot?: boolean;
                    real_name?: string;
                    name?: string;
                    profile?: { real_name?: string; display_name?: string; real_name_normalized?: string; display_name_normalized?: string };
                }>;
                response_metadata?: { next_cursor?: string };
            };
            if (!json.ok || !json.members) break;
            for (const m of json.members) {
                if (m.deleted || m.is_bot) continue;
                const names = [
                    m.real_name,
                    m.name,
                    m.profile?.real_name,
                    m.profile?.display_name,
                    m.profile?.real_name_normalized,
                    m.profile?.display_name_normalized,
                ].filter((s): s is string => !!s);
                if (names.length > 0) {
                    all.push({ id: m.id, names });
                }
            }
            cursor = json.response_metadata?.next_cursor;
            if (!cursor) break;
        }
        slackUserCache = all;
        slackUserCacheAt = now;
        console.log(`[SlackUsers] Cached ${all.length} users`);
    } catch (e) {
        console.warn("[SlackUsers] users.list failed:", e);
    }
    return all;
}

/**
 * 名前からSlack IDを検索するヘルパー
 * casts → admin → Slack users.list の順に検索
 * 名前ゆれ（空白有無等）も吸収
 */
async function lookupSlackIdByName(name: string): Promise<string> {
    if (!name) return "";
    const trimmed = name.trim();
    const normalized = normalizeName(trimmed);
    try {
        const firestore = admin.firestore();
        // castsコレクションから名前で検索
        const castSnap = await firestore.collection("casts")
            .where("name", "==", trimmed)
            .limit(1)
            .get();
        if (!castSnap.empty) {
            const data = castSnap.docs[0]!.data();
            if (data.slackMentionId) return data.slackMentionId;
        }

        // adminsコレクションから名前で検索
        const adminSnap = await firestore.collection("admin")
            .where("name", "==", trimmed)
            .limit(1)
            .get();
        if (!adminSnap.empty) {
            const data = adminSnap.docs[0]!.data();
            if (data.slackMentionId) return data.slackMentionId;
        }

        // フォールバック1: admin コレクション全件をスキャンし正規化一致
        // （admin は数十件想定なので問題なし）
        try {
            const adminAll = await firestore.collection("admin").get();
            for (const doc of adminAll.docs) {
                const d = doc.data();
                const candidates = [d.name, d.displayName, d.slackName].filter((s): s is string => !!s);
                if (candidates.some(c => normalizeName(c) === normalized) && d.slackMentionId) {
                    return d.slackMentionId;
                }
            }
        } catch (e) {
            console.warn(`[lookup] admin scan failed for ${trimmed}:`, e);
        }

        // フォールバック2: Slack users.list で名前検索
        const users = await fetchSlackUsersCached();
        // 厳密一致（正規化後）
        for (const u of users) {
            if (u.names.some(n => normalizeName(n) === normalized)) {
                return u.id;
            }
        }
        // 部分一致（正規化後）— 苗字のみ等のショートネーム対策
        if (normalized.length >= 2) {
            for (const u of users) {
                if (u.names.some(n => {
                    const nn = normalizeName(n);
                    return nn.includes(normalized) || normalized.includes(nn);
                })) {
                    return u.id;
                }
            }
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

        // ── 追加オーダー判定 ──
        // 優先順位:
        // 1. クライアントから replyToThreadTs が指定 → そのスレッドに返信
        // 2. forceNewThread=true → 新規スレッド
        // 3. Firestore の slackThreadTs で自動判定
        // 4. slackThreadTs が空でも projectId のキャスティングが存在 → Slack チャンネル検索でリカバリ
        let existingThreadTs = "";
        let existingPermalink = "";
        let resolvedThreadChannel = "";

        if (data.replyToThreadTs) {
            existingThreadTs = data.replyToThreadTs;
            // Firestoreからスレッドのチャンネルを取得
            if (data.projectId) {
                const threadSnap = await db.collection("castings")
                    .where("projectId", "==", data.projectId)
                    .where("slackThreadTs", "==", data.replyToThreadTs)
                    .limit(1)
                    .get();
                if (!threadSnap.empty) {
                    const threadData = threadSnap.docs[0].data();
                    resolvedThreadChannel = resolveSlackChannel(threadData);
                    existingPermalink = threadData.slackPermalink || "";
                }
            }
        } else if (data.projectId && !data.forceNewThread) {
            // Firestore から slackThreadTs を探す
            // ⚠️ キャンセル/NG/削除済みのキャスティングは別スレッドへ誤投稿の原因になるため除外
            //    （旧スレッドが残ったまま再キャスティングするケースで、新オーダーが旧スレッドに飛ぶバグ対策）
            const existingSnap = await db.collection("castings")
                .where("projectId", "==", data.projectId)
                .get();

            // 有効なキャスティング（NG・キャンセル・削除フラグ以外）に絞って slackThreadTs を採用
            const isActive = (d: FirebaseFirestore.DocumentData) => {
                if (d.deleted === true) return false;
                if (d.status === "キャンセル" || d.status === "NG") return false;
                return true;
            };
            const docWithThread = existingSnap.docs.find(d => isActive(d.data()) && d.data().slackThreadTs);
            if (docWithThread) {
                const existingData = docWithThread.data();
                existingThreadTs = existingData.slackThreadTs || "";
                existingPermalink = existingData.slackPermalink || "";
                resolvedThreadChannel = resolveSlackChannel(existingData);
            } else if (existingSnap.docs.some(d => isActive(d.data()))) {
                // 有効なキャスティングは存在するが slackThreadTs が空 → ts 保存失敗
                // → Slack チャンネル履歴から Notion URL で元スレッドを検索してリカバリ
                // ⚠️ ただし、削除/キャンセル済みキャスティングに紐づいたスレッドはブラックリスト化（誤投稿防止）
                const blacklistedTs = new Set<string>(
                    existingSnap.docs
                        .filter(d => !isActive(d.data()))
                        .map(d => d.data().slackThreadTs)
                        .filter((ts): ts is string => !!ts)
                );
                console.log("[Recovery] slackThreadTs empty for projectId:", data.projectId, "— searching Slack channel...", "blacklist:", Array.from(blacklistedTs));
                const notionUrl = `notion.so/${data.projectId.replace(/-/g, "")}`;
                try {
                    let cursor: string | undefined;
                    let found = false;
                    // 最大200件（2ページ）まで遡って検索
                    for (let page = 0; page < 2 && !found; page++) {
                        const historyResult = await fetch("https://slack.com/api/conversations.history", {
                            method: "POST",
                            headers: {
                                "Authorization": `Bearer ${slackToken}`,
                                "Content-Type": "application/json",
                            },
                            body: JSON.stringify({
                                channel: slackChannel,
                                limit: 100,
                                ...(cursor ? { cursor } : {}),
                            }),
                        });
                        const historyData = await historyResult.json() as {
                            ok: boolean;
                            messages?: Array<{ ts: string; text?: string; permalink?: string }>;
                            response_metadata?: { next_cursor?: string };
                        };
                        if (!historyData.ok || !historyData.messages) break;

                        for (const msg of historyData.messages) {
                            if (msg.text && msg.text.includes(notionUrl)) {
                                // 削除/キャンセル済みキャスティングと紐づいた古いスレッドはスキップ
                                if (blacklistedTs.has(msg.ts)) {
                                    console.log("[Recovery] Skipping blacklisted (deleted casting) thread ts:", msg.ts);
                                    continue;
                                }
                                // 親メッセージ（スレッドの最初のメッセージ）のみ対象
                                existingThreadTs = msg.ts;
                                console.log("[Recovery] Found thread ts from Slack:", existingThreadTs);
                                found = true;

                                // permalink 取得
                                try {
                                    const plResp = await fetch("https://slack.com/api/chat.getPermalink", {
                                        method: "POST",
                                        headers: {
                                            "Authorization": `Bearer ${slackToken}`,
                                            "Content-Type": "application/json",
                                        },
                                        body: JSON.stringify({ channel: slackChannel, message_ts: existingThreadTs }),
                                    });
                                    const plData = await plResp.json() as { ok: boolean; permalink?: string };
                                    if (plData.ok && plData.permalink) {
                                        existingPermalink = plData.permalink;
                                    }
                                } catch { /* ignore */ }

                                // Firestore の該当キャスティング（有効なもののみ）に書き戻し
                                // 削除/キャンセル済みには書き戻さない（誤投稿防止）
                                const batch = db.batch();
                                for (const d of existingSnap.docs) {
                                    if (!d.data().slackThreadTs && isActive(d.data())) {
                                        batch.update(d.ref, {
                                            slackThreadTs: existingThreadTs,
                                            slackPermalink: existingPermalink,
                                            slackChannel: slackChannel,
                                        });
                                    }
                                }
                                await batch.commit();
                                console.log("[Recovery] Updated", existingSnap.docs.length, "casting docs with recovered ts");
                                break;
                            }
                        }
                        cursor = historyData.response_metadata?.next_cursor || undefined;
                        if (!cursor) break;
                    }
                    if (!found) {
                        console.warn("[Recovery] Could not find thread in Slack for projectId:", data.projectId);
                    }
                } catch (recoverErr) {
                    console.error("[Recovery] Slack channel search failed:", recoverErr);
                }
            }
        }

        const isAdditional = !!existingThreadTs;
        if (isAdditional && resolvedThreadChannel) {
            console.log("Override channel for thread reply:", slackChannel, "→", resolvedThreadChannel);
        }

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
            if (data.shootingData.producer) {
                // producer can contain multiple names separated by comma/、
                const producers = data.shootingData.producer.split(/[,、]/).map((p: string) => p.trim()).filter((p: string) => p);
                const producerMentions: string[] = [];
                for (const name of producers) {
                    const slackId = await lookupSlackIdByName(name);
                    producerMentions.push(slackId ? `<@${slackId}>` : name);
                }
                if (producerMentions.length > 0) {
                    ccParts.push(`P: ${producerMentions.join(" ")}`);
                }
            }
            if (data.shootingData.costume) {
                const costumes = data.shootingData.costume.split(/[,、]/).map((p: string) => p.trim()).filter((p: string) => p);
                const costumeMentions: string[] = [];
                for (const name of costumes) {
                    const slackId = await lookupSlackIdByName(name);
                    costumeMentions.push(slackId ? `<@${slackId}>` : name);
                }
                if (costumeMentions.length > 0) {
                    ccParts.push(`衣装: ${costumeMentions.join(" ")}`);
                }
            }
            ccString = ccParts.join(" / ");
        }

        // ── オーダー主のSlack IDを解決 ──
        // ログインユーザーのメールアドレスからSlack IDを検索
        let orderCreatorMention = "";
        let orderCreatorName = data.ccMention || ""; // フロント側で渡されたユーザー名をフォールバック
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
                    if (castData.name) {
                        orderCreatorName = castData.name;
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
                        if (adminData.name) {
                            orderCreatorName = adminData.name;
                        }
                    }
                }

                console.log("Order creator mention resolved:", orderCreatorMention, "name:", orderCreatorName, "from email:", userEmail);
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
                ordererName: orderCreatorMention || orderCreatorName || undefined,
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
                ordererName: orderCreatorMention || orderCreatorName || undefined,
            });
        }

        // ── Slack送信 ──
        // PDF添付がある場合: Slack SDK でアップロード（V1と同じ方式）
        // 追加オーダー時は既存スレッドに返信（スレッドの実チャンネルを使用）
        const threadTsForReply = isAdditional ? existingThreadTs : undefined;
        const postChannel = (isAdditional && resolvedThreadChannel) ? resolvedThreadChannel : slackChannel;
        console.log("Slack send:", {
            postChannel,
            threadTsForReply: threadTsForReply || "(none)",
            isAdditional,
            hasPdfBase64: !!data.pdfBase64,
            pdfBase64Length: data.pdfBase64?.length || 0,
            pdfFileName: data.pdfFileName || "(none)",
        });

        let slackResult: { ok: boolean; ts?: string; permalink?: string } = { ok: false };
        try {
            slackResult = data.pdfBase64 && data.pdfFileName
                ? await uploadFileToSlack(
                    slackToken,
                    postChannel,
                    message,
                    data.pdfBase64,
                    data.pdfFileName,
                    threadTsForReply
                )
                : await postToSlack(
                    slackToken,
                    postChannel,
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
        if (castingIds.length > 0) {
            // ⚠️ Slack の ts が取れなかった場合でも、カレンダー ID 等の他フィールドは書き戻す
            //    （旧コードでは threadTs が空だと全フィールドスキップで、カレンダーが Google には作られても
            //     Firestore に ID が残らないバグがあった）
            if (!threadTs) {
                console.warn("[Writeback] threadTs is empty — slack fields will not be written, but calendar/etc. will still be saved");
            }
            const batch = db.batch();
            const items = data.items as Array<{
                castName: string;
                castType: string;
                selectedDates?: string[];
            }>;
            let updateCount = 0;

            for (let i = 0; i < castingIds.length; i++) {
                const updateData: Record<string, string> = {};

                // Slack 情報は ts が取れた時のみ書き戻す
                if (threadTs) {
                    updateData.slackThreadTs = threadTs;
                    updateData.slackPermalink = permalink;
                    updateData.slackChannel = postChannel;
                }

                // カレンダーイベントIDをマッチして書き戻す（ts の有無に依存しない）
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

                if (Object.keys(updateData).length > 0) {
                    batch.update(db.collection("castings").doc(castingIds[i]!), updateData);
                    updateCount++;
                }
            }

            if (updateCount > 0) {
                await batch.commit();
                console.log(`[Writeback] Updated ${updateCount} castings (slackTs=${threadTs ? "yes" : "NO"})`);
            }
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
                        slackChannel: postChannel,
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
        let slackThreadTs = casting.slackThreadTs || "";

        // Slack通知（スレッド返信）— castings に保存されたチャンネルを優先
        const slackToken = getEnv("SLACK_BOT_TOKEN");
        let slackChannel = resolveSlackChannel(casting);

        // ── slackThreadTs が空のときのリカバリ ──
        // 同じ projectId の他キャスティングから ts を借りる、
        // それでも無ければ Slack history を Notion URL で検索
        if (!slackThreadTs && casting.projectId && slackToken && slackChannel) {
            try {
                const sibSnap = await db.collection("castings")
                    .where("projectId", "==", casting.projectId)
                    .get();
                const sibling = sibSnap.docs.find(d => {
                    const dd = d.data();
                    return dd.slackThreadTs && dd.deleted !== true && dd.status !== "キャンセル" && dd.status !== "NG";
                });
                if (sibling) {
                    const sd = sibling.data();
                    slackThreadTs = sd.slackThreadTs;
                    if (sd.slackChannel) slackChannel = sd.slackChannel;
                    console.log("[StatusRecovery] Borrowed thread ts from sibling:", slackThreadTs);
                    // 自身にも書き戻し
                    await castingDoc.ref.update({
                        slackThreadTs,
                        slackPermalink: sd.slackPermalink || casting.slackPermalink || "",
                        slackChannel: sd.slackChannel || slackChannel,
                    }).catch(e => console.warn("[StatusRecovery] writeback failed:", e));
                } else {
                    // Slack history から Notion URL で検索
                    console.log("[StatusRecovery] No sibling thread, searching Slack history...");
                    const notionUrlFrag = `notion.so/${(casting.projectId as string).replace(/-/g, "")}`;
                    // 削除/キャンセル済みキャスティングに紐づくスレッドはブラックリスト化
                    const blacklistedTs = new Set<string>(
                        sibSnap.docs
                            .filter(d => {
                                const dd = d.data();
                                return dd.deleted === true || dd.status === "キャンセル" || dd.status === "NG";
                            })
                            .map(d => d.data().slackThreadTs)
                            .filter((ts): ts is string => !!ts)
                    );
                    let cursor: string | undefined;
                    for (let page = 0; page < 2 && !slackThreadTs; page++) {
                        const histRes = await fetch("https://slack.com/api/conversations.history", {
                            method: "POST",
                            headers: { Authorization: `Bearer ${slackToken}`, "Content-Type": "application/json" },
                            body: JSON.stringify({ channel: slackChannel, limit: 100, ...(cursor ? { cursor } : {}) }),
                        });
                        const hd = await histRes.json() as {
                            ok: boolean;
                            messages?: Array<{ ts: string; text?: string }>;
                            response_metadata?: { next_cursor?: string };
                        };
                        if (!hd.ok || !hd.messages) break;
                        const found = hd.messages.find(m => m.text && m.text.includes(notionUrlFrag) && !blacklistedTs.has(m.ts));
                        if (found) {
                            slackThreadTs = found.ts;
                            console.log("[StatusRecovery] Found ts via Slack history:", slackThreadTs);
                            await castingDoc.ref.update({
                                slackThreadTs,
                                slackChannel,
                            }).catch(e => console.warn("[StatusRecovery] writeback failed:", e));
                            break;
                        }
                        cursor = hd.response_metadata?.next_cursor;
                        if (!cursor) break;
                    }
                }
            } catch (e) {
                console.warn("[StatusRecovery] Failed:", e);
            }
        }

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
// 2b. 一括ステータス変更通知（まとめてSlack送信）
// ──────────────────────────────────────
export const notifyBulkStatusUpdate = onCall(
    {
        maxInstances: 10,
        secrets: [
            "SLACK_BOT_TOKEN",
            "SLACK_CHANNEL_INTERNAL",
        ],
    },
    async (request) => {
        const data = request.data;
        if (!data || !data.groups || !Array.isArray(data.groups)) {
            throw new HttpsError("invalid-argument", "groups array is required");
        }

        const slackToken = getEnv("SLACK_BOT_TOKEN");
        const db = admin.firestore();

        for (const group of data.groups) {
            const { slackThreadTs, newStatus, castings: castingItems } = group;
            if (!slackThreadTs || !castingItems || castingItems.length === 0) continue;

            // スレッドのチャンネルを最初のキャスティングから取得
            let slackChannel = "";
            try {
                const firstCastingDoc = await db.collection("castings").doc(castingItems[0].castingId).get();
                if (firstCastingDoc.exists) {
                    const castingData = firstCastingDoc.data()!;
                    slackChannel = resolveSlackChannel(castingData);
                }
            } catch (e) {
                console.warn("Failed to resolve channel for bulk update:", e);
            }

            if (!slackChannel || !slackToken) continue;

            // まとめメッセージを構築
            const castNames = castingItems.map((c: { castName: string }) => c.castName).join("、");
            const message = `📋 *一括ステータス更新*\n` +
                `${castingItems.length}件のキャスティングを \`${newStatus}\` に変更しました\n` +
                `対象: ${castNames}`;

            await postToSlack(slackToken, slackChannel, message, undefined, slackThreadTs);
        }

        return { success: true };
    }
);

// ──────────────────────────────────────
// 2c. カレンダーイベント再生成
// ──────────────────────────────────────
// 過去のバグやエラーで calendarEventId が空になっているキャスティング向けに、
// 手動でカレンダーイベントを再作成して ID を書き戻す。
export const regenerateCalendarEvent = onCall(
    {
        maxInstances: 10,
        secrets: [
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
            throw new HttpsError("not-found", "Casting not found");
        }
        const casting = castingDoc.data()!;

        if (casting.castType !== "内部") {
            throw new HttpsError("failed-precondition", "Calendar event is only for internal casts");
        }
        if (casting.calendarEventId) {
            return { success: false, message: "calendarEventId already exists", eventId: casting.calendarEventId };
        }

        const serviceAccountKey = getEnv("GOOGLE_SERVICE_ACCOUNT_KEY");
        const calendarId = getEnv("GOOGLE_CALENDAR_ID");
        if (!serviceAccountKey || !calendarId) {
            throw new HttpsError("failed-precondition", "Calendar credentials not configured");
        }

        // キャストのメールアドレス
        let castEmail = "";
        try {
            if (casting.castId) {
                const castDoc = await db.collection("casts").doc(casting.castId).get();
                if (castDoc.exists) castEmail = castDoc.data()?.email || "";
            }
        } catch (e) {
            console.warn("[regenerateCalendar] castEmail lookup failed:", e);
        }

        // startDate を YYYY-MM-DD に
        let startDateStr = "";
        if (casting.startDate) {
            const d = casting.startDate.toDate ? casting.startDate.toDate() : new Date(casting.startDate);
            const y = d.getFullYear();
            const m = String(d.getMonth() + 1).padStart(2, "0");
            const dd = String(d.getDate()).padStart(2, "0");
            startDateStr = `${y}-${m}-${dd}`;
        }
        if (!startDateStr) {
            throw new HttpsError("failed-precondition", "Casting has no startDate");
        }

        // 撮影情報から時間を取得（あれば）
        let startTime: string | undefined;
        let endTime: string | undefined;
        if (casting.projectId) {
            try {
                const shootSnap = await db.collection("shootings")
                    .where("notionPageId", "==", casting.projectId)
                    .limit(1)
                    .get();
                if (!shootSnap.empty) {
                    const sd = shootSnap.docs[0]!.data();
                    startTime = sd.startTime || undefined;
                    endTime = sd.endTime || undefined;
                }
            } catch (e) {
                console.warn("[regenerateCalendar] shootings lookup failed:", e);
            }
        }

        const isDecided = casting.status === "決定";
        const status = casting.status || "仮キャスティング";

        const eventId = await createCalendarEvent({
            serviceAccountKey,
            calendarId,
            castName: casting.castName || "",
            projectName: casting.projectName || "",
            accountName: casting.accountName || "",
            roleName: casting.roleName || "出演",
            rank: String(casting.rank || ""),
            mainSub: casting.mainSub || "その他",
            castingId: casting.castId || "",
            castEmail: castEmail || undefined,
            status,
            startDate: startDateStr,
            startTime,
            endTime,
            isProvisional: !isDecided,
        });

        if (!eventId) {
            throw new HttpsError("internal", "Calendar creation returned no eventId");
        }

        await castingDoc.ref.update({ calendarEventId: eventId });
        console.log(`[regenerateCalendar] Created event ${eventId} for casting ${data.castingId}`);

        return { success: true, eventId };
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

        // Slack通知（スレッドに削除通知）— skipSlackNotify フラグで制御
        if (!data.skipSlackNotify) {
            const slackToken = getEnv("SLACK_BOT_TOKEN");
            const slackChannel = resolveSlackChannel(casting);
            const slackThreadTs = casting.slackThreadTs;

            if (slackToken && slackChannel && slackThreadTs) {
                const text = `🗑️ *${casting.castName}* のキャスティングが削除されました（${casting.projectName}）`;
                await postToSlack(slackToken, slackChannel, text, undefined, slackThreadTs);
            }
        } else {
            console.log("Slack notification skipped for deletion:", data.castingId);
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
