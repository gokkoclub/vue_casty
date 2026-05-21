"use strict";
/**
 * =========================================================================
 * automation/_helpers.ts
 * 香盤SS→Firestore→CF 連携の共通ヘルパー
 *
 * - 名前 → email 解決 (casts → staffMentions フォールバック)
 * - 名前 → slackMentionId 解決 (staffMentions → casts → admin)
 * - team → calendarId 解決 (calendarConfig、無ければ新規作成)
 * - 名前正規化
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
exports.normalizeName = normalizeName;
exports.clearStaffMentionsCache = clearStaffMentionsCache;
exports.resolveEmailByName = resolveEmailByName;
exports.resolveEmailsByNames = resolveEmailsByNames;
exports.resolveSlackMentionByName = resolveSlackMentionByName;
exports.resolveSlackMentionsByNames = resolveSlackMentionsByNames;
exports.buildCalendarClient = buildCalendarClient;
exports.getOrCreateCalendarId = getOrCreateCalendarId;
exports.simpleHash = simpleHash;
const admin = __importStar(require("firebase-admin"));
const googleapis_1 = require("googleapis");
/** 名前正規化(空白・敬称除去・小文字化) */
function normalizeName(name) {
    if (!name)
        return "";
    return String(name)
        .normalize("NFKC")
        .replace(/\s+/g, "")
        .replace(/[\u3000]/g, "")
        .replace(/(様|さま|さん|殿|氏|ちゃん|君|くん)$/u, "")
        .trim()
        .toLowerCase();
}
let _staffMentionsCache = null;
let _staffMentionsCacheAt = 0;
const STAFF_MENTIONS_TTL_MS = 5 * 60 * 1000;
async function getStaffMentionsCached() {
    const now = Date.now();
    if (_staffMentionsCache && now - _staffMentionsCacheAt < STAFF_MENTIONS_TTL_MS) {
        return _staffMentionsCache;
    }
    const db = admin.firestore();
    const snap = await db.collection("staffMentions").get();
    const list = [];
    for (const doc of snap.docs) {
        const d = doc.data();
        if (d.active === false)
            continue;
        const names = [d.name, ...(Array.isArray(d.aliases) ? d.aliases : [])]
            .filter((s) => !!s && typeof s === "string");
        if (names.length === 0)
            continue;
        list.push({
            id: doc.id,
            name: d.name || "",
            email: d.email || "",
            slackMentionId: d.slackMentionId || "",
            names,
        });
    }
    _staffMentionsCache = list;
    _staffMentionsCacheAt = now;
    console.log(`[helpers] staffMentions cached: ${list.length} entries`);
    return list;
}
function clearStaffMentionsCache() {
    _staffMentionsCache = null;
    _staffMentionsCacheAt = 0;
}
/**
 * 名前から email を解決
 * 検索順: casts(name) → staffMentions(name/aliases、正規化一致)
 */
async function resolveEmailByName(name) {
    if (!name)
        return "";
    const trimmed = name.trim();
    const normalized = normalizeName(trimmed);
    const db = admin.firestore();
    // 1. casts コレクションから name==正確一致
    try {
        const s = await db.collection("casts").where("name", "==", trimmed).limit(1).get();
        if (!s.empty) {
            const email = s.docs[0].data().email;
            if (email)
                return email;
        }
    }
    catch (e) {
        console.warn("[resolveEmailByName] casts lookup failed:", e);
    }
    // 2. staffMentions から正規化一致 (name + aliases)
    try {
        const staff = await getStaffMentionsCached();
        for (const s of staff) {
            if (s.names.some(n => normalizeName(n) === normalized)) {
                if (s.email)
                    return s.email;
            }
        }
        // 部分一致(苗字のみ等のフォールバック)
        if (normalized.length >= 2) {
            for (const s of staff) {
                if (s.names.some(n => {
                    const nn = normalizeName(n);
                    return nn.includes(normalized) || normalized.includes(nn);
                })) {
                    if (s.email)
                        return s.email;
                }
            }
        }
    }
    catch (e) {
        console.warn("[resolveEmailByName] staffMentions lookup failed:", e);
    }
    return "";
}
/**
 * 名前配列 → email配列 (重複除外)
 */
async function resolveEmailsByNames(names) {
    const emails = [];
    const seen = new Set();
    for (const name of names) {
        if (!name || seen.has(name))
            continue;
        seen.add(name);
        const email = await resolveEmailByName(name);
        if (email && !emails.includes(email))
            emails.push(email);
    }
    return emails;
}
// ============================================================
// slackMentionId 解決 (staffMentions優先 → casts → admin)
// ============================================================
/**
 * 名前から slackMentionId を解決
 * 検索順: staffMentions(name/aliases) → casts(name) → admin(name)
 */
async function resolveSlackMentionByName(name) {
    if (!name)
        return "";
    const trimmed = name.trim();
    const normalized = normalizeName(trimmed);
    const db = admin.firestore();
    // 1. staffMentions から正規化一致
    try {
        const staff = await getStaffMentionsCached();
        for (const s of staff) {
            if (s.names.some(n => normalizeName(n) === normalized)) {
                if (s.slackMentionId)
                    return s.slackMentionId;
            }
        }
        if (normalized.length >= 2) {
            for (const s of staff) {
                if (s.names.some(n => {
                    const nn = normalizeName(n);
                    return nn.includes(normalized) || normalized.includes(nn);
                })) {
                    if (s.slackMentionId)
                        return s.slackMentionId;
                }
            }
        }
    }
    catch (e) {
        console.warn("[resolveSlackMentionByName] staffMentions failed:", e);
    }
    // 2. casts
    try {
        const s = await db.collection("casts").where("name", "==", trimmed).limit(1).get();
        if (!s.empty && s.docs[0].data().slackMentionId)
            return s.docs[0].data().slackMentionId;
    }
    catch (e) {
        console.warn("[resolveSlackMentionByName] casts failed:", e);
    }
    // 3. admin
    try {
        const s = await db.collection("admin").where("name", "==", trimmed).limit(1).get();
        if (!s.empty && s.docs[0].data().slackMentionId)
            return s.docs[0].data().slackMentionId;
    }
    catch (e) {
        console.warn("[resolveSlackMentionByName] admin failed:", e);
    }
    return "";
}
async function resolveSlackMentionsByNames(names) {
    const ids = [];
    const seen = new Set();
    for (const name of names) {
        if (!name || seen.has(name))
            continue;
        seen.add(name);
        const id = await resolveSlackMentionByName(name);
        if (id && !ids.includes(id))
            ids.push(id);
    }
    return ids;
}
// ============================================================
// calendarId 解決 (calendarConfig から、無ければ新規作成)
// ============================================================
function sanitizeCalendarDocId(team) {
    return String(team)
        .replace(/[\/\.]/g, "_")
        .replace(/^__/, "xx")
        .replace(/[\s()\(\)（\)]/g, "_")
        .replace(/_+/g, "_")
        .trim();
}
/**
 * serviceAccountKey(JSON文字列) から Calendar クライアントを作る
 * 既存 calendar.ts と同じパターン (Domain-Wide Delegation 設定済みのSA使用)
 */
function buildCalendarClient(serviceAccountKey) {
    const credentials = JSON.parse(serviceAccountKey);
    const auth = new googleapis_1.google.auth.GoogleAuth({
        credentials,
        scopes: ["https://www.googleapis.com/auth/calendar"],
    });
    return googleapis_1.google.calendar({ version: "v3", auth });
}
/**
 * team から calendarId を取得。無ければ Google Calendar API で新規作成して保存。
 * calendarClient は 呼び出し側が serviceAccountKey から作ったものを渡す
 */
async function getOrCreateCalendarId(team, calendarClient) {
    if (!team)
        throw new Error("team is required");
    const db = admin.firestore();
    const docId = sanitizeCalendarDocId(team);
    const ref = db.collection("calendarConfig").doc(docId);
    const doc = await ref.get();
    if (doc.exists && doc.data()?.calendarId) {
        return doc.data().calendarId;
    }
    // 新規作成
    console.log(`[getOrCreateCalendarId] Creating new calendar for team: ${team}`);
    const res = await calendarClient.calendars.insert({
        requestBody: {
            summary: team,
            timeZone: "Asia/Tokyo",
        },
    });
    const calendarId = res.data.id;
    await ref.set({
        team,
        calendarId,
        source: "auto-created",
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });
    console.log(`[getOrCreateCalendarId] Created: ${team} → ${calendarId}`);
    return calendarId;
}
// ============================================================
// docId用の短いhash
// ============================================================
function simpleHash(s) {
    if (!s)
        return "0";
    let h = 0;
    for (let i = 0; i < s.length; i++) {
        h = ((h << 5) - h) + s.charCodeAt(i);
        h = h & h;
    }
    return Math.abs(h).toString(36);
}
//# sourceMappingURL=_helpers.js.map