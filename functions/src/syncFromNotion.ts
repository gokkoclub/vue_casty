/**
 * Cloud Functions - Notion DB から直接同期して shootings へ upsert
 *
 * 既存 syncFromSam (gokko-sam 経由) と並行運用する新フロー。
 *
 * 必要なシークレット:
 *   NOTION_TOKEN       - Notion Integration Token
 *   NOTION_DATABASE_ID - 撮影スケジュール DB の ID
 *
 * プロパティ名は環境変数 or デフォルトで以下を期待:
 *   PROP_TITLE   = "Title" / "名前" / "Name"  → shootings.title
 *   PROP_ACCOUNT = "アカウント"               → shootings.team   ★ 新規取得
 *   PROP_DATE    = "撮影日"                   → shootings.shootDate
 *   PROP_TEAM    = "撮影チーム"               → shootings.team へ fallback (アカウント空時)
 *
 * Staff entries はまだ取得しない（後続課題）。
 */
import { onCall, HttpsError } from "firebase-functions/v2/https";
import { onSchedule } from "firebase-functions/v2/scheduler";
import * as admin from "firebase-admin";
import { Client } from "@notionhq/client";

const PROP_TITLE_CANDIDATES = ["仮台本名", "タイトル", "Title", "名前", "Name", "作品名"];
const PROP_ACCOUNT_CANDIDATES = ["アカウント", "Account"];
const PROP_DATE_CANDIDATES = ["撮影日", "日付", "Date"];
const PROP_TEAM_CANDIDATES = ["撮影チーム", "チーム", "Team"];

function readTitleProp(props: Record<string, unknown>): string {
    for (const key of PROP_TITLE_CANDIDATES) {
        const p = props[key] as { title?: Array<{ plain_text?: string }> } | undefined;
        if (p?.title && Array.isArray(p.title) && p.title.length > 0) {
            return p.title.map(t => t.plain_text || "").join("");
        }
    }
    return "";
}

function readRichTextOrSelect(props: Record<string, unknown>, candidates: string[]): string {
    for (const key of candidates) {
        const p = props[key] as {
            rich_text?: Array<{ plain_text?: string }>;
            select?: { name?: string } | null;
            multi_select?: Array<{ name?: string }>;
            people?: Array<{ name?: string }>;
        } | undefined;
        if (!p) continue;
        if (p.rich_text && Array.isArray(p.rich_text) && p.rich_text.length > 0) {
            return p.rich_text.map(t => t.plain_text || "").join("");
        }
        if (p.select?.name) return p.select.name;
        if (p.multi_select && Array.isArray(p.multi_select) && p.multi_select.length > 0) {
            return p.multi_select.map(s => s.name || "").filter(Boolean).join(", ");
        }
        if (p.people && Array.isArray(p.people) && p.people.length > 0) {
            return p.people.map(s => s.name || "").filter(Boolean).join(", ");
        }
    }
    return "";
}

function readDateProp(props: Record<string, unknown>): string {
    for (const key of PROP_DATE_CANDIDATES) {
        const p = props[key] as { date?: { start?: string } } | undefined;
        if (p?.date?.start) return p.date.start.substring(0, 10); // YYYY-MM-DD
    }
    return "";
}

async function performSync(): Promise<{
    synced: number;
    added: number;
    updated: number;
    deletedMarked: number;
    restored: number;
    errors: number;
}> {
    const token = process.env.NOTION_TOKEN;
    const databaseId = process.env.NOTION_DATABASE_ID;
    if (!token || !databaseId) {
        throw new HttpsError("failed-precondition", "NOTION_TOKEN / NOTION_DATABASE_ID secret が未設定です");
    }

    const notion = new Client({ auth: token });
    const db = admin.firestore();

    let synced = 0;
    let added = 0;
    let updated = 0;
    let errors = 0;
    let restored = 0;
    const incomingNotionIds = new Set<string>();

    // ページネーション
    let cursor: string | undefined = undefined;
    do {
        const resp: any = await notion.databases.query({
            database_id: databaseId,
            start_cursor: cursor,
            page_size: 100,
        });
        cursor = resp.has_more ? resp.next_cursor : undefined;

        for (const page of (resp.results || []) as Array<{ id: string; properties: Record<string, unknown>; archived?: boolean }>) {
            try {
                if (page.archived) continue; // Notion 側でアーカイブされたら deleted 扱い（incomingNotionIds に入れない）
                const notionPageId = page.id; // ハイフン付き
                incomingNotionIds.add(notionPageId);

                const title = readTitleProp(page.properties);
                const account = readRichTextOrSelect(page.properties, PROP_ACCOUNT_CANDIDATES);
                const team = readRichTextOrSelect(page.properties, PROP_TEAM_CANDIDATES);
                const shootDate = readDateProp(page.properties);

                // スタッフ列（GAS 新香盤.gs と同じ Notion プロパティ名）。
                // オーダー時の CC 欄（CD/FD/P/衣装 メンション）が GAS 同期を待たず
                // Casty 自身の同期（2時間おき + 手動同期ボタン）で埋まるようにする。
                const cd = readRichTextOrSelect(page.properties, ["CD"]);
                const fd = readRichTextOrSelect(page.properties, ["FD/SD", "FD"]);
                const producer = readRichTextOrSelect(page.properties, ["P"]);
                const chiefProducer = readRichTextOrSelect(page.properties, ["制作チーフ"]);
                const six = readRichTextOrSelect(page.properties, ["SIX"]);
                const camera = readRichTextOrSelect(page.properties, ["カメラ"]);
                const costume = readRichTextOrSelect(page.properties, ["衣装"]);
                const hairMakeup = readRichTextOrSelect(page.properties, ["ヘアメイク"]);

                // shooting.team の値: アカウントが空でなければアカウント、空なら 撮影チーム
                const teamValue = account || team || "";

                const baseDocId = notionPageId.replace(/[/.]/g, "_").replace(/^__/, "xx").trim();
                if (!baseDocId) continue;

                const ref = db.collection("shootings").doc(baseDocId);
                const existing = await ref.get();
                const shootingData: Record<string, unknown> = {
                    title,
                    shootDate,
                    team: teamValue,
                    teamFromAccount: !!account, // 由来を追跡用に保存
                    notionPageId,
                    notionUrl: "https://www.notion.so/" + notionPageId.replace(/-/g, ""),
                    syncSource: "notion-direct",
                    deleted: false,
                    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
                };
                // スタッフ列は「値があるときのみ」上書き（GAS 等が入れた既存値を空で潰さない）
                if (cd) shootingData.cd = cd;
                if (fd) shootingData.fd = fd;
                if (producer) shootingData.producer = producer;
                if (chiefProducer) shootingData.chiefProducer = chiefProducer;
                if (six) shootingData.six = six;
                if (camera) shootingData.camera = camera;
                if (costume) shootingData.costume = costume;
                if (hairMakeup) shootingData.hairMakeup = hairMakeup;

                if (existing.exists) {
                    const existingData = existing.data();
                    const existingDate = (existingData?.shootDate as string) || "";
                    if (existingDate && shootDate && existingDate !== shootDate) {
                        shootingData.dateHistory = admin.firestore.FieldValue.arrayUnion({
                            from: existingDate,
                            to: shootDate,
                            changedAt: new Date(),
                        });
                    }
                    if (existingData?.deleted === true) restored++;
                    updated++;
                } else {
                    added++;
                }

                await ref.set(shootingData, { merge: true });
                synced++;
            } catch (e) {
                console.error("[syncFromNotion] page error:", e);
                errors++;
            }
        }
    } while (cursor);

    // 削除検知（Notion 側に無くなった notionPageId を deleted:true マーク）
    let deletedMarked = 0;
    try {
        const all = await db.collection("shootings").get();
        const toMark: FirebaseFirestore.DocumentReference[] = [];
        for (const s of all.docs) {
            const sd = s.data();
            const pageId = sd.notionPageId as string | undefined;
            if (!pageId) continue;
            if (!incomingNotionIds.has(pageId) && sd.deleted !== true) {
                toMark.push(s.ref);
            }
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
        console.error("[syncFromNotion] deletion detection error:", e);
    }

    console.log(
        `[syncFromNotion] synced=${synced} added=${added} updated=${updated} deletedMarked=${deletedMarked} restored=${restored} errors=${errors}`
    );
    return { synced, added, updated, deletedMarked, restored, errors };
}

/**
 * 手動実行（onCall）— UI から呼ぶ用
 */
export const syncFromNotion = onCall(
    {
        region: "asia-northeast1",
        secrets: ["NOTION_TOKEN", "NOTION_DATABASE_ID"],
        memory: "512MiB",
        timeoutSeconds: 300,
        maxInstances: 1,
    },
    async () => {
        try {
            const result = await performSync();
            return { success: true, ...result };
        } catch (e) {
            console.error("[syncFromNotion] Error:", e);
            const msg = e instanceof Error ? e.message : String(e);
            throw new HttpsError("internal", "Notion sync failed: " + msg);
        }
    }
);

/**
 * 定期実行（2 時間毎）— gokko-sam 経路と並行運用するため当面コメントアウト。
 * 動作確認後に有効化する。
 */
export const scheduledSyncFromNotion = onSchedule(
    {
        schedule: "every 2 hours",
        timeZone: "Asia/Tokyo",
        secrets: ["NOTION_TOKEN", "NOTION_DATABASE_ID"],
        memory: "512MiB",
        timeoutSeconds: 300,
        maxInstances: 1,
    },
    async () => {
        try {
            const r = await performSync();
            console.log(`[scheduledSyncFromNotion] Done synced=${r.synced} errors=${r.errors}`);
        } catch (e) {
            console.error("[scheduledSyncFromNotion] Error:", e);
        }
    }
);
