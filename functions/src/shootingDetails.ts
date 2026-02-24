/**
 * Cloud Functions - 香盤DB (shootingDetails) からIN/OUT/場所情報を取得
 *
 * GASが香盤DBスプレッドシートから shootingDetails コレクションに同期済みデータを
 * Vueアプリから利用するためのCloud Function
 */

import { onCall, HttpsError } from "firebase-functions/v2/https";
import * as admin from "firebase-admin";

/**
 * shootingDetails コレクションからキャスト名 or NotionPageID で検索し、
 * IN/OUT/場所/住所を返す。
 * オプションで shootingContacts に自動書き込みも可能。
 */
export const getShootingDetails = onCall(
    { maxInstances: 10 },
    async (request) => {
        const data = request.data;

        if (!data) {
            throw new HttpsError("invalid-argument", "Request data is required");
        }

        const { castName, notionPageId, shootingContactId } = data;

        if (!castName && !notionPageId) {
            throw new HttpsError(
                "invalid-argument",
                "castName or notionPageId is required"
            );
        }

        const db = admin.firestore();

        try {
            // Query shootingDetails
            let query: admin.firestore.Query = db.collection("shootingDetails");

            if (notionPageId) {
                // Normalize page ID (remove dashes)
                const normalizedId = notionPageId.replace(/-/g, "").toLowerCase();
                query = query.where("notionPageId", "==", normalizedId);
            } else if (castName) {
                query = query.where("castName", "==", castName);
            }

            const snapshot = await query.get();

            if (snapshot.empty) {
                return {
                    found: false,
                    details: [],
                    message: "No shooting details found",
                };
            }

            const details = snapshot.docs.map((doc) => ({
                id: doc.id,
                ...doc.data(),
            }));

            // If shootingContactId is provided, auto-update the shooting contact
            if (shootingContactId && details.length > 0) {
                const detail = details[0] as {
                    inTime?: string;
                    outTime?: string;
                    location?: string;
                    address?: string;
                };

                const updateData: Record<string, string | admin.firestore.FieldValue> = {};
                if (detail.inTime) updateData.inTime = detail.inTime;
                if (detail.outTime) updateData.outTime = detail.outTime;
                if (detail.location) updateData.location = detail.location;
                if (detail.address) updateData.address = detail.address;
                updateData.updatedAt = admin.firestore.FieldValue.serverTimestamp();

                await db
                    .collection("shootingContacts")
                    .doc(shootingContactId)
                    .update(updateData);
            }

            return {
                found: true,
                details,
                count: details.length,
            };
        } catch (error) {
            console.error("Error fetching shooting details:", error);
            throw new HttpsError("internal", "Failed to fetch shooting details");
        }
    }
);

/**
 * 指定されたキャスティングIDのすべての shootingContacts に
 * shootingDetails の IN/OUT/場所 を一括反映する
 */
export const syncShootingDetailsToContacts = onCall(
    { maxInstances: 10 },
    async (request) => {
        const data = request.data;

        if (!data || !data.notionPageId) {
            throw new HttpsError(
                "invalid-argument",
                "notionPageId is required"
            );
        }

        const db = admin.firestore();
        const normalizedPageId = data.notionPageId.replace(/-/g, "").toLowerCase();

        try {
            // 1. Get all shooting details for this project
            const detailsSnap = await db
                .collection("shootingDetails")
                .where("notionPageId", "==", normalizedPageId)
                .get();

            if (detailsSnap.empty) {
                return { success: true, updated: 0, message: "No details found" };
            }

            // Normalize cast name: strip 様/さん/サン suffix and trim
            const normalizeCastName = (name: string): string =>
                name.replace(/[様さんサン]+$/u, "").trim();

            // Build normalized castName -> details map
            const detailsMap = new Map<
                string,
                { inTime: string; outTime: string; location: string; address: string }
            >();
            detailsSnap.docs.forEach((doc) => {
                const d = doc.data();
                if (d.castName) {
                    detailsMap.set(normalizeCastName(d.castName), {
                        inTime: d.inTime || "",
                        outTime: d.outTime || "",
                        location: d.location || "",
                        address: d.address || "",
                    });
                }
            });

            // 2. Get shooting contacts that need updating
            const contactsSnap = await db
                .collection("shootingContacts")
                .where("projectName", "==", data.projectName || "")
                .get();

            let updateCount = 0;
            const batch = db.batch();

            contactsSnap.docs.forEach((doc) => {
                const contact = doc.data();
                // Normalize contact castName too for matching
                const detail = detailsMap.get(normalizeCastName(contact.castName || ""));
                if (!detail) return;

                const updateData: Record<string, string | admin.firestore.FieldValue> = {};
                let hasUpdate = false;

                if (detail.inTime && !contact.inTime) {
                    updateData.inTime = detail.inTime;
                    hasUpdate = true;
                }
                if (detail.outTime && !contact.outTime) {
                    updateData.outTime = detail.outTime;
                    hasUpdate = true;
                }
                if (detail.location && !contact.location) {
                    updateData.location = detail.location;
                    hasUpdate = true;
                }
                if (detail.address && !contact.address) {
                    updateData.address = detail.address;
                    hasUpdate = true;
                }

                if (hasUpdate) {
                    updateData.updatedAt = admin.firestore.FieldValue.serverTimestamp();
                    batch.update(doc.ref, updateData);
                    updateCount++;
                }
            });

            if (updateCount > 0) {
                await batch.commit();
            }

            return { success: true, updated: updateCount };
        } catch (error) {
            console.error("Error syncing shooting details:", error);
            throw new HttpsError("internal", "Failed to sync shooting details");
        }
    }
);
