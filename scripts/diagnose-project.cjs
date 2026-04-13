/**
 * 診断用: 特定の projectId に紐づくキャスティング状況を出力
 * Usage: node scripts/diagnose-project.cjs <projectId-with-or-without-dashes>
 */

const admin = require('firebase-admin')
const path = require('path')

const serviceAccount = require(path.join(__dirname, 'serviceAccountKey.json'))
admin.initializeApp({ credential: admin.credential.cert(serviceAccount) })
const db = admin.firestore()

// 入力 projectId をハイフン付き / 無し 両方試す
function normalizeIds(input) {
    const noDash = input.replace(/-/g, '')
    if (noDash.length !== 32) return [input]
    const dashed = `${noDash.slice(0, 8)}-${noDash.slice(8, 12)}-${noDash.slice(12, 16)}-${noDash.slice(16, 20)}-${noDash.slice(20)}`
    return [dashed, noDash]
}

async function main() {
    const arg = process.argv[2]
    if (!arg) { console.error('projectId required'); process.exit(1) }

    const candidates = normalizeIds(arg)
    console.log('Trying projectIds:', candidates)

    let snap
    let usedId
    for (const id of candidates) {
        const s = await db.collection('castings').where('projectId', '==', id).get()
        if (!s.empty) { snap = s; usedId = id; break }
    }
    if (!snap) {
        console.log('No castings found for any candidate id')
        return
    }

    console.log(`\n=== ${snap.size} castings found for projectId: ${usedId} ===\n`)

    const byThread = {}
    for (const doc of snap.docs) {
        const d = doc.data()
        const ts = d.slackThreadTs || '(empty)'
        if (!byThread[ts]) byThread[ts] = []
        byThread[ts].push({
            id: doc.id,
            castName: d.castName,
            roleName: d.roleName,
            status: d.status,
            castType: d.castType,
            deleted: d.deleted === true,
            slackChannel: d.slackChannel,
            slackPermalink: d.slackPermalink,
            calendarEventId: d.calendarEventId || null,
            startDate: d.startDate ? d.startDate.toDate().toISOString().slice(0, 10) : null,
            createdAt: d.createdAt ? d.createdAt.toDate().toISOString() : null,
        })
    }

    for (const [ts, list] of Object.entries(byThread)) {
        console.log(`--- slackThreadTs: ${ts} (${list.length} castings) ---`)
        for (const c of list) {
            const flags = [
                c.deleted ? 'DELETED' : null,
                c.status === 'キャンセル' ? 'CANCEL' : null,
                c.status === 'NG' ? 'NG' : null,
                c.calendarEventId ? `cal=${c.calendarEventId.slice(0, 12)}` : 'NO_CAL',
            ].filter(Boolean)
            console.log(`  [${c.id}] ${c.castName} / ${c.roleName} / ${c.status} / ${c.castType} / ${c.startDate} ${flags.length ? '[' + flags.join(',') + ']' : ''}`)
            if (c.slackPermalink) console.log(`     ↳ ${c.slackPermalink}`)
        }
        console.log()
    }
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1) })
