"use strict";
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
/**
 * Calendar API テストスクリプト
 * ローカルの serviceAccountKey.json を使ってカレンダーAPIをテスト
 *
 * 使い方: cd functions && npx ts-node src/test-calendar.ts
 */
const googleapis_1 = require("googleapis");
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
async function main() {
    const keyPath = path.resolve(__dirname, "../../serviceAccountKey.json");
    console.log("Loading key from:", keyPath);
    const keyFile = JSON.parse(fs.readFileSync(keyPath, "utf-8"));
    console.log("Service account email:", keyFile.client_email);
    console.log("Project ID:", keyFile.project_id);
    const auth = new googleapis_1.google.auth.GoogleAuth({
        credentials: keyFile,
        scopes: ["https://www.googleapis.com/auth/calendar"],
    });
    const calendar = googleapis_1.google.calendar({ version: "v3", auth });
    const calendarId = "c_d9e443c8b8c2b678b68373f8150a9e6af3a22b2b4123781fa675e4ac649bc00f@group.calendar.google.com";
    console.log("\n--- Test 1: List calendars ---");
    try {
        const list = await calendar.calendarList.list();
        console.log("Calendars found:", list.data.items?.length || 0);
        list.data.items?.forEach((c) => {
            console.log(`  - ${c.summary} (${c.id})`);
        });
    }
    catch (e) {
        const err = e;
        console.error("CalendarList error:", err.code, err.message);
        if (err.errors)
            console.error("  Details:", JSON.stringify(err.errors));
    }
    console.log("\n--- Test 2: Get calendar info ---");
    try {
        const cal = await calendar.calendars.get({ calendarId });
        console.log("Calendar found:", cal.data.summary, cal.data.id);
    }
    catch (e) {
        const err = e;
        console.error("Calendar get error:", err.code, err.message);
        if (err.errors)
            console.error("  Details:", JSON.stringify(err.errors));
        if (err.code === 404) {
            console.error("\n⚠  Calendar not found. Possible causes:");
            console.error("   1. Calendar API is NOT enabled in GCP project");
            console.error("   2. Service account cannot see this calendar");
            console.error("   3. Calendar ID is incorrect");
            console.error("\n   Fix: Go to https://console.cloud.google.com/apis/library/calendar-json.googleapis.com?project=" + keyFile.project_id);
            console.error("   and enable 'Google Calendar API'");
        }
    }
    console.log("\n--- Test 3: Create test event ---");
    try {
        const result = await calendar.events.insert({
            calendarId,
            requestBody: {
                summary: "[テスト] カレンダーAPI接続テスト - 削除可",
                start: { date: "2026-02-28" },
                end: { date: "2026-03-01" },
            },
        });
        console.log("✅ Event created:", result.data.id);
        console.log("   Summary:", result.data.summary);
        // テストイベント削除
        if (result.data.id) {
            await calendar.events.delete({ calendarId, eventId: result.data.id });
            console.log("   (Test event cleaned up)");
        }
    }
    catch (e) {
        const err = e;
        console.error("❌ Event create error:", err.code, err.message);
        if (err.errors)
            console.error("  Details:", JSON.stringify(err.errors));
    }
}
main().catch(console.error);
//# sourceMappingURL=test-calendar.js.map