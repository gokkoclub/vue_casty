/**
 * shootingSubmissions / offshotNotifications / offshotDrive の現状確認
 */
const admin = require('firebase-admin')
const path = require('path')

const serviceAccount = require(path.join(__dirname, 'serviceAccountKey.json'))
admin.initializeApp({ credential: admin.credential.cert(serviceAccount) })
const db = admin.firestore()

async function inspect(name) {
    try {
        const snap = await db.collection(name).get()
        console.log(`=== ${name} (${snap.size} 件) ===`)
        if (snap.size === 0) { console.log('  (empty)'); return }
        // 最新 5 件 (updatedAt or createdAt 降順)
        const docs = snap.docs.map(d => ({ id: d.id, data: d.data() }))
        docs.sort((a, b) => {
            const tA = a.data.updatedAt?.toMillis?.() || a.data.createdAt?.toMillis?.() || 0
            const tB = b.data.updatedAt?.toMillis?.() || b.data.createdAt?.toMillis?.() || 0
            return tB - tA
        })
        for (const d of docs.slice(0, 5)) {
            const ts = d.data.updatedAt?.toDate?.()?.toISOString?.() || d.data.createdAt?.toDate?.()?.toISOString?.() || ''
            console.log(`  [${d.id}]  updated=${ts}`)
            const preview = { ...d.data }
            // タイムスタンプはまとめて出さない
            delete preview.updatedAt
            delete preview.createdAt
            console.log('   ', JSON.stringify(preview).slice(0, 300))
        }
        console.log()
    } catch (e) {
        console.log(`!! ${name}: ${e.message}`)
    }
}

async function main() {
    await inspect('shootingSubmissions')
    await inspect('offshotNotifications')
    await inspect('offshotDrive')
}

main().catch(e => { console.error(e); process.exit(1) }).then(() => process.exit(0))
