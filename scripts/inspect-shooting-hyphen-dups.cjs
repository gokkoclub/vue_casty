/**
 * shootings コレクションでハイフン有無の重複を再診断
 */
const admin = require('firebase-admin')
const path = require('path')

const serviceAccount = require(path.join(__dirname, 'serviceAccountKey.json'))
admin.initializeApp({ credential: admin.credential.cert(serviceAccount) })
const db = admin.firestore()

function normalize(id) { return (id || '').replace(/-/g, '').toLowerCase() }

async function main() {
    const snap = await db.collection('shootings').get()
    const groups = new Map()
    for (const d of snap.docs) {
        const data = d.data()
        const pid = data.notionPageId
        if (!pid) continue
        const norm = normalize(pid)
        if (!groups.has(norm)) groups.set(norm, [])
        groups.get(norm).push({
            id: d.id,
            pid,
            title: data.title || '',
            team: data.team || '',
            shootDate: data.shootDate || '',
            deleted: data.deleted === true,
            syncSource: data.syncSource || '(none)',
            updatedAt: data.updatedAt,
        })
    }
    const dups = []
    for (const [norm, arr] of groups) {
        const active = arr.filter(x => !x.deleted)
        if (active.length > 1) dups.push({ norm, items: arr, active })
    }
    console.log('total shootings:', snap.size)
    console.log('active duplicate groups:', dups.length)
    for (const d of dups.slice(0, 20)) {
        console.log()
        console.log('  norm:', d.norm)
        for (const x of d.items) {
            const u = x.updatedAt?.toDate ? x.updatedAt.toDate().toISOString() : ''
            console.log(`    [${x.id}] pid=${x.pid} sync=${x.syncSource} deleted=${x.deleted} title="${x.title.slice(0, 30)}" updated=${u}`)
        }
    }
    if (dups.length > 20) console.log(`  ... and ${dups.length - 20} more`)
}

main().catch(e => { console.error(e); process.exit(1) }).then(() => process.exit(0))
