/**
 * casts.notes と casts.memo の使用状況を確認
 */
const admin = require('firebase-admin')
const path = require('path')

const serviceAccount = require(path.join(__dirname, 'serviceAccountKey.json'))
admin.initializeApp({ credential: admin.credential.cert(serviceAccount) })
const db = admin.firestore()

async function main() {
    const snap = await db.collection('casts').get()
    let total = 0
    let withNotes = 0
    let withMemo = 0
    let bothHave = 0
    let onlyNotes = 0
    let onlyMemo = 0
    const sampleNotes = []
    const sampleBoth = []
    for (const d of snap.docs) {
        total++
        const data = d.data()
        const hasNotes = !!(data.notes && String(data.notes).trim())
        const hasMemo = !!(data.memo && String(data.memo).trim())
        if (hasNotes) withNotes++
        if (hasMemo) withMemo++
        if (hasNotes && hasMemo) {
            bothHave++
            if (sampleBoth.length < 5) sampleBoth.push({ id: d.id, name: data.name, notes: data.notes, memo: data.memo })
        }
        if (hasNotes && !hasMemo) {
            onlyNotes++
            if (sampleNotes.length < 10) sampleNotes.push({ id: d.id, name: data.name, notes: data.notes })
        }
        if (!hasNotes && hasMemo) onlyMemo++
    }
    console.log('total:', total)
    console.log('  notes あり:', withNotes)
    console.log('  memo  あり:', withMemo)
    console.log('  両方:', bothHave)
    console.log('  notes のみ:', onlyNotes)
    console.log('  memo  のみ:', onlyMemo)
    console.log()
    console.log('--- notes のみ サンプル ---')
    for (const s of sampleNotes) console.log(`  [${s.id}] ${s.name}: "${String(s.notes).slice(0, 80)}"`)
    console.log()
    console.log('--- 両方 サンプル ---')
    for (const s of sampleBoth) {
        console.log(`  [${s.id}] ${s.name}`)
        console.log(`    notes: "${String(s.notes).slice(0, 60)}"`)
        console.log(`    memo:  "${String(s.memo).slice(0, 60)}"`)
    }
}

main().catch(e => { console.error(e); process.exit(1) }).then(() => process.exit(0))
