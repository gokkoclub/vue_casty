/**
 * offshotDrive コレクションと projects.offshotUrl / shootings.offshotUrl の中身を確認
 */
const admin = require('firebase-admin')
const path = require('path')

const serviceAccount = require(path.join(__dirname, 'serviceAccountKey.json'))
admin.initializeApp({ credential: admin.credential.cert(serviceAccount) })
const db = admin.firestore()

async function main() {
    // offshotDrive 全件
    const ods = await db.collection('offshotDrive').get()
    console.log('=== offshotDrive ===')
    console.log('count:', ods.size)
    for (const d of ods.docs.slice(0, 5)) {
        console.log(`  [${d.id}]`, JSON.stringify(d.data()).slice(0, 200))
    }

    // projects に offshotUrl があるか確認
    const ps = await db.collection('projects').get()
    let projectsWithOffshot = 0
    const sampleProjects = []
    for (const d of ps.docs) {
        const data = d.data()
        if (data.offshotUrl) {
            projectsWithOffshot++
            if (sampleProjects.length < 5) sampleProjects.push({ id: d.id, notionPageId: data.notionPageId, offshotUrl: data.offshotUrl })
        }
    }
    console.log()
    console.log('=== projects with offshotUrl ===')
    console.log('count:', projectsWithOffshot, '/', ps.size)
    for (const s of sampleProjects) {
        console.log('  ', s)
    }

    // shootings に offshotUrl があるか
    const ss = await db.collection('shootings').get()
    let shootingsWithOffshot = 0
    const sampleShoots = []
    for (const d of ss.docs) {
        const data = d.data()
        if (data.offshotUrl) {
            shootingsWithOffshot++
            if (sampleShoots.length < 5) sampleShoots.push({ id: d.id, notionPageId: data.notionPageId, offshotUrl: data.offshotUrl })
        }
    }
    console.log()
    console.log('=== shootings with offshotUrl ===')
    console.log('count:', shootingsWithOffshot, '/', ss.size)
    for (const s of sampleShoots) {
        console.log('  ', s)
    }

    // castings.makingUrl
    const cs = await db.collection('castings').get()
    let castingsWithMaking = 0
    for (const d of cs.docs) {
        if (d.data().makingUrl) castingsWithMaking++
    }
    console.log()
    console.log('=== castings.makingUrl already set ===')
    console.log('count:', castingsWithMaking, '/', cs.size)
}

main().catch(e => { console.error(e); process.exit(1) }).then(() => process.exit(0))
