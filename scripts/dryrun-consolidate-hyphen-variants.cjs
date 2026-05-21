/**
 * notionPageId のハイフン有無による重複 shooting を集約する dryRun スクリプト
 *
 * 正規化キー = notionPageId.replace(/-/g, "")
 * 同じキーで複数 shooting がある場合:
 *   - Notion 側 (gokko-sam.notionSchedule) に存在する notionPageId と一致する shooting を "正" とする
 *   - その他を集約候補（deleted:true）
 *   - 集約対象に紐づく castings の projectId 書き換えが必要かも確認
 *
 * Usage:
 *   node scripts/dryrun-consolidate-hyphen-variants.cjs            (dryRun)
 *   node scripts/dryrun-consolidate-hyphen-variants.cjs --apply    (本適用)
 */
const admin = require('firebase-admin')
const path = require('path')

const serviceAccount = require(path.join(__dirname, 'serviceAccountKey.json'))
admin.initializeApp({ credential: admin.credential.cert(serviceAccount), projectId: 'gokko-casty' }, 'casty')
admin.initializeApp({ projectId: 'gokko-sam' }, 'sam')
const castyDb = admin.firestore(admin.app('casty'))
const samDb = admin.firestore(admin.app('sam'))

const dryRun = !process.argv.includes('--apply')

function normalize(id) {
    return (id || '').replace(/-/g, '').toLowerCase()
}

async function main() {
    // Notion 側の生の notionPageId 集合
    const samSnap = await samDb.collection('notionSchedule').get()
    const notionRawIds = new Set()
    const notionNormalizedToRaw = new Map() // normalized -> raw
    for (const d of samSnap.docs) {
        const pid = d.data().notionPageId
        if (!pid) continue
        notionRawIds.add(pid)
        notionNormalizedToRaw.set(normalize(pid), pid)
    }

    // Firestore shootings を正規化キーでグルーピング
    const shootSnap = await castyDb.collection('shootings').get()
    const groups = new Map() // normalized -> array
    for (const d of shootSnap.docs) {
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

    // 重複グループだけ抽出
    const duplicates = []
    for (const [norm, arr] of groups) {
        if (arr.length <= 1) continue
        duplicates.push({ norm, items: arr })
    }

    console.log(`=== Hyphen-variant duplicates (${dryRun ? 'DRYRUN' : 'APPLY'}) ===`)
    console.log('Duplicate groups:', duplicates.length)

    // 各グループの処理プラン
    const plan = []
    for (const g of duplicates) {
        const active = g.items.filter(i => !i.deleted)
        // 「正」を決める: Notion 側に存在する notionPageId と一致する shooting
        const canonical = active.find(i => i.existsInNotion)
        const others = active.filter(i => i !== canonical)

        plan.push({
            norm: g.norm,
            canonical: canonical || null,
            othersToDelete: others,
            allItems: g.items,
        })
    }

    // casting.projectId の付け替え必要件数も確認
    const castSnap = await castyDb.collection('castings').get()
    const projectIdToCasting = new Map() // raw projectId -> count
    for (const c of castSnap.docs) {
        const pid = c.data().projectId
        if (!pid) continue
        projectIdToCasting.set(pid, (projectIdToCasting.get(pid) || 0) + 1)
    }

    let totalDelete = 0
    let totalCastingMigrate = 0
    for (const p of plan.slice(0, 20)) {
        console.log()
        console.log(`  group=${p.norm}`)
        if (p.canonical) {
            console.log(`    canonical = [${p.canonical.id}] notionPageId="${p.canonical.notionPageId}" title="${p.canonical.title}"`)
        } else {
            console.log(`    canonical = (none - Notion にどれもマッチしない)`)
        }
        for (const o of p.othersToDelete) {
            const castCount = projectIdToCasting.get(o.notionPageId) || 0
            console.log(`    delete    = [${o.id}] notionPageId="${o.notionPageId}" title="${o.title}" (castings using this projectId: ${castCount})`)
            totalCastingMigrate += castCount
        }
        totalDelete += p.othersToDelete.length
    }
    if (plan.length > 20) console.log(`  ... and ${plan.length - 20} more groups`)

    // 全体集計
    let totalDeleteAll = 0
    let totalMigrateAll = 0
    let groupsWithoutCanonical = 0
    for (const p of plan) {
        if (!p.canonical) groupsWithoutCanonical++
        totalDeleteAll += p.othersToDelete.length
        for (const o of p.othersToDelete) {
            totalMigrateAll += projectIdToCasting.get(o.notionPageId) || 0
        }
    }
    console.log()
    console.log('=== Summary ===')
    console.log('Total duplicate groups            :', plan.length)
    console.log('  with canonical (Notion match)   :', plan.length - groupsWithoutCanonical)
    console.log('  without canonical               :', groupsWithoutCanonical)
    console.log('Shootings to mark deleted         :', totalDeleteAll)
    console.log('Castings whose projectId migrates :', totalMigrateAll)

    if (dryRun) {
        console.log()
        console.log('Run with --apply to commit (canonical あるグループのみ集約。canonical 無しグループはスキップ).')
        return
    }

    let deletedCount = 0
    let migratedCastings = 0
    for (const p of plan) {
        if (!p.canonical) continue // canonical 無いグループはスキップ（手動確認用）
        for (const o of p.othersToDelete) {
            // castings.projectId を canonical へ migrate
            const castMatch = await castyDb.collection('castings').where('projectId', '==', o.notionPageId).get()
            const batch = castyDb.batch()
            for (const cd of castMatch.docs) {
                batch.update(cd.ref, { projectId: p.canonical.notionPageId, projectIdMigratedFrom: o.notionPageId })
                migratedCastings++
            }
            // shooting を deleted:true
            batch.update(o.ref, {
                deleted: true,
                deletedAt: admin.firestore.FieldValue.serverTimestamp(),
                consolidatedInto: p.canonical.id,
                deletedReason: 'hyphen-variant-duplicate',
            })
            deletedCount++
            await batch.commit()
        }
    }
    console.log()
    console.log(`Done. shootings deleted=${deletedCount}, castings migrated=${migratedCastings}`)
}

main().catch(e => { console.error(e); process.exit(1) }).then(() => process.exit(0))
