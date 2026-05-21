/**
 * 既存の `<baseDocId>_<YYYYMMDD>` 形式の shooting 重複ドキュメントを baseDocId 側に集約
 *
 * Usage:
 *   node scripts/consolidate-shooting-duplicates.cjs            (dryRun)
 *   node scripts/consolidate-shooting-duplicates.cjs --apply    (本適用)
 */
const admin = require('firebase-admin')
const path = require('path')

const serviceAccount = require(path.join(__dirname, 'serviceAccountKey.json'))
admin.initializeApp({ credential: admin.credential.cert(serviceAccount) })
const db = admin.firestore()

const dryRun = !process.argv.includes('--apply')

async function main() {
    const snap = await db.collection('shootings').get()
    const suffixRegex = /^(.+)_(\d{8})$/

    const groups = new Map() // base -> [{docId, shootDate, ref}]
    const baseExists = new Set()

    for (const doc of snap.docs) {
        const id = doc.id
        const data = doc.data()
        const shootDate = data.shootDate || ''
        const m = id.match(suffixRegex)
        if (m && m[1]) {
            const base = m[1]
            const arr = groups.get(base) || []
            arr.push({ docId: id, shootDate, ref: doc.ref, deleted: data.deleted === true })
            groups.set(base, arr)
        } else {
            baseExists.add(id)
        }
    }

    const actions = []
    for (const [base, suffixDocs] of groups.entries()) {
        suffixDocs.sort((a, b) => b.shootDate.localeCompare(a.shootDate))
        const latest = suffixDocs[0]
        actions.push({
            base,
            latestSuffixDoc: latest.docId,
            latestDate: latest.shootDate,
            baseDocExists: baseExists.has(base),
            markDeleted: suffixDocs.filter(d => !d.deleted).map(d => d.docId),
        })
    }

    console.log(`=== Consolidate Shooting Duplicates (${dryRun ? 'DRYRUN' : 'APPLY'}) ===`)
    console.log('Suffix groups found:', actions.length)
    console.log()
    for (const a of actions.slice(0, 30)) {
        console.log(`  base=${a.base}`)
        console.log(`    latestSuffix = ${a.latestSuffixDoc} (${a.latestDate})`)
        console.log(`    baseDocExists = ${a.baseDocExists}`)
        console.log(`    markDeleted = [${a.markDeleted.join(', ')}]`)
    }
    if (actions.length > 30) console.log(`  ... and ${actions.length - 30} more`)

    if (dryRun) {
        console.log()
        console.log('Run with --apply to commit changes.')
        return
    }

    let merged = 0
    let markedDeleted = 0
    for (const a of actions) {
        const baseRef = db.collection('shootings').doc(a.base)
        const latestSuffixSnap = await db.collection('shootings').doc(a.latestSuffixDoc).get()
        const latestData = latestSuffixSnap.data() || {}

        await baseRef.set({
            ...latestData,
            shootDate: a.latestDate,
            deleted: false,
            consolidatedFrom: a.latestSuffixDoc,
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        }, { merge: true })
        merged++

        for (const suffixId of a.markDeleted) {
            await db.collection('shootings').doc(suffixId).update({
                deleted: true,
                deletedAt: admin.firestore.FieldValue.serverTimestamp(),
                consolidatedInto: a.base,
            })
            markedDeleted++
        }
    }

    console.log()
    console.log(`Done. merged=${merged}, markedDeleted=${markedDeleted}`)
}

main().catch(e => { console.error(e); process.exit(1) }).then(() => process.exit(0))
