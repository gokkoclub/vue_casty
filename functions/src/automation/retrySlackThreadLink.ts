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

import { onRequest } from "firebase-functions/v2/https";
import * as admin from "firebase-admin";
import { CloudTasksClient } from "@google-cloud/tasks";

const PROJECT_ID = "gokko-casty";
const LOCATION = "asia-northeast1";
const TASKS_QUEUE = "offshot-slack-queue"; // 汎用の遅延実行キューを流用
const CF_URL_RETRY_LINK = `https://${LOCATION}-${PROJECT_ID}.cloudfunctions.net/retrySlackThreadLink`;

type CastingDoc = FirebaseFirestore.DocumentSnapshot<FirebaseFirestore.DocumentData>;

/**
 * Cloud Tasks で retrySlackThreadLink を delaySec 後に予約
 */
export async function scheduleSlackThreadLinkRetry(
    castingIds: string[],
    delaySec: number,
): Promise<void> {
    if (!castingIds || castingIds.length === 0) return;

    const client = new CloudTasksClient();
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

export const retrySlackThreadLink = onRequest(
    {
        region: "asia-northeast1",
        secrets: ["SLACK_BOT_TOKEN", "SLACK_CHANNEL_INTERNAL"],
        invoker: "public", // Cloud Tasks OIDC で来る
    },
    async (req, res) => {
        try {
            const { castingIds } = req.body as { castingIds?: string[] };
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
                .filter((s: CastingDoc) => s.exists)
                .filter((s: CastingDoc) => !s.data()?.slackThreadTs);

            if (targets.length === 0) {
                console.log("[retrySlackThreadLink] all castings already linked");
                res.json({ ok: true, skipped: "already linked" });
                return;
            }

            // projectId でグルーピング (同一 project の castings は同じ thread を共有)
            const byProject = new Map<string, CastingDoc[]>();
            for (const t of targets) {
                const pid = (t.data()?.projectId as string) || "";
                if (!pid) continue;
                const arr = byProject.get(pid) || [];
                arr.push(t);
                byProject.set(pid, arr);
            }

            const results: Array<{ castingId: string; status: string; mode?: string }> = [];

            for (const [projectId, casts] of byProject) {
                // 1) 兄弟借用
                const sibSnap = await db.collection("castings")
                    .where("projectId", "==", projectId)
                    .get();
                const activeSibling = sibSnap.docs.find(d => {
                    const dd = d.data();
                    return dd.slackThreadTs
                        && dd.deleted !== true
                        && dd.status !== "キャンセル"
                        && dd.status !== "NG"
                        && dd.status !== "削除済み";
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
                    for (const t of casts) results.push({ castingId: t.ref.id, status: "no slack token" });
                    continue;
                }
                const searchChannel = (casts[0]?.data()?.slackChannel as string) || defaultChannel;
                if (!searchChannel) {
                    for (const t of casts) results.push({ castingId: t.ref.id, status: "no slack channel" });
                    continue;
                }

                const blacklistedTs = new Set<string>(
                    sibSnap.docs
                        .filter(d => {
                            const dd = d.data();
                            return dd.deleted === true
                                || dd.status === "キャンセル"
                                || dd.status === "NG"
                                || dd.status === "削除済み";
                        })
                        .map(d => d.data().slackThreadTs as string | undefined)
                        .filter((ts): ts is string => !!ts)
                );
                const notionUrlFrag = `notion.so/${String(projectId).replace(/-/g, "")}`;

                let foundTs = "";
                let foundPermalink = "";
                let cursor: string | undefined;
                for (let page = 0; page < 3 && !foundTs; page++) {
                    const histRes = await fetch("https://slack.com/api/conversations.history", {
                        method: "POST",
                        headers: { Authorization: `Bearer ${slackToken}`, "Content-Type": "application/json" },
                        body: JSON.stringify({ channel: searchChannel, limit: 100, ...(cursor ? { cursor } : {}) }),
                    });
                    const hd = await histRes.json() as {
                        ok: boolean;
                        messages?: Array<{ ts: string; text?: string }>;
                        response_metadata?: { next_cursor?: string };
                    };
                    if (!hd.ok || !hd.messages) break;
                    const found = hd.messages.find(m => m.text && m.text.includes(notionUrlFrag) && !blacklistedTs.has(m.ts));
                    if (found) {
                        foundTs = found.ts;
                        try {
                            const plRes = await fetch("https://slack.com/api/chat.getPermalink", {
                                method: "POST",
                                headers: { Authorization: `Bearer ${slackToken}`, "Content-Type": "application/json" },
                                body: JSON.stringify({ channel: searchChannel, message_ts: foundTs }),
                            });
                            const plData = await plRes.json() as { ok: boolean; permalink?: string };
                            if (plData.ok && plData.permalink) foundPermalink = plData.permalink;
                        } catch { /* ignore */ }
                        break;
                    }
                    cursor = hd.response_metadata?.next_cursor;
                    if (!cursor) break;
                }

                if (foundTs) {
                    const batch = db.batch();
                    for (const t of casts) {
                        batch.update(t.ref, {
                            slackThreadTs: foundTs,
                            slackPermalink: foundPermalink || "",
                            slackChannel: searchChannel,
                        });
                        results.push({ castingId: t.ref.id, status: "linked", mode: "history" });
                    }
                    await batch.commit();
                } else {
                    for (const t of casts) results.push({ castingId: t.ref.id, status: "not found" });
                }
            }

            console.log(`[retrySlackThreadLink] processed=${targets.length}`, JSON.stringify(results));
            res.json({ ok: true, results });
        } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : String(err);
            console.error("[retrySlackThreadLink] Error:", msg);
            // Cloud Tasks のリトライに委ねる
            res.status(500).json({ error: msg });
        }
    }
);
