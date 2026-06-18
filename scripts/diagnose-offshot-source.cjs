const admin = require('firebase-admin')
const path = require('path')
admin.initializeApp({ credential: admin.credential.cert(require(path.join(__dirname, 'serviceAccountKey.json'))) })
const db = admin.firestore()
const tsToStr = (v) => !v ? '' : (v.toDate ? v.toDate().toISOString().slice(0,10) : String(v).slice(0,10))

async function main() {
    // offshotDrive の updatedAt 最新
    const od = await db.collection('offshotDrive').get()
    let maxOd = ''
    for (const d of od.docs) { const s = tsToStr(d.data().updatedAt); if (s > maxOd) maxOd = s }
    console.log(`offshotDrive: ${od.size}件, updatedAt 最新=${maxOd}`)

    // projects に driveFolderUrl / offshotUrl があり、shootingDate が6月以降のもの
    const ps = await db.collection('projects').get()
    let total = 0, withFolder = 0, juneWithFolder = 0, juneTotal = 0
    const juneSamples = []
    for (const d of ps.docs) {
        const x = d.data()
        total++
        const folder = x.driveFolderUrl || x.offshotUrl
        if (folder) withFolder++
        const sd = tsToStr(x.shootingDate || x.shootDate)
        if (sd >= '2026-06-01') {
            juneTotal++
            if (folder) { juneWithFolder++; if (juneSamples.length < 8) juneSamples.push({ id: d.id.slice(0,8), sd, folder: String(folder).slice(0,45) }) }
        }
    }
    console.log(`projects: ${total}件, driveフォルダURLあり=${withFolder}`)
    console.log(`projects 6月以降: ${juneTotal}件, うちフォルダURLあり=${juneWithFolder}`)
    for (const s of juneSamples) console.log('  ', JSON.stringify(s))

    // shootings 側も
    const ss = await db.collection('shootings').get()
    let shJune = 0, shJuneFolder = 0
    for (const d of ss.docs) {
        const x = d.data()
        const sd = tsToStr(x.shootDate || x.shootingDate)
        if (sd >= '2026-06-01') { shJune++; if (x.offshotUrl || x.driveUrl || x.driveFolderUrl) shJuneFolder++ }
    }
    console.log(`shootings 6月以降: ${shJune}件, うちオフショット/driveURLあり=${shJuneFolder}`)
}
main().catch(e=>{console.error(e);process.exit(1)}).then(()=>process.exit(0))
