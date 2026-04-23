/**
 * =========================================================================
 * automation/retryCalendarAttendee.ts
 *
 * 10分おきに calendarAttendeePending: true の castings を scan し、GAS 経由で
 * attendee 追加を再試行する。成功したら pending フラグを削除。
 *
 * リトライ回数が MAX_RETRY_COUNT を超えたら諦める (手動で resendCalendarInvite を叩く)。
 * =========================================================================
 */

import { onSchedule } from "firebase-functions/v2/scheduler";
import * as admin from "firebase-admin";
import { addAttendeeViaGas } from "../gasCalendar";

const MAX_RETRY_COUNT = 6; // 10分 × 6 = 1時間で打ち切り
const BATCH_LIMIT = 50;

export const retryCalendarAttendee = onSchedule(
    {
        schedule: "every 10 minutes",
        timeZone: "Asia/Tokyo",
        maxInstances: 1,
        secrets: [
            "GOOGLE_CALENDAR_ID",
            "GAS_INVITE_WEBHOOK_URL",
            "GAS_INVITE_SHARED_SECRET",
        ],
    },
    async () => {
        const db = admin.firestore();
        const calendarId = process.env.GOOGLE_CALENDAR_ID || "";
        const gasWebhookUrl = process.env.GAS_INVITE_WEBHOOK_URL || "";
        const gasSharedSecret = process.env.GAS_INVITE_SHARED_SECRET || "";

        if (!calendarId || !gasWebhookUrl || !gasSharedSecret) {
            console.warn("[retryCalendarAttendee] missing config, skip");
            return;
        }

        const snap = await db.collection("castings")
            .where("calendarAttendeePending", "==", true)
            .limit(BATCH_LIMIT)
            .get();

        if (snap.empty) {
            console.log("[retryCalendarAttendee] no pending attendees");
            return;
        }

        console.log(`[retryCalendarAttendee] found ${snap.size} pending`);

        let okCount = 0;
        let failCount = 0;
        let giveUpCount = 0;

        for (const doc of snap.docs) {
            const c = doc.data();
            const retryCount: number = typeof c.calendarAttendeeRetryCount === "number"
                ? c.calendarAttendeeRetryCount
                : 0;

            if (retryCount >= MAX_RETRY_COUNT) {
                giveUpCount++;
                continue; // 手動 resendCalendarInvite 待ち
            }

            if (!c.calendarEventId) {
                // イベントそのものが無い → pending フラグが付いているのは整合性がおかしい。スキップしてフラグだけ整える。
                await doc.ref.update({
                    calendarAttendeePending: admin.firestore.FieldValue.delete(),
                    calendarAttendeeLastError: "calendarEventId missing at retry time",
                });
                continue;
            }

            // cast email を引く
            let castEmail = "";
            if (c.castId) {
                const castDoc = await db.collection("casts").doc(c.castId).get();
                if (castDoc.exists) castEmail = castDoc.data()?.email || "";
            }
            if (!castEmail) {
                await doc.ref.update({
                    calendarAttendeeRetryCount: retryCount + 1,
                    calendarAttendeeLastError: "cast email missing",
                });
                failCount++;
                continue;
            }

            const gasRes = await addAttendeeViaGas({
                webhookUrl: gasWebhookUrl,
                secret: gasSharedSecret,
                calendarId,
                eventId: c.calendarEventId,
                attendeeEmail: castEmail,
            });

            if (gasRes.ok) {
                await doc.ref.update({
                    calendarAttendeePending: admin.firestore.FieldValue.delete(),
                    calendarAttendeeLastError: admin.firestore.FieldValue.delete(),
                    calendarAttendeeRetryCount: admin.firestore.FieldValue.delete(),
                });
                okCount++;
                console.log(`[retryCalendarAttendee] ok casting=${doc.id} cast=${c.castName} attempt=${retryCount + 1}${gasRes.skipped ? " skipped=" + gasRes.skipped : ""}`);
            } else {
                await doc.ref.update({
                    calendarAttendeeRetryCount: retryCount + 1,
                    calendarAttendeeLastError: gasRes.error || "unknown",
                });
                failCount++;
                console.warn(`[retryCalendarAttendee] fail casting=${doc.id} cast=${c.castName} attempt=${retryCount + 1} error=${gasRes.error}`);
            }
        }

        console.log(`[retryCalendarAttendee] done ok=${okCount} fail=${failCount} giveUp=${giveUpCount}`);
    }
);
