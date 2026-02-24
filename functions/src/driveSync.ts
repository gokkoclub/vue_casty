/**
 * Cloud Functions - オフショットDriveリンクの同期
 *
 * GASがオフショットDriveスプレッドシートから offshotDrive コレクションに同期したデータを
 * shootingContacts の makingUrl に反映する
 */

import { onCall, HttpsError } from "firebase-functions/v2/https";
import * as admin from "firebase-admin";

/**
 * offshotDrive コレクションから NotionPageID でDriveリンクを取得し、
 * 対応する shootingContacts の makingUrl を更新する
 */
export const syncDriveLinksToContacts = onCall(
    { maxInstances: 10 },
    async (request) => {
        const data = request.data;

        if (!data) {
            throw new HttpsError("invalid-argument", "Request data is required");
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

                const driveLink = driveSnap.docs[0]!.data().driveLink;

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

                const driveLink = driveSnap.docs[0]!.data().driveLink;

                // Find matching shooting contacts
                let contactsQuery: admin.firestore.Query = db.collection("shootingContacts");
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
            const driveLinkMap = new Map<string, string>();
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
                if (!contact.castingId) continue;

                // Get the original casting to find projectId
                const castingDoc = await db
                    .collection("castings")
                    .doc(contact.castingId)
                    .get();

                if (!castingDoc.exists) continue;

                const casting = castingDoc.data();
                const projectId = casting?.projectId;
                if (!projectId) continue;

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
        } catch (error) {
            console.error("Error syncing drive links:", error);
            throw new HttpsError("internal", "Failed to sync drive links");
        }
    }
);
