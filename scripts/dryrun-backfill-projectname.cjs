/**
 * Dry-run: casting.projectName を shooting.team で書き戻すバックフィルの内容確認
 * Usage: node scripts/dryrun-backfill-projectname.cjs
 */
const admin = require('firebase-admin')
const path = require('path')

const serviceAccount = require(path.join(__dirname, 'serviceAccountKey.json'))
admin.initializeApp({ credential: admin.credential.cert(serviceAccount) })
const db = admin.firestore()

async function main() {
    // shootings: notionPageId → team
    const shootSnap = await db.collection('shootings').get()
    const teamByNotionId = new Map()
    for (const s of shootSnap.docs) {
        const d = s.data()
        if (d.deleted === true) continue
        const npid = d.notionPageId
        const team = d.team || ''
        if (!npid || !team) continue
        teamByNotionId.set(npid, team)
    }

    const castingSnap = await db.collection('castings').get()
    const updates = []
    for (const c of castingSnap.docs) {
        const cd = c.data()
        const pid = cd.projectId
        if (!pid) continue
        const team = teamByNotionId.get(pid)
        if (!team) continue
        const current = cd.projectName || ''
        if (current === team) continue
        updates.push({ id: c.id, from: current, to: team, castName: cd.castName, account: cd.accountName })
    }

    console.log('=== Backfill DryRun ===')
    console.log('Total castings considered :', castingSnap.size)
    console.log('Total shootings (active)  :', teamByNotionId.size)
    console.log('Update candidates         :', updates.length)
    console.log()
    console.log('--- Preview (first 100) ---')
    for (const u of updates.slice(0, 100)) {
        console.log(`  [${u.id}] ${u.castName || '?'} (${u.account || '?'}) :  "${u.from}"  →  "${u.to}"`)
    }
    if (updates.length > 100) {
        console.log(`  ... and ${updates.length - 100} more`)
    }

    // from の頻度トップ10（変更前にどんな値が入っていたか俯瞰）
    const fromCount = new Map()
    for (const u of updates) fromCount.set(u.from, (fromCount.get(u.from) || 0) + 1)
    const top = [...fromCount.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10)
    console.log()
    console.log('--- Top 10 旧 projectName 値 ---')
    for (const [name, n] of top) {
        console.log(`  ${n.toString().padStart(4)} × "${name}"`)
    }
}

main().catch(e => { console.error(e); process.exit(1) }).then(() => process.exit(0))
