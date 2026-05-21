/**
 * gokko-sam の notionSchedule ドキュメントのフィールド構造を覗く
 */
const admin = require('firebase-admin')
const path = require('path')

const serviceAccount = require(path.join(__dirname, 'serviceAccountKey.json'))
admin.initializeApp({ credential: admin.credential.cert(serviceAccount), projectId: 'gokko-casty' }, 'casty')
admin.initializeApp({ projectId: 'gokko-sam' }, 'sam')
const samDb = admin.firestore(admin.app('sam'))

async function main() {
    const snap = await samDb.collection('notionSchedule').limit(5).get()
    console.log('Sample docs from gokko-sam.notionSchedule:')
    for (const d of snap.docs) {
        console.log()
        console.log('--- doc id:', d.id, '---')
        console.log(JSON.stringify(d.data(), null, 2))
    }

    // 全フィールド名の集計
    const allFields = new Set()
    const snap2 = await samDb.collection('notionSchedule').get()
    for (const d of snap2.docs) {
        const data = d.data()
        for (const k of Object.keys(data)) allFields.add(k)
    }
    console.log()
    console.log('=== All fields seen across notionSchedule docs ===')
    console.log(Array.from(allFields).sort().join(', '))
}

main().catch(e => { console.error(e); process.exit(1) }).then(() => process.exit(0))
