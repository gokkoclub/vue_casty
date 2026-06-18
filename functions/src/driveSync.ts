/**
 * Cloud Functions - オフショットDriveリンクの同期
 *
 * 参照元: projects.driveFolderUrl（Notion 直接同期 CF が更新する稼働中のソース）を
 * castings.makingUrl に反映する。
 * ※ 旧 offshotDrive (GAS スプレッドシート同期) は 2026-05 に停止したため使用しない。
 */

import { onCall, HttpsError } from "firebase-functions/v2/https";
import * as admin from "firebase-admin";

/**
 * projects ドキュメントからオフショットフォルダ URL を取り出す。
 * makingUrl は「オフショットフォルダ」を指すべきなので offshotUrl を使う
 * （driveFolderUrl は案件ルートフォルダなので使わない）。
 * offshotUrl は syncOffshotFileCounts が空のとき自動補完する。
 */
function projectDriveLink(data: admin.firestore.DocumentData | undefined): string | undefined {
    if (!data) return undefined;
    return (data.offshotUrl as string) || undefined;
}

/**
 * offshotDrive コレクションから NotionPageID でDriveリンクを取得し、
 * 対応する shootingContacts の makingUrl を更新する
 */
export const syncDriveLinksToContacts = onCall(
    { maxInstances: 10, region: "asia-northeast1", memory: "512MiB", timeoutSeconds: 120 },
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
                let contactsQuery: admin.firestore.Query = db.collection("castings");
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
            const driveLinkMap = new Map<string, string>();
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
                if (contact.makingUrl && contact.makingUrl.trim() !== "") continue;

                let driveLink: string | undefined;

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
