"use strict";
/**
 * =========================================================================
 * automation/retrySlackThreadLink.ts
 *
 * オーダー送信後、slackThreadTs が空のまま残った castings を 3分後に
 * 再リンクする Cloud Tasks ターゲット。
 *
 * 発火源: notifyOrderCreated → scheduleSlackThreadLinkRetry()
 * 処理:
 *   - castingIds のうち slackThreadTs がまだ空のものだけを対象
 *   - projectId 単位で: 兄弟 casting からの借用 → Slack history 検索
 *   - 手動ボタン (repairCastingThread) と同じロジック
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
exports.retrySlackThreadLink = void 0;
exports.scheduleSlackThreadLinkRetry = scheduleSlackThreadLinkRetry;
const https_1 = require("firebase-functions/v2/https");
const admin = __importStar(require("firebase-admin"));
const tasks_1 = require("@google-cloud/tasks");
const PROJECT_ID = "gokko-casty";
const LOCATION = "asia-northeast1";
const TASKS_QUEUE = "offshot-slack-queue"; // 汎用の遅延実行キューを流用
const CF_URL_RETRY_LINK = `https://${LOCATION}-${PROJECT_ID}.cloudfunctions.net/retrySlackThreadLink`;
/**
 * Cloud Tasks で retrySlackThreadLink を delaySec 後に予約
 */
async function scheduleSlackThreadLinkRetry(castingIds, delaySec) {
    if (!castingIds || castingIds.length === 0)
        return;
    const client = new tasks_1.CloudTasksClient();
    const queuePath = client.queuePath(PROJECT_ID, LOCATION, TASKS_QUEUE);
    const now = Date.now();
    const targetMs = now + Math.max(delaySec, 30) * 1000; // 最低30秒
    const serviceAccountEmail = `${PROJECT_ID}@appspot.gserviceaccount.com`;
    const body = Buffer.from(JSON.stringify({ castingIds })).toString("base64");
    const [response] = await client.createTask({
        parent: queuePath,
        task: {
            httpRequest: {
                httpMethod: "POST",
                url: CF_URL_RETRY_LINK,
                body,
                headers: { "Content-Type": "application/json" },
                oidcToken: { serviceAccountEmail, audience: CF_URL_RETRY_LINK },
            },
            scheduleTime: { seconds: Math.floor(targetMs / 1000) },
        },
    });
    const delayMin = Math.round((targetMs - now) / 60000);
    console.log(`[scheduleSlackThreadLinkRetry] Task created: ${response.name} (fires in ~${delayMin}min, ${castingIds.length} castings)`);
}
exports.retrySlackThreadLink = (0, https_1.onRequest)({
    region: "asia-northeast1",
    secrets: ["SLACK_BOT_TOKEN", "SLACK_CHANNEL_INTERNAL"],
    invoker: "public", // Cloud Tasks OIDC で来る
}, async (req, res) => {
    try {
        const { castingIds } = req.body;
        if (!castingIds || !Array.isArray(castingIds) || castingIds.length === 0) {
            res.status(400).json({ error: "castingIds required" });
            return;
        }
        const db = admin.firestore();
        const slackToken = process.env.SLACK_BOT_TOKEN;
        const defaultChannel = process.env.SLACK_CHANNEL_INTERNAL || "";
        // まだ slackThreadTs が空の casting だけ抽出
        const refs = castingIds.map(id => db.collection("castings").doc(id));
        const snaps = await db.getAll(...refs);
        const targets = snaps
            .filter((s) => s.exists)
            .filter((s) => !s.data()?.slackThreadTs);
        if (targets.length === 0) {
            console.log("[retrySlackThreadLink] all castings already linked");
            res.json({ ok: true, skipped: "already linked" });
            return;
        }
        // Timestamp → YYYY-MM-DD
        const tsToYmd = (ts) => {
            try {
                return ts?.toDate?.().toISOString().slice(0, 10) || "";
            }
            catch {
                return "";
            }
        };
        // 「作品 + 撮影日」でグルーピング（同じ作品でも別日のオーダーは別スレッド）
        const byGroup = new Map();
        for (const t of targets) {
            const pid = t.data()?.projectId || "";
            if (!pid)
                continue;
            const ymd = tsToYmd(t.data()?.startDate);
            const key = `${pid}__${ymd}`;
            const g = byGroup.get(key) || { projectId: pid, ymd, casts: [] };
            g.casts.push(t);
            byGroup.set(key, g);
        }
        const results = [];
        for (const { projectId, ymd, casts } of byGroup.values()) {
            // 0) 撮影モード: shooting.slackThreadTs を最優先
            const isShootingMode = casts.some(t => t.data()?.mode === "shooting" || !t.data()?.mode);
            if (isShootingMode) {
                try {
                    const shootSnap = await db.collection("shootings")
                        .where("notionPageId", "==", projectId)
                        .get();
                    const activeShoot = shootSnap.docs.find(d => {
                        const sd = d.data();
                        // 撮影日が一致するスレッドのみ（別日の撮影スレッド誤掴み防止）
                        return sd.deleted !== true && sd.slackThreadTs && (!ymd || String(sd.shootDate || "").slice(0, 10) === ymd);
                    });
                    if (activeShoot) {
                        const sd = activeShoot.data();
                        const batch = db.batch();
                        for (const t of casts) {
                            batch.update(t.ref, {
                                slackThreadTs: sd.slackThreadTs,
                                slackPermalink: sd.slackPermalink || "",
                                slackChannel: sd.slackChannel || defaultChannel,
                            });
                            results.push({ castingId: t.ref.id, status: "linked", mode: "shooting" });
                        }
                        await batch.commit();
                        continue;
                    }
                }
                catch (e) {
                    console.warn("[retrySlackThreadLink] shooting lookup failed:", e);
                }
            }
            // 1) 兄弟借用
            const sibSnap = await db.collection("castings")
                .where("projectId", "==", projectId)
                .get();
            const activeSibling = sibSnap.docs.find(d => {
                const dd = d.data();
                // 撮影日が一致する有効な兄弟スレッドのみ（別日の別オーダーのスレッド誤掴み防止）
                return dd.slackThreadTs
                    && dd.deleted !== true
                    && dd.status !== "キャンセル"
                    && dd.status !== "NG"
                    && dd.status !== "削除済み"
                    && (!ymd || tsToYmd(dd.startDate) === ymd);
            });
            if (activeSibling) {
                const sd = activeSibling.data();
                const batch = db.batch();
                for (const t of casts) {
                    batch.update(t.ref, {
                        slackThreadTs: sd.slackThreadTs,
                        slackPermalink: sd.slackPermalink || "",
                        slackChannel: sd.slackChannel || defaultChannel,
                    });
                    results.push({ castingId: t.ref.id, status: "linked", mode: "sibling" });
                }
                await batch.commit();
                continue;
            }
            // 2) Slack history 検索
            if (!slackToken) {
                for (const t of casts)
                    results.push({ castingId: t.ref.id, status: "no slack token" });
                continue;
            }
            const searchChannel = casts[0]?.data()?.slackChannel || defaultChannel;
            if (!searchChannel) {
                for (const t of casts)
                    results.push({ castingId: t.ref.id, status: "no slack channel" });
                continue;
            }
            const blacklistedTs = new Set(sibSnap.docs
                .filter(d => {
                const dd = d.data();
                return dd.deleted === true
                    || dd.status === "キャンセル"
                    || dd.status === "NG"
                    || dd.status === "削除済み";
            })
                .map(d => d.data().slackThreadTs)
                .filter((ts) => !!ts));
            // 探索キー: (a) この project の対象 castingId のいずれか（最優先・厳密）
            //          (b) Notion URL フラグメント（フォールバック・古いメッセージ用）
            const targetCastingIds = casts.map(t => t.ref.id);
            const notionUrlFrag = `notion.so/${String(projectId).replace(/-/g, "")}`;
            // notionUrl フォールバック用の撮影日トークン（別日の親メッセージ誤掴み防止）
            const dateTokens = [];
            if (ymd) {
                const [yyyy, mm, dd] = ymd.split("-");
                dateTokens.push(ymd, `${yyyy}/${mm}/${dd}`, `${mm}/${dd}`, `${Number(mm)}/${Number(dd)}`);
            }
            const textHasOrderDate = (text) => dateTokens.length === 0 || dateTokens.some(t => text.includes(t));
            let foundTs = "";
            let foundPermalink = "";
            let foundMode = "";
            let cursor;
            for (let page = 0; page < 3 && !foundTs; page++) {
                const histRes = await fetch("https://slack.com/api/conversations.history", {
                    method: "POST",
                    headers: { Authorization: `Bearer ${slackToken}`, "Content-Type": "application/json" },
                    body: JSON.stringify({ channel: searchChannel, limit: 100, ...(cursor ? { cursor } : {}) }),
                });
                const hd = await histRes.json();
                if (!hd.ok || !hd.messages)
                    break;
                // 優先: 本文に対象 castingId のいずれかを含むメッセージ
                const foundByCastingId = hd.messages.find(m => {
                    if (!m.text || blacklistedTs.has(m.ts))
                        return false;
                    return targetCastingIds.some(id => m.text.includes(id));
                });
                const foundByNotionUrl = !foundByCastingId
                    ? hd.messages.find(m => m.text && m.text.includes(notionUrlFrag) && textHasOrderDate(m.text) && !blacklistedTs.has(m.ts))
                    : undefined;
                const found = foundByCastingId || foundByNotionUrl;
                if (found) {
                    foundTs = found.ts;
                    foundMode = foundByCastingId ? "history-castingId" : "history-notionUrl";
                    try {
                        const plRes = await fetch("https://slack.com/api/chat.getPermalink", {
                            method: "POST",
                            headers: { Authorization: `Bearer ${slackToken}`, "Content-Type": "application/json" },
                            body: JSON.stringify({ channel: searchChannel, message_ts: foundTs }),
                        });
                        const plData = await plRes.json();
                        if (plData.ok && plData.permalink)
                            foundPermalink = plData.permalink;
                    }
                    catch { /* ignore */ }
                    break;
                }
                cursor = hd.response_metadata?.next_cursor;
                if (!cursor)
                    break;
            }
            if (foundTs) {
                const batch = db.batch();
                for (const t of casts) {
                    batch.update(t.ref, {
                        slackThreadTs: foundTs,
                        slackPermalink: foundPermalink || "",
                        slackChannel: searchChannel,
                    });
                    results.push({ castingId: t.ref.id, status: "linked", mode: foundMode || "history" });
                }
                await batch.commit();
            }
            else {
                for (const t of casts)
                    results.push({ castingId: t.ref.id, status: "not found" });
            }
        }
        console.log(`[retrySlackThreadLink] processed=${targets.length}`, JSON.stringify(results));
        res.json({ ok: true, results });
    }
    catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error("[retrySlackThreadLink] Error:", msg);
        // Cloud Tasks のリトライに委ねる
        res.status(500).json({ error: msg });
    }
});
//# sourceMappingURL=retrySlackThreadLink.js.map