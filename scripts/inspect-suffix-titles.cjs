/**
 * "YYYY-MM-DD_" プレフィックスがついた title の shooting を抽出
 */
const admin = require('firebase-admin')
const path = require('path')

const serviceAccount = require(path.join(__dirname, 'serviceAccountKey.json'))
admin.initializeApp({ credential: admin.credential.cert(serviceAccount) })
const db = admin.firestore()

async function main() {
    const snap = await db.collection('shootings').get()
    const datePrefix = /^20\d{2}-\d{2}-\d{2}_/
    const matches = []
    for (const d of snap.docs) {
        const data = d.data()
        if (data.deleted === true) continue
        const title = data.title || ''
        if (datePrefix.test(title)) {
            matches.push({ id: d.id, title, team: data.team, shootDate: data.shootDate, syncSource: data.syncSource })
        }
    }
    console.log(`Found ${matches.length} shootings with date-prefixed title`)
    for (const m of matches.slice(0, 20)) {
        console.log(`  id=${m.id}`)
        console.log(`    title="${m.title}"`)
        console.log(`    team="${m.team}" shootDate=${m.shootDate} syncSource=${m.syncSource}`)
    }
}

main().catch(e => { console.error(e); process.exit(1) }).then(() => process.exit(0))
