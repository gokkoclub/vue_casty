/**
 * Notion (gokko-sam.notionSchedule) と Firestore (shootings) の件数差を可視化
 *   - Notion: 全件
 *   - Firestore: notionPageId を持つ shooting (deleted を除く)
 *   - 差分: Notion 側に無い notionPageId を持つ shooting を抽出
 */
const admin = require('firebase-admin')
const path = require('path')

const serviceAccount = require(path.join(__dirname, 'serviceAccountKey.json'))
admin.initializeApp({ credential: admin.credential.cert(serviceAccount), projectId: 'gokko-casty' }, 'casty')
const samApp = admin.initializeApp({ projectId: 'gokko-sam' }, 'sam')
const castyDb = admin.firestore(admin.app('casty'))
const samDb = admin.firestore(samApp)

async function main() {
    const samSnap = await samDb.collection('notionSchedule').get()
    const notionIds = new Set()
    for (const d of samSnap.docs) {
        const pageId = d.data().notionPageId
        if (pageId) notionIds.add(pageId)
    }
    console.log('gokko-sam notionSchedule count :', samSnap.size, '(unique notionPageId:', notionIds.size + ')')

    const shootSnap = await castyDb.collection('shootings').get()
    let total = 0
    let withPageId = 0
    let active = 0
    let alreadyDeleted = 0
    const orphans = [] // Notion に無い
    for (const d of shootSnap.docs) {
        total++
        const sd = d.data()
        const pid = sd.notionPageId
        if (!pid) continue
        withPageId++
        if (sd.deleted === true) { alreadyDeleted++; continue }
        active++
        if (!notionIds.has(pid)) {
            orphans.push({ id: d.id, title: sd.title, team: sd.team, shootDate: sd.shootDate, syncSource: sd.syncSource })
        }
    }
    console.log('Firestore shootings count       :', total)
    console.log('  with notionPageId             :', withPageId)
    console.log('  active (deleted!=true)        :', active)
    console.log('  already marked deleted        :', alreadyDeleted)
    console.log()
    console.log('=== Orphans (Notion 側に存在しない active shooting) ===')
    console.log('Count:', orphans.length)
    for (const o of orphans.slice(0, 50)) {
        console.log(`  [${o.id}] title="${o.title}" team="${o.team}" shootDate=${o.shootDate} syncSource=${o.syncSource || '(undef)'}`)
    }
    if (orphans.length > 50) console.log(`  ... and ${orphans.length - 50} more`)
}

main().catch(e => { console.error(e); process.exit(1) }).then(() => process.exit(0))
