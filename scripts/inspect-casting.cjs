/**
 * 単一キャスティングの全フィールドを表示
 * Usage: node scripts/inspect-casting.cjs <castingId>
 */
const admin = require('firebase-admin')
const path = require('path')
const sa = require(path.join(__dirname, 'serviceAccountKey.json'))
admin.initializeApp({ credential: admin.credential.cert(sa) })
const db = admin.firestore()

async function main() {
    const id = process.argv[2]
    if (!id) { console.error('castingId required'); process.exit(1) }
    const doc = await db.collection('castings').doc(id).get()
    if (!doc.exists) { console.error('not found'); process.exit(1) }
    const d = doc.data()

    // Timestampをstring化
    const display = {}
    for (const [k, v] of Object.entries(d)) {
        if (v && typeof v === 'object' && v.toDate) {
            display[k] = v.toDate().toISOString()
        } else {
            display[k] = v
        }
    }
    console.log(JSON.stringify(display, null, 2))

    // shootings 同名 projectId のドキュメントも見る
    if (d.projectId) {
        const sh = await db.collection('shootings').where('notionPageId', '==', d.projectId).get()
        console.log(`\n--- shootings for projectId (${sh.size} docs) ---`)
        for (const s of sh.docs) {
            const sd = s.data()
            console.log(`[${s.id}] startTime=${sd.startTime || '(empty)'} endTime=${sd.endTime || '(empty)'} title=${sd.title}`)
        }
    }
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1) })
