/**
 * 2026-05-22 の docomo / ごっこ 撮影と castings の slackThreadTs 状況を確認
 */
const admin = require('firebase-admin')
const path = require('path')

const serviceAccount = require(path.join(__dirname, 'serviceAccountKey.json'))
admin.initializeApp({ credential: admin.credential.cert(serviceAccount) })
const db = admin.firestore()

async function main() {
    const targetDate = '2026-05-22'
    const targetTeams = null // 全件出す

    const shootSnap = await db.collection('shootings').get()
    const targets = []
    for (const d of shootSnap.docs) {
        const data = d.data()
        if (data.deleted === true) continue
        let sd = ''
        if (typeof data.shootDate === 'string') sd = data.shootDate.substring(0, 10)
        else if (data.shootDate?.toDate) {
            const d2 = data.shootDate.toDate()
            sd = `${d2.getFullYear()}-${String(d2.getMonth()+1).padStart(2,'0')}-${String(d2.getDate()).padStart(2,'0')}`
        }
        const team = data.team || ''
        if (sd !== targetDate) continue
        if (targetTeams && !targetTeams.some(t => team.includes(t))) continue
        targets.push({ id: d.id, ...data })
    }

    console.log(`=== Shootings on ${targetDate} (docomo / ごっこ) ===`)
    console.log('Count:', targets.length)
    for (const t of targets) {
        console.log()
        console.log(`shooting [${t.id}]`)
        console.log(`  title              : ${t.title}`)
        console.log(`  team               : ${t.team}`)
        console.log(`  notionPageId       : ${t.notionPageId}`)
        console.log(`  shootDate          : ${t.shootDate}`)
        console.log(`  slackThreadTs      : ${t.slackThreadTs || '(none)'}`)
        console.log(`  slackChannel       : ${t.slackChannel || '(none)'}`)
        console.log(`  slackPermalink     : ${t.slackPermalink || '(none)'}`)

        // 該当 castings
        const castSnap = await db.collection('castings')
            .where('projectId', '==', t.notionPageId).get()
        console.log(`  castings (projectId match): ${castSnap.size}`)
        for (const c of castSnap.docs) {
            const cd = c.data()
            const sd = cd.startDate?.toDate ? cd.startDate.toDate().toISOString().substring(0, 10) : '?'
            console.log(`    [${c.id}] ${cd.castName || '?'} (${cd.castType || '?'}) status=${cd.status || '?'} startDate=${sd}`)
            console.log(`      slackThreadTs=${cd.slackThreadTs || '(none)'}  slackChannel=${cd.slackChannel || '(none)'}`)
            console.log(`      slackPermalink=${cd.slackPermalink || '(none)'}`)
            if (cd.deleted) console.log(`      DELETED`)
        }
    }
}

main().catch(e => { console.error(e); process.exit(1) }).then(() => process.exit(0))
