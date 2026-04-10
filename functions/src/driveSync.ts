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
    { maxInstances: 10, cors: true, region: "asia-northeast1" },
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
            // 複数の正規化形式でマッチできるよう、元のID・ハイフン除去・小文字の全パターンを登録
            const driveLinkMap = new Map<string, string>();
            allDriveSnap.docs.forEach((doc) => {
                const d = doc.data();
                if (d.notionPageId && d.driveLink) {
                    const raw = d.notionPageId;
                    driveLinkMap.set(raw, d.driveLink);
                    driveLinkMap.set(raw.replace(/-/g, "").toLowerCase(), d.driveLink);
                    driveLinkMap.set(raw.toLowerCase(), d.driveLink);
                }
            });

            // 全shootingContactsを取得（makingUrlフィールドが未設定、空、null のケースを網羅）
            const allContactsSnap = await db.collection("shootingContacts").get();

            const batch = db.batch();
            let totalUpdated = 0;
            const batchLimit = 500;

            for (const contactDoc of allContactsSnap.docs) {
                const contact = contactDoc.data();
                // 既にmakingUrlが設定されているものはスキップ
                if (contact.makingUrl && contact.makingUrl.trim() !== "") continue;

                let driveLink: string | undefined;

                // 方法1: shootingContactsのnotionIdで直接マッチ
                if (contact.notionId) {
                    const normalizedNotionId = contact.notionId.replace(/-/g, "").toLowerCase();
                    driveLink = driveLinkMap.get(normalizedNotionId);
                }

                // 方法2: notionIdがなければ castingId → casting.projectId でマッチ
                if (!driveLink && contact.castingId) {
                    try {
                        const castingDoc = await db
                            .collection("castings")
                            .doc(contact.castingId)
                            .get();

                        if (castingDoc.exists) {
                            const casting = castingDoc.data();
                            const projectId = casting?.projectId;
                            if (projectId) {
                                const normalizedProjectId = projectId.replace(/-/g, "").toLowerCase();
                                driveLink = driveLinkMap.get(normalizedProjectId);
                            }
                        }
                    } catch (e) {
                        console.warn(`Failed to lookup casting ${contact.castingId}:`, e);
                    }
                }

                if (driveLink) {
                    batch.update(contactDoc.ref, {
                        makingUrl: driveLink,
                        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
                    });
                    totalUpdated++;

                    // Firestoreバッチは500件まで
                    if (totalUpdated >= batchLimit) break;
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
