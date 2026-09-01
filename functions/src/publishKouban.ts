/**
 * Cloud Functions - 決定香盤を Casty に流す
 *
 * 既存のスプレッドシート経由（source: 'sheet'）はそのまま残す。
 * こちらは自動香盤から流すぶん（source: 'auto'）。2軸で走らせて、
 * まずければ auto の行だけ選んで消せるようにしてある。
 *
 * 撮影の鍵は Notion の撮影ページID。castings.projectId と同じ値なので、
 * 撮影で絞ってから名前で当てる。全件を名前で舐めない。
 */

import { onCall, HttpsError } from "firebase-functions/v2/https";
import * as admin from "firebase-admin";

/** 時刻を入れてよいのはこの状態の行だけ。NG や キャンセルには触らない */
const LIVE = new Set(["決定", "OK", "条件つきOK"]);

/** 表記ゆれを畳む。全角→半角・様さん・空白 */
function norm(s: unknown): string {
    return String(s ?? "")
        .normalize("NFKC")
        .trim()
        .replace(/[様さん]+$/u, "")
        .replace(/\s+/g, "");
}

interface RosterRow {
    id: string;
    roleName?: string;
    castName?: string;
    callTime?: string;
    outTime?: string;
    castyCastingId?: string | null;
    castId?: string | null;
    matchStatus?: string;
}

export const publishKouban = onCall(
    { region: "asia-northeast1", maxInstances: 5 },
    async (request) => {
        if (!request.auth) {
            throw new HttpsError("unauthenticated", "サインインが必要です");
        }
        const shootId = String(request.data?.shootId ?? "");
        const dryRun = request.data?.dryRun !== false; // 既定は書かない
        if (!shootId) {
            throw new HttpsError("invalid-argument", "shootId が要ります");
        }

        const db = admin.firestore();
        const shootRef = db.collection("shoots").doc(shootId);
        const shootSnap = await shootRef.get();
        if (!shootSnap.exists) {
            throw new HttpsError("not-found", "この撮影の香盤がありません");
        }
        const shoot = shootSnap.data() as Record<string, any>;
        if (shoot.status !== "決") {
            throw new HttpsError(
                "failed-precondition",
                "決定香盤にしてから送ってください"
            );
        }

        // ── 香盤の配役
        const rosterSnap = await shootRef.collection("roster").get();
        const roster: RosterRow[] = rosterSnap.docs.map((d) => ({
            id: d.id,
            ...(d.data() as Record<string, any>),
        }));

        // ── Casty のキャスティング。撮影で絞ってから、生きている行だけ
        const castingSnap = await db
            .collection("castings")
            .where("projectId", "==", shootId)
            .get();
        const live = castingSnap.docs.filter((d) => LIVE.has(d.data().status));

        const matched: Record<string, any>[] = [];
        const unmatched: Record<string, any>[] = [];
        const ambiguous: Record<string, any>[] = [];
        const conflicts: Record<string, any>[] = [];
        const used = new Set<string>();

        for (const r of roster) {
            // すでに結び目が焼かれていれば、名前で当て直さない
            let hit = r.castyCastingId
                ? live.find((d) => d.id === r.castyCastingId)
                : undefined;

            if (!hit) {
                const nm = norm(r.castName);
                let cands = live.filter(
                    (d) => norm(d.data().castName) === nm && !used.has(d.id)
                );
                if (cands.length > 1) {
                    // 同名は役名で絞る。1日2作品だと同じ役名が2つあることがある
                    const byRole = cands.filter(
                        (d) => norm(d.data().roleName) === norm(r.roleName)
                    );
                    if (byRole.length) cands = byRole;
                }
                if (cands.length > 1) {
                    // 当てずっぽうで選ばない。人に決めてもらう
                    ambiguous.push({
                        rosterId: r.id,
                        roleName: r.roleName ?? "",
                        castName: r.castName ?? "",
                        candidates: cands.map((d) => ({
                            castingId: d.id,
                            projectName: d.data().projectName ?? "",
                            roleName: d.data().roleName ?? "",
                        })),
                    });
                    continue;
                }
                hit = cands[0];
            }

            if (!hit) {
                unmatched.push({
                    rosterId: r.id,
                    roleName: r.roleName ?? "",
                    castName: r.castName ?? "",
                });
                continue;
            }

            used.add(hit.id);
            const c = hit.data();

            // 食い違いは上書きしない。両方残して人に見せる
            for (const [mine, theirs] of [
                [r.callTime, c.inTime],
                [r.outTime, c.outTime],
            ] as [string | undefined, string | undefined][]) {
                const a = (mine ?? "").trim();
                const b = (theirs ?? "").trim();
                if (a && b && a !== b) {
                    conflicts.push({
                        rosterId: r.id,
                        castName: r.castName ?? "",
                        kouban: a,
                        casty: b,
                    });
                }
            }

            matched.push({
                rosterId: r.id,
                castingId: hit.id,
                castId: c.castId ?? null,
                roleName: r.roleName ?? "",
                castName: r.castName ?? "",
                callTime: r.callTime ?? "",
                outTime: r.outTime ?? "",
                // 空のときだけ入れる。人が手で入れた値は潰さない
                willFill: {
                    inTime: !!(r.callTime ?? "").trim() && !(c.inTime ?? "").trim(),
                    outTime: !!(r.outTime ?? "").trim() && !(c.outTime ?? "").trim(),
                },
            });
        }

        const summary = {
            shootId,
            title: shoot.title ?? "",
            date: shoot.date ?? "",
            castings: castingSnap.size,
            live: live.length,
            matched: matched.length,
            unmatched: unmatched.length,
            ambiguous: ambiguous.length,
            conflicts: conflicts.length,
            dryRun,
        };

        if (dryRun) {
            return { ...summary, matchedRows: matched, unmatched, ambiguous, conflicts };
        }

        // ── ここから書く。全部成功するか、全部戻るか
        const batch = db.batch();
        const now = admin.firestore.FieldValue.serverTimestamp();
        const addr = shoot.addr ?? "";
        const studio = shoot.studio ?? "";

        for (const m of matched) {
            // 1. castings を直接更新（主経路）
            const upd: Record<string, unknown> = { updatedAt: now };
            if (m.willFill.inTime) {
                upd.inTime = m.callTime;
                upd.startTime = m.callTime;
            }
            if (m.willFill.outTime) {
                upd.outTime = m.outTime;
                upd.endTime = m.outTime;
            }
            if (Object.keys(upd).length > 1) {
                batch.update(db.collection("castings").doc(m.castingId), upd);
            }

            // 2. shootingDetails にも書く（既存の受け口。突き合わせと切り戻しのため）
            const detailId = `${shootId.replace(/-/g, "")}_${String(m.castName).replace(/\s+/g, "")}`
                .replace(/[/.]/g, "_");
            batch.set(
                db.collection("shootingDetails").doc(detailId),
                {
                    castName: m.castName,
                    inTime: m.callTime,
                    outTime: m.outTime,
                    location: studio,
                    address: addr,
                    notionPageId: shootId.replace(/-/g, ""),
                    // 既存のスプレッドシート由来と混ざっても見分けられるように
                    source: "auto",
                    shootId,
                    updatedAt: now,
                },
                { merge: true }
            );

            // 3. 結び目を焼く。次からは名前で当て直さない
            batch.update(shootRef.collection("roster").doc(m.rosterId), {
                castyCastingId: m.castingId,
                castId: m.castId,
                matchStatus: "auto",
                matchedAt: now,
            });
        }

        for (const u of unmatched) {
            batch.update(shootRef.collection("roster").doc(u.rosterId), {
                matchStatus: "unmatched",
            });
        }
        for (const a of ambiguous) {
            batch.update(shootRef.collection("roster").doc(a.rosterId), {
                matchStatus: "ambiguous",
                matchCandidates: a.candidates,
            });
        }

        // 4. 送った履歴。二重送信の判定と、あとから見直すため
        const exportId = `${shootId}_${Date.now()}`;
        batch.set(db.collection("koubanExports").doc(exportId), {
            ...summary,
            dryRun: false,
            matchedRows: matched,
            unmatched,
            ambiguous,
            conflicts,
            sentBy: request.auth.token.email ?? request.auth.uid,
            sentAt: now,
        });

        batch.set(shootRef, { lastExportAt: now, lastExportId: exportId }, { merge: true });
        await batch.commit();

        return { ...summary, exportId, matchedRows: matched, unmatched, ambiguous, conflicts };
    }
);
