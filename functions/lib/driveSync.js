"use strict";
/**
 * Cloud Functions - オフショットDriveリンクの同期
 *
 * GASがオフショットDriveスプレッドシートから offshotDrive コレクションに同期したデータを
 * shootingContacts の makingUrl に反映する
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
 * offshotDrive コレクションから NotionPageID でDriveリンクを取得し、
 * 対応する shootingContacts の makingUrl を更新する
 */
exports.syncDriveLinksToContacts = (0, https_1.onCall)({ maxInstances: 10 }, async (request) => {
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
            // Look up drive link
            const driveSnap = await db
                .collection("offshotDrive")
                .where("notionPageId", "==", normalizedId)
                .limit(1)
                .get();
            if (driveSnap.empty) {
                return { success: false, message: "No drive link found" };
            }
            const driveLink = driveSnap.docs[0].data().driveLink;
            // Update shooting contact
            await db
                .collection("shootingContacts")
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
            // Get drive link
            const driveSnap = await db
                .collection("offshotDrive")
                .where("notionPageId", "==", normalizedId)
                .limit(1)
                .get();
            if (driveSnap.empty) {
                return { success: false, message: "No drive link found" };
            }
            const driveLink = driveSnap.docs[0].data().driveLink;
            // Find matching shooting contacts
            let contactsQuery = db.collection("shootingContacts");
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
        // Process all offshotDrive entries and update matching contacts
        const allDriveSnap = await db.collection("offshotDrive").get();
        if (allDriveSnap.empty) {
            return { success: true, updated: 0, message: "No drive links in Firestore" };
        }
        // Build notionPageId -> driveLink map
        const driveLinkMap = new Map();
        allDriveSnap.docs.forEach((doc) => {
            const d = doc.data();
            if (d.notionPageId && d.driveLink) {
                driveLinkMap.set(d.notionPageId, d.driveLink);
            }
        });
        // Get all contacts missing makingUrl
        const allContactsSnap = await db
            .collection("shootingContacts")
            .where("makingUrl", "==", "")
            .get();
        // Also get contacts where makingUrl doesn't exist
        const nullContactsSnap = await db
            .collection("shootingContacts")
            .where("makingUrl", "==", null)
            .get();
        const allContacts = [...allContactsSnap.docs, ...nullContactsSnap.docs];
        const batch = db.batch();
        let totalUpdated = 0;
        // For each contact, try to find castings -> projectId -> driveLink
        for (const contactDoc of allContacts) {
            const contact = contactDoc.data();
            if (!contact.castingId)
                continue;
            // Get the original casting to find projectId
            const castingDoc = await db
                .collection("castings")
                .doc(contact.castingId)
                .get();
            if (!castingDoc.exists)
                continue;
            const casting = castingDoc.data();
            const projectId = casting?.projectId;
            if (!projectId)
                continue;
            const normalizedProjectId = projectId.replace(/-/g, "").toLowerCase();
            const driveLink = driveLinkMap.get(normalizedProjectId);
            if (driveLink) {
                batch.update(contactDoc.ref, {
                    makingUrl: driveLink,
                    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
                });
                totalUpdated++;
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