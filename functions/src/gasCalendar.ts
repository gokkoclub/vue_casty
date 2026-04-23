/**
 * =========================================================================
 * gasCalendar.ts
 *
 * GAS Web App に HMAC 署名付きで attendee 追加を委譲する helper。
 *
 * GAS 側の仕様 (scripts/gas-calendar-invite/Code.gs):
 *   payload   = [action, timestamp, calendarId, eventId, attendeeEmail].join('|')
 *   signature = HMAC-SHA256(payload, SHARED_SECRET)  // hex lowercase
 *
 * 失敗時は呼び出し側で casting doc に calendarAttendeePending フラグを立て、
 * スケジューラ経由で後追いリトライさせること。
 * =========================================================================
 */

import * as crypto from "crypto";

const GAS_TIMEOUT_MS = 8000;

export interface GasInviteResult {
    ok: boolean;
    skipped?: string;
    eventId?: string;
    attendeeCount?: number;
    error?: string;
}

/**
 * GAS Web App に attendee 追加をリクエスト。
 * 成功: { ok: true, ... }
 * 失敗: { ok: false, error: ... }  — throw はしない (呼び出し側でリトライ管理する前提)
 */
export async function addAttendeeViaGas(params: {
    webhookUrl: string;
    secret: string;
    calendarId: string;
    eventId: string;
    attendeeEmail: string;
}): Promise<GasInviteResult> {
    const { webhookUrl, secret, calendarId, eventId, attendeeEmail } = params;
    if (!webhookUrl || !secret) {
        return { ok: false, error: "GAS webhook url/secret not configured" };
    }
    if (!eventId || !attendeeEmail) {
        return { ok: false, error: "eventId/attendeeEmail required" };
    }

    const action = "addAttendee";
    const timestamp = String(Date.now());
    const payload = [action, timestamp, calendarId, eventId, attendeeEmail].join("|");
    const signature = crypto.createHmac("sha256", secret).update(payload).digest("hex");

    const body = JSON.stringify({
        action,
        timestamp,
        signature,
        calendarId,
        eventId,
        attendeeEmail,
    });

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), GAS_TIMEOUT_MS);

    try {
        const resp = await fetch(webhookUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body,
            signal: controller.signal,
            redirect: "follow",
        });

        if (!resp.ok) {
            const text = await resp.text().catch(() => "");
            return { ok: false, error: `GAS HTTP ${resp.status}: ${text.slice(0, 200)}` };
        }

        const result = await resp.json() as GasInviteResult;
        return result;
    } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return { ok: false, error: `GAS fetch failed: ${msg}` };
    } finally {
        clearTimeout(timeoutId);
    }
}
