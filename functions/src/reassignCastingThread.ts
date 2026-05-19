/**
 * 指定された castings の Slack スレッド紐付けを別スレッドに差し替える onCall.
 *
 * 入力: { castingIds: string[], slackThreadUrl: string, slackThreadTs: string, slackChannel: string }
 *
 * 処理:
 *  - castings.slackThreadTs / slackChannel / slackPermalink を更新
 *  - 各 casting が紐づく shooting（撮影モードで projectId 経由）にも反映（dual write）
 *  - chat.getPermalink で permalink を確定（取れなければ入力 URL をそのまま保存）
 */
import { onCall, HttpsError } from "firebase-functions/v2/https";
import * as admin from "firebase-admin";

export const reassignCastingThread = onCall(
    {
        region: "asia-northeast1",
        secrets: ["SLACK_BOT_TOKEN"],
        maxInstances: 5,
        memory: "512MiB",
        timeoutSeconds: 120,
    },
    async (request) => {
        const data = request.data as {
            castingIds?: string[];
            slackThreadUrl?: string;
            slackThreadTs?: string;
            slackChannel?: string;
        };
        const castingIds = Array.isArray(data?.castingIds) ? data.castingIds : [];
        const slackThreadTs = (data?.slackThreadTs || "").trim();
        const slackChannel = (data?.slackChannel || "").trim();
        if (castingIds.length === 0) {
            throw new HttpsError("invalid-argument", "castingIds is empty");
        }
        if (!slackThreadTs || !slackChannel) {
            throw new HttpsError("invalid-argument", "slackThreadTs / slackChannel が必要です");
        }

        const db = admin.firestore();
        const token = process.env.SLACK_BOT_TOKEN;

        // permalink 取得（失敗しても継続）
        let permalink = (data?.slackThreadUrl || "").trim();
        if (token) {
            try {
                const r = await fetch("https://slack.com/api/chat.getPermalink", {
                    method: "POST",
                    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
                    body: JSON.stringify({ channel: slackChannel, message_ts: slackThreadTs }),
                });
                const j = await r.json() as { ok: boolean; permalink?: string };
                if (j.ok && j.permalink) permalink = j.permalink;
            } catch (e) {
                console.warn("[reassignCastingThread] getPermalink failed:", e);
            }
        }

        // castings update
        const updateFields = {
            slackThreadTs,
            slackChannel,
            slackPermalink: permalink,
            slackThreadReassignedAt: admin.firestore.FieldValue.serverTimestamp(),
        } as Record<string, unknown>;

        let castingUpdated = 0;
        const projectIds = new Set<string>();
        for (let i = 0; i < castingIds.length; i += 500) {
            const chunk = castingIds.slice(i, i + 500);
            const batch = db.batch();
            const refs = chunk.map(id => db.collection("castings").doc(id));
            const snaps = await db.getAll(...refs);
            for (const s of snaps) {
                if (!s.exists) continue;
                const sd = s.data() as Record<string, unknown> | undefined;
                const pid = (sd?.projectId as string | undefined) || "";
                if (pid) projectIds.add(pid);
                batch.update(s.ref, updateFields);
                castingUpdated++;
            }
            await batch.commit();
        }

        // shootings dual write（撮影モードで projectId が引ける場合のみ）
        let shootingsUpdated = 0;
        for (const pid of projectIds) {
            try {
                const sh = await db.collection("shootings").where("notionPageId", "==", pid).get();
                const targets = sh.docs.filter(d => d.data().deleted !== true);
                if (targets.length === 0) continue;
                const batch = db.batch();
                for (const t of targets) {
                    batch.update(t.ref, {
                        slackThreadTs,
                        slackChannel,
                        slackPermalink: permalink,
                        slackUpdatedAt: admin.firestore.FieldValue.serverTimestamp(),
                    });
                    shootingsUpdated++;
                }
                await batch.commit();
            } catch (e) {
                console.warn("[reassignCastingThread] shooting update failed:", e);
            }
        }

        console.log(`[reassignCastingThread] castings=${castingUpdated} shootings=${shootingsUpdated} ts=${slackThreadTs} chan=${slackChannel}`);
        return { updated: castingUpdated, shootingsUpdated, permalink };
    }
);
