"use strict";
/**
 * Cloud Functions - オフショットDriveリンクの同期
 *
 * 参照元: projects.driveFolderUrl（Notion 直接同期 CF が更新する稼働中のソース）を
 * castings.makingUrl に反映する。
 * ※ 旧 offshotDrive (GAS スプレッドシート同期) は 2026-05 に停止したため使用しない。
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
exports.syncDriveLinksToContacts = void 0;
const https_1 = require("firebase-functions/v2/https");
const admin = __importStar(require("firebase-admin"));
/**
 * projects ドキュメントからオフショットフォルダ URL を取り出す。
 * makingUrl は「オフショットフォルダ」を指すべきなので offshotUrl を使う
 * （driveFolderUrl は案件ルートフォルダなので使わない）。
 * offshotUrl は syncOffshotFileCounts が空のとき自動補完する。
 */
function projectDriveLink(data) {
    if (!data)
        return undefined;
    return data.offshotUrl || undefined;
}
/**
 * offshotDrive コレクションから NotionPageID でDriveリンクを取得し、
 * 対応する shootingContacts の makingUrl を更新する
 */
exports.syncDriveLinksToContacts = (0, https_1.onCall)({ maxInstances: 10, region: "asia-northeast1", memory: "512MiB", timeoutSeconds: 120 }, async (request) => {
    const data = request.data;
    if (!data) {
        throw new https_1.HttpsError("invalid-argument", "Request data is required");
    }
    const { notionPageId, projectName, shootingContactId } = data;
    const db = admin.firestore();
    try {
        // === Mode 1: Single contact update ===
        if (shootingContactId && notionPageId) {
            const normalizedId = notionPageId.replace(/-/g, "").toLowerCase();
            // projects の doc id はハイフン無し notion page id
            const projDoc = await db.collection("projects").doc(normalizedId).get();
            const driveLink = projectDriveLink(projDoc.data());
            if (!driveLink) {
                return { success: false, message: "No drive link found" };
            }
            // Update shooting contact
            await db
                .collection("castings")
                .doc(shootingContactId)
                .update({
                makingUrl: driveLink,
                updatedAt: admin.firestore.FieldValue.serverTimestamp(),
            });
            return { success: true, driveLink };
        }
        // === Mode 2: Batch update by Notion Page ID ===
        if (notionPageId) {
            const normalizedId = notionPageId.replace(/-/g, "").toLowerCase();
            // projects から drive link を取得
            const projDoc = await db.collection("projects").doc(normalizedId).get();
            const driveLink = projectDriveLink(projDoc.data());
            if (!driveLink) {
                return { success: false, message: "No drive link found" };
            }
            // Find matching shooting contacts
            let contactsQuery = db.collection("castings");
            if (projectName) {
                contactsQuery = contactsQuery.where("projectName", "==", projectName);
            }
            const contactsSnap = await contactsQuery.get();
            const batch = db.batch();
            let updateCount = 0;
            contactsSnap.docs.forEach((doc) => {
                const contact = doc.data();
                // Only update contacts that don't have makingUrl yet
                if (!contact.makingUrl) {
                    batch.update(doc.ref, {
                        makingUrl: driveLink,
                        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
                    });
                    updateCount++;
                }
            });
            if (updateCount > 0) {
                await batch.commit();
            }
            return { success: true, driveLink, updated: updateCount };
        }
        // === Mode 3: Sync ALL drive links ===
        // Process all projects entries and update matching contacts
        const allProjectsSnap = await db.collection("projects").get();
        if (allProjectsSnap.empty) {
            return { success: true, updated: 0, message: "No projects in Firestore" };
        }
        // Build normalized projectId -> driveLink map
        // projects の doc id はハイフン無し notion page id
        const driveLinkMap = new Map();
        allProjectsSnap.docs.forEach((doc) => {
            const driveLink = projectDriveLink(doc.data());
            if (driveLink) {
                driveLinkMap.set(doc.id.replace(/-/g, "").toLowerCase(), driveLink);
            }
        });
        // DB統合済み: castings コレクションから contactStatus が設定済みのものを取得
        const allContactsSnap = await db.collection("castings")
            .where("contactStatus", "!=", null)
            .get();
        const batch = db.batch();
        let totalUpdated = 0;
        const batchLimit = 500;
        for (const contactDoc of allContactsSnap.docs) {
            const contact = contactDoc.data();
            // 既にmakingUrlが設定されているものはスキップ
            if (contact.makingUrl && contact.makingUrl.trim() !== "")
                continue;
            let driveLink;
            // castings.projectId で直接マッチ（統合済みなので間接参照不要）
            if (contact.projectId) {
                const normalizedProjectId = contact.projectId.replace(/-/g, "").toLowerCase();
                driveLink = driveLinkMap.get(normalizedProjectId);
            }
            if (driveLink) {
                batch.update(contactDoc.ref, {
                    makingUrl: driveLink,
                    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
                });
                totalUpdated++;
                // Firestoreバッチは500件まで
                if (totalUpdated >= batchLimit)
                    break;
            }
        }
        if (totalUpdated > 0) {
            await batch.commit();
        }
        return { success: true, updated: totalUpdated };
    }
    catch (error) {
        console.error("Error syncing drive links:", error);
        throw new https_1.HttpsError("internal", "Failed to sync drive links");
    }
});
//# sourceMappingURL=driveSync.js.map