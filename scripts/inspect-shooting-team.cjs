/**
 * shootings の team フィールドの分布を確認
 */
const admin = require('firebase-admin')
const path = require('path')

const serviceAccount = require(path.join(__dirname, 'serviceAccountKey.json'))
admin.initializeApp({ credential: admin.credential.cert(serviceAccount) })
const db = admin.firestore()

async function main() {
    const snap = await db.collection('shootings').get()
    let withTeam = 0
    let emptyTeam = 0
    let deleted = 0
    const sample = []
    const emptyTeamSample = []

    for (const d of snap.docs) {
        const data = d.data()
        if (data.deleted === true) { deleted++; continue }
        if (data.team) {
            withTeam++
            if (sample.length < 5) sample.push({ id: d.id, title: data.title, team: data.team, cd: data.cd })
        } else {
            emptyTeam++
            if (emptyTeamSample.length < 10) emptyTeamSample.push({ id: d.id, title: data.title, team: data.team || '(empty)', cd: data.cd || '(none)' })
        }
    }

    console.log('Total shootings (excl deleted):', withTeam + emptyTeam)
    console.log('  with team field:', withTeam)
    console.log('  empty team field:', emptyTeam)
    console.log('  deleted:', deleted)
    console.log()
    console.log('--- Sample (with team) ---')
    for (const s of sample) console.log(`  title="${s.title}" / team="${s.team}" / cd="${s.cd}"`)
    console.log()
    console.log('--- Sample (empty team) ---')
    for (const s of emptyTeamSample) console.log(`  title="${s.title}" / team="${s.team}" / cd="${s.cd}"`)
}

main().catch(e => { console.error(e); process.exit(1) }).then(() => process.exit(0))
