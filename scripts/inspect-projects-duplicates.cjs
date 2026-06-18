/**
 * projects コレクションで shootingDate + team の重複を確認
 * cutoff 以降の type=pure / status=done のみ
 */
const admin = require('firebase-admin')
const path = require('path')

const serviceAccount = require(path.join(__dirname, 'serviceAccountKey.json'))
admin.initializeApp({ credential: admin.credential.cert(serviceAccount) })
const db = admin.firestore()

const CUTOFF = '2026-06-08'

async function main() {
    const snap = await db.collection('projects')
        .where('type', '==', 'pure')
        .where('status', '==', 'done')
        .get()

    const targets = []
    for (const d of snap.docs) {
        const data = d.data()
        if (!data.shootingDate || data.shootingDate < CUTOFF) continue
        if (!data.driveFolderUrl) continue
        targets.push({ id: d.id, ...data })
    }
    console.log(`type=pure / status=done / >=${CUTOFF} / driveFolderUrl あり: ${targets.length} 件`)

    // shootingDate + team でグルーピング
    const byKey = new Map()
    for (const t of targets) {
        const key = `${t.shootingDate}__${t.team}`
        if (!byKey.has(key)) byKey.set(key, [])
        byKey.get(key).push(t)
    }
    const dups = []
    for (const [key, arr] of byKey) {
        if (arr.length > 1) dups.push({ key, arr })
    }
    console.log(`shootingDate + team の重複グループ: ${dups.length}`)
    for (const d of dups) {
        console.log(`  ${d.key}  (${d.arr.length} 件)`)
        for (const x of d.arr) {
            console.log(`    [${x.id}] folder=${x.driveFolderUrl}`)
        }
    }

    // shootingDate だけ重複 (= 同日に複数撮影) も確認
    const byDate = new Map()
    for (const t of targets) {
        if (!byDate.has(t.shootingDate)) byDate.set(t.shootingDate, [])
        byDate.get(t.shootingDate).push(t)
    }
    console.log()
    console.log('=== 同じ shootingDate に複数 project ===')
    for (const [date, arr] of [...byDate.entries()].sort()) {
        if (arr.length > 1) {
            console.log(`  ${date}: ${arr.length} 件`)
            for (const x of arr) console.log(`    team=${x.team} title="${(x.title || '').slice(0, 30)}"`)
        }
    }
}

main().catch(e => { console.error(e); process.exit(1) }).then(() => process.exit(0))
