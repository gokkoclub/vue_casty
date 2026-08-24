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
import { addAttendeeViaGas } from "./gasCalendar";
import { syncCastToNotion, createNotionCastPage } from "./notion";
import { buildShootId, getSlackPermalink } from "./automation/_helpers";

// Re-export new Cloud Functions
export { getShootingDetails, syncShootingDetailsToContacts } from "./shootingDetails";
export { syncDriveLinksToContacts } from "./driveSync";
export { scheduledSyncOffshotFileCounts, syncOffshotFileCounts, scheduledRemindOffshotUnfilled } from "./syncOffshotFileCounts";
// Sam 経由の同期は Notion 直接同期 (syncFromNotion) に移行済み。手動 onCall と移行ユーティリティは残し、cron は廃止。
export { syncScheduleFromSam, consolidateShootingDuplicates, backfillCastingProjectName } from "./syncFromSam";
export { reassignCastingThread } from "./reassignCastingThread";
export { syncFromNotion, scheduledSyncFromNotion } from "./syncFromNotion";
// CF 直接同期に統一済み。GAS の syncCasts は停止する想定。
export { syncCastsFromNotion, scheduledSyncCastsFromNotion } from "./syncCastsFromNotion";
export { handleSlackInteraction } from "./slackInteraction";

// Automation (香盤SS submissions → 各種ディスパッチ)
export { dispatchShootingSubmission } from "./automation/dispatchShootingSubmission";
export { onShootingEventCreate } from "./automation/onShootingEventCreate";
export { sendSlackOffshot } from "./automation/sendSlackOffshot";
export { retrySlackThreadLink } from "./automation/retrySlackThreadLink";
import { scheduleSlackThreadLinkRetry } from "./automation/retrySlackThreadLink";
export { retryCalendarAttendee } from "./automation/retryCalendarAttendee";

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
/**
 * 複数人名の文字列を配列に分割する。
 *   対応セパレータ: , 、 ， / ／ ・ 改行 タブ
 *   想定入力: "田中太郎, 鈴木花子" / "田中、鈴木" / "田中／鈴木" / "田中・鈴木"
 */
function splitNameList(input: string): string[] {
    return input
        .split(/[,、，/／・\n\t]/)
        .map(s => s.trim())
        .filter(s => s.length > 0);
}

function normalizeName(name: string): string {
    return name
        .replace(/\s+/g, "")          // 全空白除去
        .replace(/[\u3000]/g, "")    // 全角空白除去
        // 末尾の敬称を除去: 様/さん/殿/氏/ちゃん/君/くん/さま
        //   ※「山田様太郎」のように途中に含まれる敬称は触らない（誤一致防止）
        .replace(/(様|さま|さん|殿|氏|ちゃん|君|くん)$/u, "")
        .toLowerCase();
}

// Slack ユーザー一覧キャッシュ（Cloud Function インスタンス内で使い回す）
let slackUserCache: Array<{ id: string; names: string[] }> | null = null;
let slackUserCacheAt = 0;
const SLACK_USER_CACHE_TTL_MS = 10 * 60 * 1000; // 10分

// staffMentions コレクションのキャッシュ（Cloud Function インスタンス内で使い回す）
//   「キャストでも admin でもないスタッフ（CD/FD/P/衣装など）」の Slack ID マップ。
//   ManagementView の「スタッフメンション」タブから管理される。
let staffMentionsCache: Array<{ id: string; slackMentionId: string; names: string[] }> | null = null;
let staffMentionsCacheAt = 0;
const STAFF_MENTIONS_CACHE_TTL_MS = 5 * 60 * 1000; // 5分

async function fetchStaffMentionsCached(): Promise<Array<{ id: string; slackMentionId: string; names: string[] }>> {
    const now = Date.now();
    if (staffMentionsCache && now - staffMentionsCacheAt < STAFF_MENTIONS_CACHE_TTL_MS) {
        return staffMentionsCache;
    }
    try {
        const firestore = admin.firestore();
        const snap = await firestore.collection("staffMentions").get();
        const all: Array<{ id: string; slackMentionId: string; names: string[] }> = [];
        for (const doc of snap.docs) {
            const d = doc.data();
            if (d.active === false) continue;
            if (!d.slackMentionId) continue;
            const names = [d.name, ...(Array.isArray(d.aliases) ? d.aliases : [])]
                .filter((s): s is string => !!s);
            if (names.length === 0) continue;
            all.push({ id: doc.id, slackMentionId: d.slackMentionId, names });
        }
        staffMentionsCache = all;
        staffMentionsCacheAt = now;
        console.log(`[StaffMentions] Cached ${all.length} entries`);
        return all;
    } catch (e) {
        console.warn("[StaffMentions] fetch failed:", e);
        return staffMentionsCache || [];
    }
}

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
 *   検索順: casts → admin → staffMentions → Slack users.list
 *   名前ゆれ（空白有無・末尾敬称等）も吸収
 *
 *   staffMentions は「キャストでも admin でもないスタッフ」用の専用DB。
 *   ManagementView の「スタッフメンション」タブで管理され、
 *   本名 + aliases[] の配列で複数のゆらぎを登録できる。
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

        // フォールバック2: staffMentions（専用DB）を全件キャッシュから正規化一致
        const staff = await fetchStaffMentionsCached();
        // 厳密一致（正規化後）
        for (const s of staff) {
            if (s.names.some(n => normalizeName(n) === normalized)) {
                return s.slackMentionId;
            }
        }
        // 部分一致（正規化後）
        if (normalized.length >= 2) {
            for (const s of staff) {
                if (s.names.some(n => {
                    const nn = normalizeName(n);
                    return nn.includes(normalized) || normalized.includes(nn);
                })) {
                    return s.slackMentionId;
                }
            }
        }

        // フォールバック3: Slack users.list で名前検索
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

/**
 * オーダー本文に含まれる一意トークン（撮影ID or castingId）から、対応する Slack
 * 親メッセージ(スレッド)を特定する。
 * オーダー文には必ず `撮影ID SH-...` と `casting <id>, ...` が記載されるため、
 * トークンを含むメッセージ = そのオーダーのスレッド、と一意に確定できる。
 * これを紐付けの唯一の根拠とする（projectId/日付/Notion URL/本文一致などの推測はしない）。
 * 優先順: 撮影ID（撮影単位で安定・誤リンクが伝播しない）> castingId。
 */
async function findThreadTsByTokens(
    slackToken: string,
    channel: string,
    tokens: string[],
    maxPages = 5,
): Promise<{ ts: string; permalink: string } | null> {
    const ids = (tokens || []).filter(Boolean);
    if (!slackToken || !channel || ids.length === 0) return null;
    let cursor: string | undefined;
    for (let page = 0; page < maxPages; page++) {
        const res = await fetch("https://slack.com/api/conversations.history", {
            method: "POST",
            headers: { Authorization: `Bearer ${slackToken}`, "Content-Type": "application/json" },
            body: JSON.stringify({ channel, limit: 100, ...(cursor ? { cursor } : {}) }),
        });
        const data = await res.json() as {
            ok: boolean;
            messages?: Array<{ ts: string; text?: string }>;
            response_metadata?: { next_cursor?: string };
        };
        if (!data.ok || !data.messages) break;
        const hit = data.messages.find(m => m.text && ids.some(id => m.text!.includes(id)));
        if (hit) {
            const permalink = await getSlackPermalink(slackToken, channel, hit.ts);
            return { ts: hit.ts, permalink };
        }
        cursor = data.response_metadata?.next_cursor;
        if (!cursor) break;
    }
    return null;
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
            "GAS_INVITE_WEBHOOK_URL",
            "GAS_INVITE_SHARED_SECRET",
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

        // スレッドは「作品 + 撮影日」単位で紐付ける（同じ作品でも別日のオーダーは別スレッド）。
        // 新オーダーの撮影日セット（YYYY-MM-DD）を dateRanges から作る。
        const orderDateSet = new Set<string>();
        for (const dr of (data.dateRanges || []) as string[]) {
            for (const part of String(dr).split("~")) {
                const ymd = part.trim().replace(/\//g, "-").slice(0, 10);
                if (/^\d{4}-\d{2}-\d{2}$/.test(ymd)) orderDateSet.add(ymd);
            }
        }
        // Timestamp → YYYY-MM-DD（既存コードと同じく toISOString 基準）
        const tsToYmd = (ts: FirebaseFirestore.Timestamp | undefined): string => {
            try { return ts?.toDate?.().toISOString().slice(0, 10) || ""; } catch { return ""; }
        };
        // この日付が新オーダーの撮影日と一致するか（日付不明時は従来通り許可）
        const dateMatches = (ymd: string): boolean => orderDateSet.size === 0 || !ymd || orderDateSet.has(ymd);

        // 撮影ID（作品+撮影日で一意・決定的）。オーダー文の先頭に記載し、スレッド検出の第一根拠にする。
        const shootIds: string[] = data.projectId
            ? [...orderDateSet].sort().map((ymd) => buildShootId(data.projectId, ymd)).filter(Boolean)
            : [];

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
            // ── 追加オーダーのスレッド解決: 撮影ID → castingId の2段検索 ──
            // 1) 撮影ID（作品+撮影日で一意・オーダー文の先頭に必ず記載）を含むメッセージ
            // 2) 同じ撮影のアクティブ兄弟 casting の castingId を含むメッセージ（撮影ID導入前の互換）
            // ⚠️ shooting.slackThreadTs / Notion URL / 本文一致による推測は誤リンクの原因だったため廃止。
            const isActive = (d: FirebaseFirestore.DocumentData) => {
                if (d.deleted === true) return false;
                if (d.status === "キャンセル" || d.status === "NG" || d.status === "削除済み") return false;
                return true;
            };
            const sibSnap = await db.collection("castings")
                .where("projectId", "==", data.projectId)
                .get();
            // 撮影日一致のアクティブ兄弟の castingId（= doc id）
            const siblingIds = sibSnap.docs
                .filter(d => isActive(d.data()) && dateMatches(tsToYmd(d.data().startDate)))
                .map(d => d.id);

            const found = (await findThreadTsByTokens(slackToken, slackChannel, shootIds))
                || (await findThreadTsByTokens(slackToken, slackChannel, siblingIds));
            if (found) {
                existingThreadTs = found.ts;
                existingPermalink = found.permalink;
                resolvedThreadChannel = slackChannel;
                console.log("[Additional order] thread located by shootId/castingId:", existingThreadTs);
                // まだ ts が無いアクティブ兄弟にも書き戻す（キャッシュ）
                const batch = db.batch();
                let wb = 0;
                for (const d of sibSnap.docs) {
                    if (isActive(d.data()) && dateMatches(tsToYmd(d.data().startDate)) && !d.data().slackThreadTs) {
                        batch.update(d.ref, { slackThreadTs: existingThreadTs, slackPermalink: existingPermalink, slackChannel });
                        wb++;
                    }
                }
                if (wb > 0) await batch.commit();
            } else {
                // フォールバック: 過去に castingId で確定済みの兄弟キャッシュ(slackThreadTs)
                const docWithThread = sibSnap.docs.find(d => isActive(d.data()) && d.data().slackThreadTs && dateMatches(tsToYmd(d.data().startDate)));
                if (docWithThread) {
                    const dd = docWithThread.data();
                    existingThreadTs = dd.slackThreadTs || "";
                    existingPermalink = dd.slackPermalink || "";
                    resolvedThreadChannel = resolveSlackChannel(dd);
                    console.log("[Additional order] thread from sibling cache:", existingThreadTs);
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
                // producer は複数人可。カンマ/読点/中黒/スラッシュ/改行など多様な区切りを受け付ける
                const producers = splitNameList(data.shootingData.producer);
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
                const costumes = splitNameList(data.shootingData.costume);
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
                castingIds: data.castingIds || [],
                shootIds,
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
                castingIds: data.castingIds || [],
                shootIds,
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
                castingIds: data.castingIds || [],
                shootIds,
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
                    threadTsForReply,
                    data.castingIds || []
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
        const calendarResults: Record<string, { eventId: string; castEmail: string; attendeePending: boolean; attendeeError?: string }> = {};
        const gasWebhookUrl = getEnv("GAS_INVITE_WEBHOOK_URL");
        const gasSharedSecret = getEnv("GAS_INVITE_SHARED_SECRET");
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
                // data.castingIds はフロントで items × itemDates の順に生成されているため、
                // ここでも同じ順序で回して global index から対応する castings ドキュメントIDを引く。
                // （内部キャストのみカレンダーを作るが、index は全アイテム分進めないと castingIds と揃わない）
                const itemsAll = (data.items || []) as Array<{
                    castName: string;
                    castId: string;
                    projectName: string;
                    castType: string;
                    roleName?: string;
                    rank?: string;
                    mainSub?: string;
                    selectedDates?: string[];
                }>;
                const castingIdsForCalendar: string[] = data.castingIds || [];

                const internalCount = itemsAll.filter(it => it.castType === "内部").length;
                console.log("Calendar: internalItems count:", internalCount);
                console.log("Calendar: dateRanges:", data.dateRanges);
                calendarDebug.internalItemsCount = internalCount;

                // castId -> email キャッシュ
                const emailCache = new Map<string, string>();

                // 外部案件のときは config/externalEmails の連携メールも各イベントに招待する
                let externalEmails: string[] = [];
                if (orderMode === "external") {
                    try {
                        const cfgDoc = await db.doc("config/externalEmails").get();
                        const emails = cfgDoc.exists ? cfgDoc.data()?.emails : undefined;
                        if (Array.isArray(emails)) {
                            externalEmails = emails.filter((e): e is string => typeof e === "string" && e.includes("@"));
                        }
                        console.log(`Calendar: externalEmails for 外部案件:`, externalEmails);
                    } catch (e) {
                        console.warn("Failed to load config/externalEmails:", e);
                    }
                }

                let calGlobalIdx = 0;
                for (const item of itemsAll) {
                    const itemDates = item.selectedDates && item.selectedDates.length > 0
                        ? item.selectedDates
                        : (data.dateRanges || []);

                    // 内部キャスト以外も globalIdx は進める必要がある
                    if (item.castType !== "内部") {
                        calGlobalIdx += itemDates.length;
                        continue;
                    }

                    // キャストのメールアドレス（per-cast キャッシュ）
                    let castEmail = emailCache.get(item.castId) || "";
                    if (!emailCache.has(item.castId)) {
                        try {
                            const castDoc = await db.collection("casts").doc(item.castId).get();
                            if (castDoc.exists) castEmail = castDoc.data()?.email || "";
                        } catch (e) {
                            console.warn(`Failed to get email for cast ${item.castId}:`, e);
                        }
                        emailCache.set(item.castId, castEmail);
                        console.log(`Calendar: castEmail for ${item.castName}:`, castEmail || "(none)");
                    }

                    for (const dateRange of itemDates) {
                        const castingDocId = castingIdsForCalendar[calGlobalIdx] || "";
                        calGlobalIdx++;

                        const [startDate] = dateRange.includes("~")
                            ? dateRange.split("~").map((s: string) => s.trim())
                            : [dateRange];

                        // Calendar API requires YYYY-MM-DD format
                        const rawDate = startDate || dateRange;
                        const calendarDate = rawDate.replace(/\//g, "-");
                        console.log("Calendar date:", rawDate, "→", calendarDate, "castingId:", castingDocId);

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
                                castingId: castingDocId,
                                castEmail: castEmail || undefined,
                                status: "仮キャスティング",
                                startDate: calendarDate,
                                startTime: data.startTime || undefined,
                                endTime: data.endTime || undefined,
                                isProvisional: true,
                            });

                            if (eventId && castingDocId) {
                                // GAS 経由で attendee 追加（フロント OAuth PATCH の置き換え）
                                let attendeePending = false;
                                let attendeeError: string | undefined;
                                if (castEmail) {
                                    const gasRes = await addAttendeeViaGas({
                                        webhookUrl: gasWebhookUrl,
                                        secret: gasSharedSecret,
                                        calendarId,
                                        eventId,
                                        attendeeEmail: castEmail,
                                    });
                                    if (!gasRes.ok) {
                                        attendeePending = true;
                                        attendeeError = gasRes.error || "unknown";
                                        console.warn(`[GAS invite] failed for ${item.castName} (${castEmail}): ${attendeeError}`);
                                    } else {
                                        console.log(`[GAS invite] ok for ${item.castName} (${castEmail})${gasRes.skipped ? " skipped=" + gasRes.skipped : ""}`);
                                    }
                                } else {
                                    console.log(`[GAS invite] skipped: no castEmail for ${item.castName}`);
                                }

                                // 外部案件: 連携メール(externalEmails)も同じイベントに招待
                                for (const extEmail of externalEmails) {
                                    if (extEmail.toLowerCase() === (castEmail || "").toLowerCase()) continue;
                                    const extRes = await addAttendeeViaGas({
                                        webhookUrl: gasWebhookUrl,
                                        secret: gasSharedSecret,
                                        calendarId,
                                        eventId,
                                        attendeeEmail: extEmail,
                                    });
                                    if (!extRes.ok) {
                                        console.warn(`[GAS invite] external email failed (${extEmail}) for event ${eventId}: ${extRes.error || "unknown"}`);
                                    } else {
                                        console.log(`[GAS invite] external email ok (${extEmail})${extRes.skipped ? " skipped=" + extRes.skipped : ""}`);
                                    }
                                }

                                calendarResults[castingDocId] = {
                                    eventId,
                                    castEmail: castEmail || "",
                                    attendeePending,
                                    ...(attendeeError ? { attendeeError } : {}),
                                };
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
            let updateCount = 0;

            for (let i = 0; i < castingIds.length; i++) {
                const cid = castingIds[i]!;
                const updateData: Record<string, unknown> = {};

                // Slack 情報は ts が取れた時のみ書き戻す
                if (threadTs) {
                    updateData.slackThreadTs = threadTs;
                    updateData.slackPermalink = permalink;
                    updateData.slackChannel = postChannel;
                }

                // calendarResults は castingId で直接引ける（内部キャストの分だけ存在）
                if (calendarResults[cid]) {
                    const r = calendarResults[cid]!;
                    updateData.calendarEventId = r.eventId;
                    if (r.attendeePending) {
                        // スケジューラで後追いリトライさせる
                        updateData.calendarAttendeePending = true;
                        updateData.calendarAttendeeRetryCount = 0;
                        if (r.attendeeError) {
                            updateData.calendarAttendeeLastError = r.attendeeError;
                        }
                    }
                }

                if (Object.keys(updateData).length > 0) {
                    batch.update(db.collection("castings").doc(cid), updateData);
                    updateCount++;
                }
            }

            if (updateCount > 0) {
                await batch.commit();
                console.log(`[Writeback] Updated ${updateCount} castings (slackTs=${threadTs ? "yes" : "NO"})`);
            }

            // ── shooting への dual write（撮影モードのみ・情報キャッシュ）──
            // ⚠️ shootings は「作品」単位で1ドキュメントのため、スレッド（作品+撮影日単位）の
            //    「正」にはならない。スレッド解決はオーダー文の撮影ID/castingId 検索で行い、
            //    ここは shootDate がオーダーの撮影日と一致する場合のみ更新するキャッシュに留める
            //    （別日のオーダーによる上書き事故防止）。
            if (threadTs && orderMode === "shooting" && data.projectId) {
                try {
                    const shootSnap = await db.collection("shootings")
                        .where("notionPageId", "==", data.projectId)
                        .get();
                    const activeShoots = shootSnap.docs.filter(d => {
                        const sd = d.data();
                        if (sd.deleted === true) return false;
                        return dateMatches(String(sd.shootDate || "").slice(0, 10));
                    });
                    if (activeShoots.length > 0) {
                        const shBatch = db.batch();
                        for (const sdoc of activeShoots) {
                            shBatch.update(sdoc.ref, {
                                slackThreadTs: threadTs,
                                slackPermalink: permalink,
                                slackChannel: postChannel,
                                slackUpdatedAt: admin.firestore.FieldValue.serverTimestamp(),
                            });
                        }
                        await shBatch.commit();
                        console.log(`[Writeback] shooting slackThreadTs updated: ${activeShoots.length}`);
                    }
                } catch (e) {
                    console.warn("[Writeback] shooting slackThreadTs update failed:", e);
                }
            }

            // ── slackThreadTs が空のまま残った場合、3分後に自動再同期を予約 ──
            // Slack 投稿は成功していてもフロント→CF のパスで ts/permalink が取れないケースがある。
            // 3分待ってから conversations.history を引き直して復旧を試みる。
            if (!threadTs) {
                try {
                    await scheduleSlackThreadLinkRetry(castingIds, 180);
                } catch (schedErr) {
                    console.error("[notifyOrderCreated] Failed to schedule slack thread retry:", schedErr);
                }
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

            // castingIds は items × 各itemの日程 の順で生成されている（item-major）。
            // フロントの生成順に合わせて、各 item の開始インデックス(baseIndex)を算出する。
            // ⚠️ 旧実装は findIndex（items内の位置）で castingIds を引いていたため、複数日程時に
            //    別キャストの castingId を掴み、DMのOKが別人に反映される不具合があった。
            const allItemsFull = data.items as Array<{ castName: string; castType: string; selectedDates?: string[] }>;
            const datesOf = (it: { selectedDates?: string[] }): string[] =>
                (it.selectedDates && it.selectedDates.length > 0) ? it.selectedDates : (data.dateRanges || []);

            for (let i = 0; i < internalItemsForDm.length; i++) {
                const item = internalItemsForDm[i]!;
                const originalIndex = allItemsFull.findIndex(
                    (ai) => ai.castName === item.castName && ai.castType === item.castType
                );
                if (originalIndex < 0) continue;
                // このキャストの castingIds 範囲を items-major の生成順から特定
                let baseIndex = 0;
                for (let k = 0; k < originalIndex; k++) baseIndex += datesOf(allItemsFull[k]!).length;
                const thisDatesCount = datesOf(allItemsFull[originalIndex]!).length;
                const castCastingIds = castingIds.slice(baseIndex, baseIndex + thisDatesCount).filter(Boolean);

                if (castCastingIds.length === 0 || !item.slackMentionId) continue;

                try {
                    const dmBlocks = buildCastOrderDmBlocks({
                        castName: item.castName,
                        projectName: item.projectName,
                        roleName: item.roleName || "出演",
                        dateRanges: data.dateRanges || [],
                        accountName: data.accountName || "",
                        castingIds: castCastingIds,
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
        // 優先順: 1) 撮影ID検索 2) 自身の castingId 検索 3) 撮影日一致のアクティブ兄弟キャッシュ
        // （Notion URL / 本文一致による推測は誤リンクの原因だったため廃止）
        if (!slackThreadTs && casting.projectId && slackToken && slackChannel) {
            try {
                const selfYmd = (() => { try { return casting.startDate?.toDate?.().toISOString().slice(0, 10) || ""; } catch { return ""; } })();
                const shootId = selfYmd ? buildShootId(casting.projectId, selfYmd) : "";

                const found = (await findThreadTsByTokens(slackToken, slackChannel, shootId ? [shootId] : []))
                    || (await findThreadTsByTokens(slackToken, slackChannel, [data.castingId]));
                if (found) {
                    slackThreadTs = found.ts;
                    console.log("[StatusRecovery] Found ts via shootId/castingId search:", slackThreadTs);
                    await castingDoc.ref.update({
                        slackThreadTs,
                        slackPermalink: found.permalink || "",
                        slackChannel,
                    }).catch(e => console.warn("[StatusRecovery] writeback failed:", e));
                } else {
                    // フォールバック: 撮影日一致のアクティブ兄弟のキャッシュ
                    const sibSnap = await db.collection("castings")
                        .where("projectId", "==", casting.projectId)
                        .get();
                    const sibling = sibSnap.docs.find(d => {
                        const dd = d.data();
                        if (!(dd.slackThreadTs && dd.deleted !== true && dd.status !== "キャンセル" && dd.status !== "NG" && dd.status !== "削除済み")) return false;
                        if (!selfYmd) return true;
                        let sibYmd = ""; try { sibYmd = dd.startDate?.toDate?.().toISOString().slice(0, 10) || ""; } catch { /* noop */ }
                        return !sibYmd || sibYmd === selfYmd;
                    });
                    if (sibling) {
                        const sd = sibling.data();
                        slackThreadTs = sd.slackThreadTs;
                        if (sd.slackChannel) slackChannel = sd.slackChannel;
                        console.log("[StatusRecovery] Borrowed thread ts from sibling cache:", slackThreadTs);
                        await castingDoc.ref.update({
                            slackThreadTs,
                            slackPermalink: sd.slackPermalink || casting.slackPermalink || "",
                            slackChannel: sd.slackChannel || slackChannel,
                        }).catch(e => console.warn("[StatusRecovery] writeback failed:", e));
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
            // DB統合済み: castings ドキュメントに contactStatus を設定するだけ
            if (casting.castType === "外部") {
                try {
                    if (!casting.contactStatus) {
                        await castingDoc.ref.update({
                            contactStatus: "香盤連絡待ち",
                            isDecided: true,
                            decidedAt: admin.firestore.FieldValue.serverTimestamp(),
                            decidedBy: "Slack応答",
                        });
                        console.log("Set contactStatus on casting:", casting.castName);
                    }
                } catch (e) {
                    console.warn("Failed to set contactStatus:", e);
                }
            }

            // マスターDB: isDecided フラグ設定（内部・外部両方）
            if (!casting.isDecided) {
                try {
                    await castingDoc.ref.update({
                        isDecided: true,
                        decidedAt: admin.firestore.FieldValue.serverTimestamp(),
                        decidedBy: "auto",
                    });
                } catch (e) {
                    console.warn("Failed to set isDecided:", e);
                }
            }
        }

        return { success: true };
    }
);

// ──────────────────────────────────────
// 2b. 一括ステータス変更通知（まとめてSlack送信）
// ──────────────────────────────────────
/**
 * 中長編: 日付ごとのステータス変更/日付削除を Slack スレッドに通知する。
 * casting 全体のステータスは変えないため、カレンダー/Notion 等の副作用は持たない。
 */
export const notifyFeatureDateStatus = onCall(
    {
        maxInstances: 10,
        secrets: ["SLACK_BOT_TOKEN", "SLACK_CHANNEL_INTERNAL"],
    },
    async (request) => {
        const data = request.data as { castingId?: string; date?: string; newStatus?: string; action?: string };
        if (!data?.castingId || !data?.date) {
            throw new HttpsError("invalid-argument", "castingId and date are required");
        }
        const db = admin.firestore();
        const snap = await db.collection("castings").doc(data.castingId).get();
        if (!snap.exists) throw new HttpsError("not-found", "Casting not found");
        const casting = snap.data()!;

        const slackToken = getEnv("SLACK_BOT_TOKEN");
        const slackChannel = resolveSlackChannel(casting);
        const slackThreadTs = casting.slackThreadTs || "";
        if (!slackToken || !slackChannel || !slackThreadTs) {
            return { success: false, skipped: "no thread" };
        }

        const md = (() => {
            const m = String(data.date).match(/^(\d{4})-(\d{2})-(\d{2})/);
            return m ? `${parseInt(m[2]!, 10)}/${parseInt(m[3]!, 10)}` : data.date;
        })();

        const message = data.action === "removeDate"
            ? `📅 *${casting.castName}* の ${md} 分の出演日を削除しました（${casting.projectName}）`
            : `📅 *${casting.castName}* の ${md} 分のステータスが変更されました → \`${data.newStatus}\`（${casting.projectName}）`;

        await postToSlack(slackToken, slackChannel, message, undefined, slackThreadTs);
        return { success: true };
    }
);

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
            "GAS_INVITE_WEBHOOK_URL",
            "GAS_INVITE_SHARED_SECRET",
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

        // 開始/終了時間の解決
        // 優先順位:
        //   1. casting 自体の startTime/endTime（社内イベント・外部案件はここに入る）
        //   2. shootings コレクション（撮影オーダーは projectId 経由でここに入る）
        let startTime: string | undefined = casting.startTime || undefined;
        let endTime: string | undefined = casting.endTime || undefined;

        if ((!startTime || !endTime) && casting.projectId) {
            try {
                const shootSnap = await db.collection("shootings")
                    .where("notionPageId", "==", casting.projectId)
                    .get();
                // deleted を除外（同 NotionID = 1 件前提だが安全のため filter）
                const activeShoot = shootSnap.docs.find(d => d.data().deleted !== true);
                if (activeShoot) {
                    const sd = activeShoot.data();
                    startTime = startTime || sd.startTime || undefined;
                    endTime = endTime || sd.endTime || undefined;
                }
            } catch (e) {
                console.warn("[regenerateCalendar] shootings lookup failed:", e);
            }
        }

        // どちらか片方しかなければ無効化（createCalendarEvent は両方揃わないと dateTime にしない）
        if (!startTime || !endTime) {
            console.log("[regenerateCalendar] No start/end time → all-day event");
            startTime = undefined;
            endTime = undefined;
        } else {
            console.log(`[regenerateCalendar] Using time: ${startTime} - ${endTime}`);
        }

        const isDecided = casting.status === "決定";
        const status = casting.status || "仮キャスティング";

        // createCalendarEvent は内部でエラー時に generic Error を投げる。
        // そのまま上に投げると onCall が "INTERNAL" にラップしてしまい、フロント側では
        // 具体的な失敗理由（カレンダーアクセス拒否・時間形式不正など）が見えない。
        // ここで HttpsError に変換して原因メッセージをそのままフロントに届ける。
        let eventId: string | null;
        try {
            eventId = await createCalendarEvent({
                serviceAccountKey,
                calendarId,
                castName: casting.castName || "",
                projectName: casting.projectName || "",
                accountName: casting.accountName || "",
                roleName: casting.roleName || "出演",
                rank: String(casting.rank || ""),
                mainSub: casting.mainSub || "その他",
                castingId: data.castingId,
                castEmail: castEmail || undefined,
                status,
                startDate: startDateStr,
                startTime,
                endTime,
                isProvisional: !isDecided,
            });
        } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            console.error(`[regenerateCalendar] createCalendarEvent failed for casting=${data.castingId}:`, msg);
            throw new HttpsError("internal", `カレンダー作成に失敗: ${msg}`);
        }

        if (!eventId) {
            throw new HttpsError("internal", "Calendar creation returned no eventId");
        }

        // attendee 追加は GAS 経由で CF 内完結させる。失敗時は pending フラグで後追いリトライ。
        const update: Record<string, unknown> = { calendarEventId: eventId };
        let attendeeStatus: "ok" | "pending" | "skipped" = "skipped";
        let attendeeError: string | undefined;
        if (castEmail) {
            const gasWebhookUrl = getEnv("GAS_INVITE_WEBHOOK_URL");
            const gasSharedSecret = getEnv("GAS_INVITE_SHARED_SECRET");
            const gasRes = await addAttendeeViaGas({
                webhookUrl: gasWebhookUrl,
                secret: gasSharedSecret,
                calendarId,
                eventId,
                attendeeEmail: castEmail,
            });
            if (gasRes.ok) {
                attendeeStatus = "ok";
                update.calendarAttendeePending = admin.firestore.FieldValue.delete();
                update.calendarAttendeeLastError = admin.firestore.FieldValue.delete();
                update.calendarAttendeeRetryCount = admin.firestore.FieldValue.delete();
            } else {
                attendeeStatus = "pending";
                attendeeError = gasRes.error || "unknown";
                update.calendarAttendeePending = true;
                update.calendarAttendeeRetryCount = 0;
                update.calendarAttendeeLastError = attendeeError;
            }
        }

        await castingDoc.ref.update(update);
        console.log(`[regenerateCalendar] Created event ${eventId} for casting ${data.castingId} attendee=${attendeeStatus}`);

        return {
            success: true,
            eventId,
            attendeeStatus,
            ...(attendeeError ? { attendeeError } : {}),
        };
    }
);

// ──────────────────────────────────────
// 2c-2. 既存イベントへの招待再送 (eventId あり前提)
// ──────────────────────────────────────
// 「イベントはあるけど招待が飛んでない」状態の救済。regenerate と違い eventId は作り直さない。
export const resendCalendarInvite = onCall(
    {
        maxInstances: 10,
        secrets: [
            "GOOGLE_CALENDAR_ID",
            "GAS_INVITE_WEBHOOK_URL",
            "GAS_INVITE_SHARED_SECRET",
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

        if (!casting.calendarEventId) {
            throw new HttpsError("failed-precondition", "calendarEventId が無いので先に再生成してください");
        }

        let castEmail = "";
        if (casting.castId) {
            const castDoc = await db.collection("casts").doc(casting.castId).get();
            if (castDoc.exists) castEmail = castDoc.data()?.email || "";
        }
        if (!castEmail) {
            throw new HttpsError("failed-precondition", "cast の email が登録されていません");
        }

        const calendarId = getEnv("GOOGLE_CALENDAR_ID");
        const gasWebhookUrl = getEnv("GAS_INVITE_WEBHOOK_URL");
        const gasSharedSecret = getEnv("GAS_INVITE_SHARED_SECRET");

        const gasRes = await addAttendeeViaGas({
            webhookUrl: gasWebhookUrl,
            secret: gasSharedSecret,
            calendarId,
            eventId: casting.calendarEventId,
            attendeeEmail: castEmail,
        });

        if (gasRes.ok) {
            await castingDoc.ref.update({
                calendarAttendeePending: admin.firestore.FieldValue.delete(),
                calendarAttendeeLastError: admin.firestore.FieldValue.delete(),
                calendarAttendeeRetryCount: admin.firestore.FieldValue.delete(),
            });
            return { success: true, skipped: gasRes.skipped };
        } else {
            const prev = (casting.calendarAttendeeRetryCount as number | undefined) || 0;
            await castingDoc.ref.update({
                calendarAttendeePending: true,
                calendarAttendeeRetryCount: prev + 1,
                calendarAttendeeLastError: gasRes.error || "unknown",
            });
            throw new HttpsError("internal", `GAS invite failed: ${gasRes.error}`);
        }
    }
);

// ──────────────────────────────────────
// 2d. キャスティングの slackThreadTs 修復
// ──────────────────────────────────────
// 過去のバグや書き戻し失敗で slackThreadTs が空になっているキャスティングに対し、
//  - manualUrl 指定: そのSlack URLから ts/channel を抽出して書き戻す
//  - manualUrl 未指定: 兄弟キャスティング借用 → Slack history 検索で自動復旧
// （ロジックは notifyStatusUpdate の StatusRecovery と同じ仕組み）
export const repairCastingThread = onCall(
    {
        maxInstances: 10,
        secrets: [
            "SLACK_BOT_TOKEN",
            "SLACK_CHANNEL_INTERNAL",
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

        // 1. manualUrl 指定パス
        if (data.manualUrl) {
            // https://gokko5club.slack.com/archives/CXXXX/p1234567890123456 → ts/channel 抽出
            const urlStr: string = String(data.manualUrl).trim();
            const urlMatch = urlStr.match(/\/archives\/(C[A-Z0-9]+)\/p(\d{10})(\d{6})/);
            if (!urlMatch) {
                throw new HttpsError("invalid-argument", "Slack URL の形式が不正です（…/archives/C.../p1234567890123456 を想定）");
            }
            const channel = urlMatch[1]!;
            const ts = `${urlMatch[2]}.${urlMatch[3]}`;
            await castingDoc.ref.update({
                slackThreadTs: ts,
                slackChannel: channel,
                slackPermalink: urlStr,
            });
            console.log(`[repairCastingThread] Manual URL: casting=${data.castingId} ts=${ts} channel=${channel}`);
            return { success: true, mode: "manual", slackThreadTs: ts, slackChannel: channel };
        }

        // 2. 自動復旧パス
        // 優先順: 1) 撮影ID検索 2) 自身の castingId 検索 3) 撮影日一致のアクティブ兄弟キャッシュ
        // （日付無視の兄弟借用・Notion URL 検索は誤リンクの原因だったため廃止）
        const slackToken = getEnv("SLACK_BOT_TOKEN");
        let slackChannel = resolveSlackChannel(casting) || getEnv("SLACK_CHANNEL_INTERNAL");
        let slackThreadTs = "";
        let foundPermalink = "";

        if (!casting.projectId) {
            throw new HttpsError("failed-precondition", "casting に projectId がないため自動復旧不可");
        }
        if (!slackToken || !slackChannel) {
            throw new HttpsError("failed-precondition", "Slack認証情報がない");
        }

        const selfYmd = (() => { try { return casting.startDate?.toDate?.().toISOString().slice(0, 10) || ""; } catch { return ""; } })();
        const shootId = selfYmd ? buildShootId(casting.projectId, selfYmd) : "";

        const foundByToken = (await findThreadTsByTokens(slackToken, slackChannel, shootId ? [shootId] : []))
            || (await findThreadTsByTokens(slackToken, slackChannel, [data.castingId]));
        if (foundByToken) {
            slackThreadTs = foundByToken.ts;
            foundPermalink = foundByToken.permalink;
            console.log(`[repairCastingThread] Found via shootId/castingId: casting=${data.castingId} ts=${slackThreadTs}`);
        } else {
            // フォールバック: 撮影日一致のアクティブ兄弟キャッシュ
            const sibSnap = await db.collection("castings")
                .where("projectId", "==", casting.projectId)
                .get();
            const sibling = sibSnap.docs.find(d => {
                const dd = d.data();
                if (!(dd.slackThreadTs && dd.deleted !== true && dd.status !== "キャンセル" && dd.status !== "NG" && dd.status !== "削除済み")) return false;
                if (!selfYmd) return true;
                let sibYmd = ""; try { sibYmd = dd.startDate?.toDate?.().toISOString().slice(0, 10) || ""; } catch { /* noop */ }
                return !sibYmd || sibYmd === selfYmd;
            });
            if (sibling) {
                const sd = sibling.data();
                slackThreadTs = sd.slackThreadTs;
                foundPermalink = sd.slackPermalink || "";
                if (sd.slackChannel) slackChannel = sd.slackChannel;
                console.log(`[repairCastingThread] Borrowed from date-matched sibling: casting=${data.castingId} ts=${slackThreadTs}`);
            }
        }

        if (!slackThreadTs) {
            throw new HttpsError("not-found", "自動復旧できませんでした。Slack URLを手動で指定してください");
        }

        await castingDoc.ref.update({
            slackThreadTs,
            slackChannel,
            slackPermalink: foundPermalink || "",
        });
        console.log(`[repairCastingThread] Recovered from history: casting=${data.castingId} ts=${slackThreadTs}`);
        return { success: true, mode: "history", slackThreadTs, slackChannel };
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

        // DB統合済み: castMaster / shootingContacts は castings に統合されたため
        // projectName の変更は castings の updateDoc だけで完結する（cascade 不要）
        if (projectNameTo && projectNameFrom !== projectNameTo) {
            console.log(`projectName changed: "${projectNameFrom}" → "${projectNameTo}" (cascade no longer needed)`);
        }

        // Slack通知（スレッド返信）— castings に保存されたチャンネルを優先
        // suppressSlack=true のときは通知しない（Firestore/カレンダー連動のみ実行）。
        // 例: 宮澤アカウントによる作品名変更は Slack 通知不要。
        const slackToken = getEnv("SLACK_BOT_TOKEN");
        const slackChannel = resolveSlackChannel(casting);
        const slackThreadTs = casting.slackThreadTs || "";

        if (!data.suppressSlack && slackToken && slackChannel && slackThreadTs) {
            const message = buildOrderUpdateMessage({
                castName: casting.castName,
                projectName: projectNameTo || casting.projectName,
                changes: changeDetails,
            });

            await postToSlack(slackToken, slackChannel, message, undefined, slackThreadTs);
        } else if (data.suppressSlack) {
            console.log("[notifyOrderUpdated] Slack通知を抑止 (suppressSlack=true)");
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
            castingIds: [castingId],
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
