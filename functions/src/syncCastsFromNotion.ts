/**
 * Cloud Functions - Notion キャスト DB → Firestore casts へ同期 (CF 直接版)
 *
 * GAS の syncCasts を完全置換する想定。
 *
 * 必要なシークレット:
 *   NOTION_TOKEN              (既存)
 *   NOTION_CAST_DATABASE_ID   (キャスト DB の ID)
 *
 * マッピング:
 *   名前 (title)                → name
 *   ふりがな (rich_text)         → furigana
 *   性別 (select)                → gender
 *   生年月日 (date)              → dateOfBirth ("YYYY-MM-DD")
 *   CastID (rich_text)           → casts.id 解決キー (cast_NNNNN)
 *   X(Twitter) (url)             → snsX
 *   Instagram (url)              → snsInstagram
 *   TikTok (url)                 → snsTikTok
 *   アイコン_Gドライブリンク     → imageUrl
 *   事務所 (rollup)              → agency
 *   特記 4 フィールド (rich_text):
 *     NG・制限事項 / アレルギー / 金額_特記事項 / 備考欄
 *       → memo に集約、hasMemo フラグ
 *
 * docId 決定ロジック:
 *   1. Notion 側に CastID プロパティが入っていればそれを docId に
 *   2. CastID 空 → casts に同名キャストがあればそれを使い、Notion 側に CastID を書き戻す
 *   3. それでも無い → max(cast_NNNNN) + 1 で新規採番し、Notion 側に書き戻す
 *
 * 削除検知: 同期時に Notion から消えた CastID は deleted:true マーク
 */
import { onCall, HttpsError } from "firebase-functions/v2/https";
import { onSchedule } from "firebase-functions/v2/scheduler";
import * as admin from "firebase-admin";
import { Client } from "@notionhq/client";

interface NotionPageMinimal {
    id: string;
    archived?: boolean;
    properties: Record<string, unknown>;
}

function readTitle(props: Record<string, unknown>, key: string): string {
    const p = props[key] as { title?: Array<{ plain_text?: string }> } | undefined;
    if (p?.title && Array.isArray(p.title)) return p.title.map(t => t.plain_text || "").join("");
    return "";
}
function readRich(props: Record<string, unknown>, key: string): string {
    const p = props[key] as { rich_text?: Array<{ plain_text?: string }> } | undefined;
    if (p?.rich_text && Array.isArray(p.rich_text)) return p.rich_text.map(t => t.plain_text || "").join("");
    return "";
}
function readSelect(props: Record<string, unknown>, key: string): string {
    const p = props[key] as { select?: { name?: string } | null } | undefined;
    return p?.select?.name || "";
}
function readUrl(props: Record<string, unknown>, key: string): string {
    const p = props[key] as { url?: string | null } | undefined;
    return p?.url || "";
}
function readDate(props: Record<string, unknown>, key: string): string {
    const p = props[key] as { date?: { start?: string } } | undefined;
    return p?.date?.start ? p.date.start.substring(0, 10) : "";
}
// rollup の最初の string 値を取る（事務所など）
function readRollupString(props: Record<string, unknown>, key: string): string {
    const p = props[key] as { rollup?: { type?: string; array?: Array<Record<string, unknown>> } } | undefined;
    const arr = p?.rollup?.array;
    if (!Array.isArray(arr) || arr.length === 0) return "";
    for (const item of arr) {
        const t = (item as { type?: string }).type;
        if (t === "title" || t === "rich_text") {
            const richArr = (item as { [k: string]: Array<{ plain_text?: string }> })[t];
            if (Array.isArray(richArr)) return richArr.map(r => r.plain_text || "").join("");
        }
        if (t === "select") {
            const sel = (item as { select?: { name?: string } }).select;
            if (sel?.name) return sel.name;
        }
        if (t === "rollup") {
            const inner = (item as { rollup?: { type?: string; number?: number } }).rollup;
            if (inner?.type === "number" && typeof inner.number === "number") return String(inner.number);
        }
    }
    return "";
}
// files プロパティから最初の URL を取る
function readFileUrl(props: Record<string, unknown>, key: string): string {
    const p = props[key] as { files?: Array<{ file?: { url?: string }; external?: { url?: string } }> } | undefined;
    const f = p?.files?.[0];
    if (!f) return "";
    return f.file?.url || f.external?.url || "";
}

function buildMemo(props: Record<string, unknown>): { memo: string; hasMemo: boolean } {
    const fields: Array<{ label: string; key: string }> = [
        { label: "NG・制限事項", key: "NG・制限事項" },
        { label: "アレルギー", key: "アレルギー" },
        { label: "金額_特記事項", key: "金額_特記事項" },
        { label: "備考欄", key: "備考欄" },
    ];
    const lines: string[] = [];
    for (const f of fields) {
        const v = readRich(props, f.key).trim();
        if (v) lines.push(`【${f.label}】\n${v}`);
    }
    const memo = lines.join("\n\n");
    return { memo, hasMemo: memo.length > 0 };
}

function nextCastId(maxNum: number): string {
    const n = maxNum + 1;
    return "cast_" + String(n).padStart(5, "0");
}

async function performSync(opts: { writeCastIdBack?: boolean } = {}): Promise<{
    synced: number;
    added: number;
    updated: number;
    deletedMarked: number;
    castIdWrittenBack: number;
    errors: number;
}> {
    const writeCastIdBack = opts.writeCastIdBack !== false; // デフォルト ON
    const token = process.env.NOTION_TOKEN;
    const databaseId = process.env.NOTION_CAST_DATABASE_ID;
    if (!token || !databaseId) {
        throw new HttpsError("failed-precondition", "NOTION_TOKEN / NOTION_CAST_DATABASE_ID secret が未設定です");
    }

    const notion = new Client({ auth: token });
    const db = admin.firestore();

    // 既存 casts: 名前 → docId, 既存 max 番号
    const allCasts = await db.collection("casts").get();
    const nameToDocId = new Map<string, string>();
    let maxNum = 0;
    for (const d of allCasts.docs) {
        const data = d.data();
        const name = (data.name as string) || "";
        if (name && !nameToDocId.has(name)) nameToDocId.set(name, d.id);
        const m = d.id.match(/^cast_(\d+)$/);
        if (m && m[1]) {
            const n = parseInt(m[1], 10);
            if (!isNaN(n) && n > maxNum) maxNum = n;
        }
    }

    let synced = 0;
    let added = 0;
    let updated = 0;
    let errors = 0;
    let castIdWrittenBack = 0;
    const incomingCastIds = new Set<string>();

    let cursor: string | undefined = undefined;
    do {
        const resp: any = await notion.databases.query({
            database_id: databaseId,
            start_cursor: cursor,
            page_size: 100,
        });
        cursor = resp.has_more ? resp.next_cursor : undefined;
        for (const page of (resp.results || []) as NotionPageMinimal[]) {
            try {
                if (page.archived) continue;
                const props = page.properties;
                const name = readTitle(props, "名前").trim();
                if (!name) continue; // 名前なしはスキップ

                let castId = readRich(props, "CastID").trim();
                let needWriteBack = false;
                if (!castId) {
                    // 名前で既存 casts を探す
                    const existing = nameToDocId.get(name);
                    if (existing && /^cast_\d+$/.test(existing)) {
                        castId = existing;
                        needWriteBack = true; // 既存に紐付ける CastID を Notion に書き戻す
                    } else {
                        // 新規採番
                        castId = nextCastId(maxNum);
                        maxNum++;
                        needWriteBack = true;
                    }
                }
                incomingCastIds.add(castId);

                const { memo, hasMemo } = buildMemo(props);
                const docRef = db.collection("casts").doc(castId);
                const existingDoc = await docRef.get();
                const updateData: Record<string, unknown> = {
                    name,
                    furigana: readRich(props, "ふりがな"),
                    gender: readSelect(props, "性別"),
                    dateOfBirth: readDate(props, "生年月日"),
                    snsX: readUrl(props, "X(Twitter)"),
                    snsInstagram: readUrl(props, "Instagram"),
                    snsTikTok: readUrl(props, "TikTok"),
                    imageUrl: readFileUrl(props, "アイコン_Gドライブリンク"),
                    agency: readRollupString(props, "事務所"),
                    notionPageId: page.id,
                    memo,
                    hasMemo,
                    syncSource: "notion-cf",
                    deleted: false,
                    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
                };
                if (!existingDoc.exists) {
                    updateData.castType = "外部";
                    updateData.createdAt = admin.firestore.FieldValue.serverTimestamp();
                    added++;
                } else {
                    updated++;
                }
                await docRef.set(updateData, { merge: true });
                // name → docId マップに登録（同一バッチ内で重複検知防止）
                if (!nameToDocId.has(name)) nameToDocId.set(name, castId);
                synced++;

                // Notion 側に CastID を書き戻す
                if (needWriteBack && writeCastIdBack) {
                    try {
                        await notion.pages.update({
                            page_id: page.id,
                            properties: {
                                "CastID": {
                                    rich_text: [{ type: "text", text: { content: castId } }],
                                },
                            },
                        } as any);
                        castIdWrittenBack++;
                    } catch (e) {
                        console.warn(`[syncCastsFromNotion] CastID write-back failed for ${name}:`, e);
                    }
                }
            } catch (e) {
                console.error("[syncCastsFromNotion] page error:", e);
                errors++;
            }
        }
    } while (cursor);

    // 削除検知: 同期時に存在しなかった cast_NNNNN を deleted:true マーク
    let deletedMarked = 0;
    try {
        const all = await db.collection("casts").get();
        const toMark: FirebaseFirestore.DocumentReference[] = [];
        for (const d of all.docs) {
            if (!/^cast_\d+$/.test(d.id)) continue; // cast_NNNNN 以外は対象外
            if (incomingCastIds.has(d.id)) continue;
            const sd = d.data();
            if (sd.deleted === true) continue;
            toMark.push(d.ref);
        }
        for (let i = 0; i < toMark.length; i += 500) {
            const chunk = toMark.slice(i, i + 500);
            const batch = db.batch();
            for (const r of chunk) {
                batch.update(r, {
                    deleted: true,
                    deletedAt: admin.firestore.FieldValue.serverTimestamp(),
                });
            }
            await batch.commit();
            deletedMarked += chunk.length;
        }
    } catch (e) {
        console.error("[syncCastsFromNotion] deletion detection error:", e);
    }

    console.log(
        `[syncCastsFromNotion] synced=${synced} added=${added} updated=${updated} deletedMarked=${deletedMarked} writeBack=${castIdWrittenBack} errors=${errors}`
    );
    return { synced, added, updated, deletedMarked, castIdWrittenBack, errors };
}

export const syncCastsFromNotion = onCall(
    {
        region: "asia-northeast1",
        secrets: ["NOTION_TOKEN", "NOTION_CAST_DATABASE_ID"],
        memory: "512MiB",
        timeoutSeconds: 540,
        maxInstances: 1,
    },
    async (req) => {
        try {
            const writeCastIdBack = req.data?.writeCastIdBack !== false;
            const r = await performSync({ writeCastIdBack });
            return { success: true, ...r };
        } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            throw new HttpsError("internal", "Cast sync failed: " + msg);
        }
    }
);

export const scheduledSyncCastsFromNotion = onSchedule(
    {
        schedule: "every 6 hours",
        timeZone: "Asia/Tokyo",
        secrets: ["NOTION_TOKEN", "NOTION_CAST_DATABASE_ID"],
        memory: "512MiB",
        timeoutSeconds: 540,
        maxInstances: 1,
    },
    async () => {
        try {
            const r = await performSync({ writeCastIdBack: true });
            console.log(`[scheduledSyncCastsFromNotion] Done synced=${r.synced} errors=${r.errors}`);
        } catch (e) {
            console.error("[scheduledSyncCastsFromNotion] Error:", e);
        }
    }
);
