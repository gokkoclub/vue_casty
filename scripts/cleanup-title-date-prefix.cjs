/**
 * shootings.title から "YYYY-MM-DD_" プレフィックスを除去
 * Usage:
 *   node scripts/cleanup-title-date-prefix.cjs            (dryRun)
 *   node scripts/cleanup-title-date-prefix.cjs --apply    (本適用)
 */
const admin = require('firebase-admin')
const path = require('path')

const serviceAccount = require(path.join(__dirname, 'serviceAccountKey.json'))
admin.initializeApp({ credential: admin.credential.cert(serviceAccount) })
const db = admin.firestore()

const dryRun = !process.argv.includes('--apply')

async function main() {
    const snap = await db.collection('shootings').get()
    const datePrefix = /^(\d{4}-\d{2}-\d{2})_(.+)$/
    const updates = []
    for (const d of snap.docs) {
        const data = d.data()
        if (data.deleted === true) continue
        const title = data.title || ''
        const m = title.match(datePrefix)
        if (!m) continue
        updates.push({ id: d.id, from: title, to: m[2], ref: d.ref })
    }

    console.log(`=== title prefix cleanup (${dryRun ? 'DRYRUN' : 'APPLY'}) ===`)
    console.log('Targets:', updates.length)
    for (const u of updates.slice(0, 30)) {
        console.log(`  [${u.id}]  "${u.from}"  →  "${u.to}"`)
    }
    if (updates.length > 30) console.log(`  ... and ${updates.length - 30} more`)

    if (dryRun) {
        console.log('\nRun with --apply to commit.')
        return
    }

    let applied = 0
    for (let i = 0; i < updates.length; i += 500) {
        const chunk = updates.slice(i, i + 500)
        const batch = db.batch()
        for (const u of chunk) {
            batch.update(u.ref, {
                title: u.to,
                titleCleanupFrom: u.from,
                titleCleanupAt: admin.firestore.FieldValue.serverTimestamp(),
            })
        }
        await batch.commit()
        applied += chunk.length
    }
    console.log(`Done. applied=${applied}`)
}

main().catch(e => { console.error(e); process.exit(1) }).then(() => process.exit(0))
