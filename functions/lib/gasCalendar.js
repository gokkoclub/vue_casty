"use strict";
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
exports.addAttendeeViaGas = addAttendeeViaGas;
const crypto = __importStar(require("crypto"));
const GAS_TIMEOUT_MS = 8000;
/**
 * GAS Web App に attendee 追加をリクエスト。
 * 成功: { ok: true, ... }
 * 失敗: { ok: false, error: ... }  — throw はしない (呼び出し側でリトライ管理する前提)
 */
async function addAttendeeViaGas(params) {
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
        const result = await resp.json();
        return result;
    }
    catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return { ok: false, error: `GAS fetch failed: ${msg}` };
    }
    finally {
        clearTimeout(timeoutId);
    }
}
//# sourceMappingURL=gasCalendar.js.map