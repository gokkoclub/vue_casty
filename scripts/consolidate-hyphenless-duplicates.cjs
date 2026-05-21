/**
 * ハイフン無し docId（古い syncFromSam 形式）と
 * ハイフン付き docId（新しい syncFromNotion 形式）の重複を集約。
 *
 * 同じ NotionPageId（正規化キー）で複数 shooting がある場合:
 *   - Notion に存在する notionPageId を持つドキュメントを正
 *   - もう片方は deleted:true マーク + casting.projectId をマイグレート
 *
 * Usage:
 *   node scripts/consolidate-hyphenless-duplicates.cjs            (dryRun)
 *   node scripts/consolidate-hyphenless-duplicates.cjs --apply
 */
const admin = require('firebase-admin')
const path = require('path')
const { Client } = require('/Users/mk0012/Desktop/workspace/vue_casty/functions/node_modules/@notionhq/client')

const serviceAccount = require(path.join(__dirname, 'serviceAccountKey.json'))
admin.initializeApp({ credential: admin.credential.cert(serviceAccount) })
const db = admin.firestore()

const NOTION_TOKEN = 'process.env.NOTION_TOKEN'
const NOTION_DATABASE_ID = 'c9ee418a40f64f4ca0cc542b2470024b'
const dryRun = !process.argv.includes('--apply')

function normalize(id) {
    return (id || '').replace(/-/g, '').toLowerCase()
}

async function main() {
    // Notion 側の生 ID
    const notion = new Client({ auth: NOTION_TOKEN })
    const notionRawIds = new Set()
    let cursor
    do {
        const resp = await notion.databases.query({
            database_id: NOTION_DATABASE_ID, start_cursor: cursor, page_size: 100
        })
        cursor = resp.has_more ? resp.next_cursor : undefined
        for (const p of resp.results) {
            if (!p.archived) notionRawIds.add(p.id)
        }
    } while (cursor)

    // 全 shooting を正規化キーでグルーピング
    const snap = await db.collection('shootings').get()
    const groups = new Map() // norm -> [docs]
    for (const d of snap.docs) {
        const data = d.data()
        const pid = data.notionPageId
        if (!pid) continue
        const norm = normalize(pid)
        if (!groups.has(norm)) groups.set(norm, [])
        groups.get(norm).push({
            id: d.id,
            ref: d.ref,
            notionPageId: pid,
            title: data.title || '',
            team: data.team || '',
            shootDate: data.shootDate || '',
            deleted: data.deleted === true,
            existsInNotion: notionRawIds.has(pid),
        })
    }

    // 重複グループ
    const plan = []
    for (const [norm, arr] of groups) {
        if (arr.length <= 1) continue
        const active = arr.filter(i => !i.deleted)
        if (active.length <= 1) continue // active が 1 件以下なら問題なし
        // canonical: existsInNotion=true && ハイフン付き notionPageId
        const canonical = active.find(i => i.existsInNotion && i.notionPageId.includes('-'))
            || active.find(i => i.existsInNotion)
        const others = active.filter(i => i !== canonical)
        plan.push({ norm, canonical, others, all: arr })
    }

    console.log(`=== Hyphenless duplicate consolidation (${dryRun ? 'DRYRUN' : 'APPLY'}) ===`)
    console.log('duplicate groups (active >= 2):', plan.length)

    for (const p of plan.slice(0, 30)) {
        console.log()
        console.log(`  group: ${p.norm}`)
        if (p.canonical) {
            console.log(`    canonical: [${p.canonical.id}] notionPageId="${p.canonical.notionPageId}" title="${p.canonical.title}"`)
        } else {
            console.log(`    canonical: (none)`)
        }
        for (const o of p.others) {
            console.log(`    delete:    [${o.id}] notionPageId="${o.notionPageId}" title="${o.title}"`)
        }
    }
    if (plan.length > 30) console.log(`  ... and ${plan.length - 30} more`)

    if (dryRun) {
        console.log('\nRun with --apply to commit.')
        return
    }

    let deletedCount = 0
    let migratedCastings = 0
    for (const p of plan) {
        if (!p.canonical) continue
        for (const o of p.others) {
            const castMatch = await db.collection('castings').where('projectId', '==', o.notionPageId).get()
            const batch = db.batch()
            for (const cd of castMatch.docs) {
                batch.update(cd.ref, {
                    projectId: p.canonical.notionPageId,
                    projectIdMigratedFrom: o.notionPageId,
                })
                migratedCastings++
            }
            batch.update(o.ref, {
                deleted: true,
                deletedAt: admin.firestore.FieldValue.serverTimestamp(),
                consolidatedInto: p.canonical.id,
                deletedReason: 'hyphenless-duplicate',
            })
            deletedCount++
            await batch.commit()
        }
    }
    console.log(`\nDone. shootings deleted=${deletedCount}, castings migrated=${migratedCastings}`)
}

main().catch(e => { console.error(e); process.exit(1) }).then(() => process.exit(0))
