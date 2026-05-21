/**
 * casts.notes を memo に統合してから notes フィールドを削除
 * Usage:
 *   node scripts/merge-notes-to-memo.cjs           (dryRun)
 *   node scripts/merge-notes-to-memo.cjs --apply
 */
const admin = require('firebase-admin')
const path = require('path')

const serviceAccount = require(path.join(__dirname, 'serviceAccountKey.json'))
admin.initializeApp({ credential: admin.credential.cert(serviceAccount) })
const db = admin.firestore()

const dryRun = !process.argv.includes('--apply')

async function main() {
    const snap = await db.collection('casts').get()
    const targets = []
    for (const d of snap.docs) {
        const data = d.data()
        const notes = (data.notes || '').toString().trim()
        if (!notes) continue
        const existingMemo = (data.memo || '').toString().trim()
        const mergedMemo = existingMemo
            ? `${existingMemo}\n\n【その他】\n${notes}`
            : `【その他】\n${notes}`
        targets.push({
            id: d.id,
            name: data.name,
            ref: d.ref,
            notes,
            existingMemo,
            mergedMemo,
            hasMemoAfter: true,
        })
    }
    console.log(`=== merge-notes-to-memo (${dryRun ? 'DRYRUN' : 'APPLY'}) ===`)
    console.log('targets with notes:', targets.length)
    for (const t of targets) {
        console.log(`  [${t.id}] ${t.name}`)
        console.log(`    notes:    "${t.notes.slice(0, 80)}"`)
        console.log(`    -> memo:  "${t.mergedMemo.slice(0, 100)}"`)
    }

    if (dryRun) {
        console.log('\nRun with --apply to commit.')
        return
    }

    // notes が入っているドキュメント: memo に統合 + hasMemo=true + notes を物理削除
    let merged = 0
    for (const t of targets) {
        await t.ref.update({
            memo: t.mergedMemo,
            hasMemo: true,
            notes: admin.firestore.FieldValue.delete(),
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        })
        merged++
    }

    // notes が空の全ドキュメントからも notes フィールドを削除（完全廃止）
    let removed = 0
    const all = await db.collection('casts').get()
    const removeRefs = []
    for (const d of all.docs) {
        const data = d.data()
        if ('notes' in data) removeRefs.push(d.ref)
    }
    for (let i = 0; i < removeRefs.length; i += 500) {
        const chunk = removeRefs.slice(i, i + 500)
        const batch = db.batch()
        for (const r of chunk) {
            batch.update(r, { notes: admin.firestore.FieldValue.delete() })
        }
        await batch.commit()
        removed += chunk.length
    }
    console.log(`\nDone. merged=${merged}, fields removed=${removed}`)
}

main().catch(e => { console.error(e); process.exit(1) }).then(() => process.exit(0))
