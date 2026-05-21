/**
 * casts コレクションで同じ名前 / 同じ notionPageId の重複を抽出
 */
const admin = require('firebase-admin')
const path = require('path')

const serviceAccount = require(path.join(__dirname, 'serviceAccountKey.json'))
admin.initializeApp({ credential: admin.credential.cert(serviceAccount) })
const db = admin.firestore()

async function main() {
    const snap = await db.collection('casts').get()
    const byName = new Map()
    const byNotionPageId = new Map()
    for (const d of snap.docs) {
        const data = d.data()
        const name = (data.name || '').trim()
        const npid = data.notionPageId
        if (name) {
            if (!byName.has(name)) byName.set(name, [])
            byName.get(name).push({ id: d.id, name, notionPageId: npid, hasMemo: !!data.hasMemo, syncSource: data.syncSource })
        }
        if (npid) {
            if (!byNotionPageId.has(npid)) byNotionPageId.set(npid, [])
            byNotionPageId.get(npid).push({ id: d.id, name, notionPageId: npid })
        }
    }

    console.log(`total casts: ${snap.size}`)

    // 名前重複
    const nameDups = []
    for (const [name, arr] of byName) {
        if (arr.length > 1) nameDups.push({ name, arr })
    }
    console.log(`=== 名前重複: ${nameDups.length} 件 ===`)
    for (const { name, arr } of nameDups.slice(0, 50)) {
        console.log(`  "${name}" (${arr.length}件)`)
        for (const a of arr) console.log(`    [${a.id}] notionPageId=${a.notionPageId || '(none)'} hasMemo=${a.hasMemo} syncSource=${a.syncSource || '(none)'}`)
    }
    if (nameDups.length > 50) console.log(`  ... and ${nameDups.length - 50} more`)

    // notionPageId 重複（あったらバグ）
    let npidDups = 0
    for (const [pid, arr] of byNotionPageId) {
        if (arr.length > 1) {
            npidDups++
            console.log(`  ! notionPageId 重複: ${pid}`)
            for (const a of arr) console.log(`    [${a.id}] ${a.name}`)
        }
    }
    console.log(`notionPageId 重複: ${npidDups} 件`)
}

main().catch(e => { console.error(e); process.exit(1) }).then(() => process.exit(0))
