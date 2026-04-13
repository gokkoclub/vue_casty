/**
 * 修復: ある projectId 配下の slackThreadTs="" のキャスティング全てに ts/channel を一括で書き戻す
 *
 * Usage:
 *   node scripts/repair-project-thread.cjs <projectId> <slackThreadTs> <slackChannel> [slackPermalink]
 */

const admin = require('firebase-admin')
const path = require('path')

const serviceAccount = require(path.join(__dirname, 'serviceAccountKey.json'))
admin.initializeApp({ credential: admin.credential.cert(serviceAccount) })
const db = admin.firestore()

function normalizeIds(input) {
    const noDash = input.replace(/-/g, '')
    if (noDash.length !== 32) return [input]
    const dashed = `${noDash.slice(0, 8)}-${noDash.slice(8, 12)}-${noDash.slice(12, 16)}-${noDash.slice(16, 20)}-${noDash.slice(20)}`
    return [dashed, noDash]
}

async function main() {
    const [pidArg, slackThreadTs, slackChannel, slackPermalink] = process.argv.slice(2)
    if (!pidArg || !slackThreadTs || !slackChannel) {
        console.error('Usage: node repair-project-thread.cjs <projectId> <slackThreadTs> <slackChannel> [slackPermalink]')
        process.exit(1)
    }

    const candidates = normalizeIds(pidArg)
    let snap
    let usedId
    for (const id of candidates) {
        const s = await db.collection('castings').where('projectId', '==', id).get()
        if (!s.empty) { snap = s; usedId = id; break }
    }
    if (!snap) { console.error('No castings found'); process.exit(1) }

    console.log(`Project: ${usedId}, total: ${snap.size}`)

    let updateCount = 0
    let skipCount = 0
    const batch = db.batch()
    for (const doc of snap.docs) {
        const d = doc.data()
        // 削除済みは触らない
        if (d.deleted === true || d.status === 'キャンセル' || d.status === 'NG') {
            console.log(`  SKIP (inactive): ${doc.id} ${d.castName} status=${d.status}`)
            skipCount++
            continue
        }
        // 既に slackThreadTs がある場合は触らない（誤上書き防止）
        if (d.slackThreadTs && d.slackThreadTs !== '') {
            console.log(`  SKIP (already set): ${doc.id} ${d.castName} ts=${d.slackThreadTs}`)
            skipCount++
            continue
        }
        const update = { slackThreadTs, slackChannel }
        if (slackPermalink) update.slackPermalink = slackPermalink
        batch.update(doc.ref, update)
        console.log(`  UPDATE: ${doc.id} ${d.castName} → ts=${slackThreadTs}`)
        updateCount++
    }

    if (updateCount > 0) {
        await batch.commit()
    }
    console.log(`\nDone. updated=${updateCount}, skipped=${skipCount}`)
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1) })
