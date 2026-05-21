/**
 * casting の isDecided / mode / castType / status のクロス集計
 */
const admin = require('firebase-admin')
const path = require('path')

const serviceAccount = require(path.join(__dirname, 'serviceAccountKey.json'))
admin.initializeApp({ credential: admin.credential.cert(serviceAccount) })
const db = admin.firestore()

async function main() {
    const snap = await db.collection('castings').get()
    const stats = { total: 0, deleted: 0 }
    const byMode = {}
    const byModeAndDecided = {}
    const byModeAndStatus = {}
    let isDecidedTrue = 0
    let isDecidedFalseStatus決定 = 0

    for (const d of snap.docs) {
        stats.total++
        const data = d.data()
        if (data.deleted === true) { stats.deleted++; continue }
        const mode = data.mode || '(none)'
        const castType = data.castType || '(none)'
        const status = data.status || '(none)'
        const isDecided = data.isDecided === true

        const modeKey = `${mode}/${castType}`
        byMode[modeKey] = (byMode[modeKey] || 0) + 1

        if (isDecided) isDecidedTrue++
        if (!isDecided && status === '決定') isDecidedFalseStatus決定++

        const k = `${modeKey} isDecided=${isDecided}`
        byModeAndDecided[k] = (byModeAndDecided[k] || 0) + 1

        const sk = `${modeKey} status=${status}`
        byModeAndStatus[sk] = (byModeAndStatus[sk] || 0) + 1
    }

    console.log(`total: ${stats.total}, deleted: ${stats.deleted}`)
    console.log()
    console.log('=== by mode/castType ===')
    for (const [k, v] of Object.entries(byMode).sort()) console.log(`  ${k}: ${v}`)
    console.log()
    console.log(`isDecided==true: ${isDecidedTrue}`)
    console.log(`status=='決定' && isDecided!=true: ${isDecidedFalseStatus決定}`)
    console.log()
    console.log('=== by mode/castType + isDecided ===')
    for (const [k, v] of Object.entries(byModeAndDecided).sort()) console.log(`  ${k}: ${v}`)
    console.log()
    console.log('=== by mode/castType + status ===')
    for (const [k, v] of Object.entries(byModeAndStatus).sort()) console.log(`  ${k}: ${v}`)
}

main().catch(e => { console.error(e); process.exit(1) }).then(() => process.exit(0))
