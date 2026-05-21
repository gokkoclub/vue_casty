/**
 * status=='決定' なのに isDecided != true な casting に isDecided=true を一括付与
 * Usage:
 *   node scripts/backfill-isdecided.cjs            (dryRun)
 *   node scripts/backfill-isdecided.cjs --apply    (本適用)
 */
const admin = require('firebase-admin')
const path = require('path')

const serviceAccount = require(path.join(__dirname, 'serviceAccountKey.json'))
admin.initializeApp({ credential: admin.credential.cert(serviceAccount) })
const db = admin.firestore()

const dryRun = !process.argv.includes('--apply')

async function main() {
    const snap = await db.collection('castings').where('status', '==', '決定').get()
    const targets = []
    for (const d of snap.docs) {
        const data = d.data()
        if (data.deleted === true) continue
        if (data.isDecided === true) continue
        targets.push({ id: d.id, ref: d.ref, castName: data.castName, projectName: data.projectName, accountName: data.accountName, mode: data.mode || '(none)' })
    }
    console.log(`=== Backfill isDecided (${dryRun ? 'DRYRUN' : 'APPLY'}) ===`)
    console.log('targets:', targets.length)
    for (const t of targets.slice(0, 50)) {
        console.log(`  [${t.id}] ${t.castName} / ${t.accountName} / ${t.projectName} (mode=${t.mode})`)
    }
    if (targets.length > 50) console.log(`  ... and ${targets.length - 50} more`)

    if (dryRun) {
        console.log('\nRun with --apply to commit.')
        return
    }

    let applied = 0
    for (let i = 0; i < targets.length; i += 500) {
        const chunk = targets.slice(i, i + 500)
        const batch = db.batch()
        for (const t of chunk) {
            batch.update(t.ref, {
                isDecided: true,
                decidedAt: admin.firestore.FieldValue.serverTimestamp(),
                isDecidedBackfilledAt: admin.firestore.FieldValue.serverTimestamp(),
            })
        }
        await batch.commit()
        applied += chunk.length
    }
    console.log(`Done. applied=${applied}`)
}

main().catch(e => { console.error(e); process.exit(1) }).then(() => process.exit(0))
