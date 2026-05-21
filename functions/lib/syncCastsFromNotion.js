"use strict";
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
exports.scheduledSyncCastsFromNotion = exports.syncCastsFromNotion = void 0;
/**
 * Cloud Functions - Notion キャスト DB → Firestore casts コレクションへ同期
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
 *   CastID (rich_text)           → cast.id 解決キー (cast_NNNNN)
 *   X(Twitter) (url)             → snsX
 *   Instagram (url)              → snsInstagram
 *   TikTok (url)                 → snsTikTok
 *   特記 4 フィールド (rich_text):
 *     備考欄 / アレルギー / 金額_特記事項 / NG・制限事項
 *       → casts.memo に集約（ラベル付き）
 *       → casts.hasMemo = true（ポップアップトリガー用）
 *
 * docId の解決順:
 *   1. CastID プロパティが入っていればそれを docId に
 *   2. 既存 casts コレクションを名前で完全一致検索して見つかればそれを使う
 *   3. それでも無ければ Notion page_id をサニタイズした文字列を新規 docId に
 */
const https_1 = require("firebase-functions/v2/https");
const scheduler_1 = require("firebase-functions/v2/scheduler");
const admin = __importStar(require("firebase-admin"));
const client_1 = require("@notionhq/client");
function readTitle(props, key) {
    const p = props[key];
    if (p?.title && Array.isArray(p.title))
        return p.title.map(t => t.plain_text || "").join("");
    return "";
}
function readRich(props, key) {
    const p = props[key];
    if (p?.rich_text && Array.isArray(p.rich_text))
        return p.rich_text.map(t => t.plain_text || "").join("");
    return "";
}
function readSelect(props, key) {
    const p = props[key];
    return p?.select?.name || "";
}
function readUrl(props, key) {
    const p = props[key];
    return p?.url || "";
}
function readDate(props, key) {
    const p = props[key];
    return p?.date?.start ? p.date.start.substring(0, 10) : "";
}
function buildMemo(props) {
    const fields = [
        { label: "NG・制限事項", key: "NG・制限事項" },
        { label: "アレルギー", key: "アレルギー" },
        { label: "金額_特記事項", key: "金額_特記事項" },
        { label: "備考欄", key: "備考欄" },
    ];
    const lines = [];
    for (const f of fields) {
        const v = readRich(props, f.key).trim();
        if (v)
            lines.push(`【${f.label}】\n${v}`);
    }
    const memo = lines.join("\n\n");
    return { memo, hasMemo: memo.length > 0 };
}
async function performSync() {
    const token = process.env.NOTION_TOKEN;
    const databaseId = process.env.NOTION_CAST_DATABASE_ID;
    if (!token || !databaseId) {
        throw new https_1.HttpsError("failed-precondition", "NOTION_TOKEN / NOTION_CAST_DATABASE_ID secret が未設定です");
    }
    const notion = new client_1.Client({ auth: token });
    const db = admin.firestore();
    // 既存 casts を名前 → docId のマップに（CastID 無しキャストの fallback マッチ用）
    const allCasts = await db.collection("casts").get();
    const nameToDocId = new Map();
    for (const d of allCasts.docs) {
        const data = d.data();
        const name = data.name || "";
        if (name && !nameToDocId.has(name))
            nameToDocId.set(name, d.id);
    }
    let synced = 0;
    let added = 0;
    let updated = 0;
    let errors = 0;
    let cursor = undefined;
    do {
        const resp = await notion.databases.query({
            database_id: databaseId,
            start_cursor: cursor,
            page_size: 100,
        });
        cursor = resp.has_more ? resp.next_cursor : undefined;
        for (const page of (resp.results || [])) {
            try {
                if (page.archived)
                    continue;
                const props = page.properties;
                const name = readTitle(props, "名前").trim();
                if (!name)
                    continue; // 名前が無いとどうしようもない
                const castId = readRich(props, "CastID").trim();
                let docId = castId;
                if (!docId) {
                    docId = nameToDocId.get(name) || "";
                }
                if (!docId) {
                    // 新規 doc id (notion page id を流用)
                    docId = "notion_" + page.id.replace(/-/g, "");
                }
                const furigana = readRich(props, "ふりがな");
                const gender = readSelect(props, "性別");
                const dateOfBirth = readDate(props, "生年月日");
                const snsX = readUrl(props, "X(Twitter)");
                const snsInstagram = readUrl(props, "Instagram");
                const snsTikTok = readUrl(props, "TikTok");
                const { memo, hasMemo } = buildMemo(props);
                const existing = await db.collection("casts").doc(docId).get();
                const updateData = {
                    name,
                    furigana,
                    gender,
                    dateOfBirth,
                    snsX,
                    snsInstagram,
                    snsTikTok,
                    notionPageId: page.id,
                    memo,
                    hasMemo,
                    syncSource: "notion-cast",
                    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
                };
                if (!existing.exists) {
                    // 新規時は castType を 外部 デフォルトに
                    updateData.castType = "外部";
                    added++;
                }
                else {
                    updated++;
                }
                await db.collection("casts").doc(docId).set(updateData, { merge: true });
                synced++;
            }
            catch (e) {
                console.error("[syncCastsFromNotion] page error:", e);
                errors++;
            }
        }
    } while (cursor);
    console.log(`[syncCastsFromNotion] synced=${synced} added=${added} updated=${updated} errors=${errors}`);
    return { synced, added, updated, errors };
}
exports.syncCastsFromNotion = (0, https_1.onCall)({
    region: "asia-northeast1",
    secrets: ["NOTION_TOKEN", "NOTION_CAST_DATABASE_ID"],
    memory: "512MiB",
    timeoutSeconds: 540,
    maxInstances: 1,
}, async () => {
    try {
        const r = await performSync();
        return { success: true, ...r };
    }
    catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        throw new https_1.HttpsError("internal", "Cast sync failed: " + msg);
    }
});
exports.scheduledSyncCastsFromNotion = (0, scheduler_1.onSchedule)({
    schedule: "every 6 hours",
    timeZone: "Asia/Tokyo",
    secrets: ["NOTION_TOKEN", "NOTION_CAST_DATABASE_ID"],
    memory: "512MiB",
    timeoutSeconds: 540,
    maxInstances: 1,
}, async () => {
    try {
        const r = await performSync();
        console.log(`[scheduledSyncCastsFromNotion] Done synced=${r.synced} errors=${r.errors}`);
    }
    catch (e) {
        console.error("[scheduledSyncCastsFromNotion] Error:", e);
    }
});
//# sourceMappingURL=syncCastsFromNotion.js.map