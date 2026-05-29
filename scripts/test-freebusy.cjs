/**
 * Free/Busy API 検証スクリプト
 *
 * 共有してもらう SA: calendar-reader@gokko-casty.iam.gserviceaccount.com
 *
 * 事前準備（キャストに依頼する手順）:
 *   1. Google カレンダーを開く
 *   2. 左サイドバー > マイカレンダー > 自分のカレンダー > ︙ > 設定と共有
 *   3. 「特定のユーザーやグループと共有」セクション
 *   4. calendar-reader@gokko-casty.iam.gserviceaccount.com を追加
 *   5. 権限: 「予定の表示（時間枠のみ、詳細は非表示）」を選択
 *   6. 送信
 *
 * Usage:
 *   node scripts/test-freebusy.cjs <gmail-address> [YYYY-MM-DD]
 *
 * 例:
 *   node scripts/test-freebusy.cjs your.address@gmail.com 2026-05-23
 */
const { google } = require('/Users/mk0012/Desktop/workspace/vue_casty/functions/node_modules/googleapis')
const fs = require('fs')

const KEY_PATH = '/tmp/calendar-reader-key.json'

async function main() {
    const email = process.argv[2]
    const dateStr = process.argv[3] || new Date().toISOString().slice(0, 10)
    if (!email) {
        console.error('Usage: node scripts/test-freebusy.cjs <gmail-address> [YYYY-MM-DD]')
        process.exit(1)
    }
    if (!fs.existsSync(KEY_PATH)) {
        console.error(`Key file not found: ${KEY_PATH}`)
        process.exit(1)
    }
    const credentials = JSON.parse(fs.readFileSync(KEY_PATH, 'utf-8'))
    console.log('SA email:', credentials.client_email)
    console.log('Target gmail:', email)
    console.log('Date:', dateStr)
    console.log()

    const auth = new google.auth.GoogleAuth({
        credentials,
        scopes: ['https://www.googleapis.com/auth/calendar.readonly'],
    })
    const cal = google.calendar({ version: 'v3', auth })

    // 当日 00:00:00 〜 23:59:59 (Asia/Tokyo, UTC は -9h)
    const timeMin = `${dateStr}T00:00:00+09:00`
    const timeMax = `${dateStr}T23:59:59+09:00`

    try {
        const res = await cal.freebusy.query({
            requestBody: {
                timeMin,
                timeMax,
                timeZone: 'Asia/Tokyo',
                items: [{ id: email }],
            },
        })
        console.log('=== freebusy.query response ===')
        console.log(JSON.stringify(res.data, null, 2))
        const calendars = res.data.calendars || {}
        const cd = calendars[email]
        if (cd && cd.errors) {
            console.log()
            console.log('!! errors:', cd.errors)
        }
        if (cd && cd.busy && cd.busy.length > 0) {
            console.log()
            console.log('=== busy slots (Asia/Tokyo) ===')
            for (const b of cd.busy) {
                const s = new Date(b.start).toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo', hour12: false })
                const e = new Date(b.end).toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo', hour12: false })
                console.log(`  ${s}  →  ${e}`)
            }
        } else if (cd && cd.busy && cd.busy.length === 0) {
            console.log()
            console.log('予定なし (空き)')
        }
    } catch (e) {
        console.error('!! freebusy.query failed:', e.message || e)
        if (e.response?.data) console.error('  detail:', JSON.stringify(e.response.data))
    }
}

main().catch(e => { console.error(e); process.exit(1) }).then(() => process.exit(0))
