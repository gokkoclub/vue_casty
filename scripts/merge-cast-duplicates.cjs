/**
 * 同名キャストの重複を集約
 * - canonical = syncSource='notion-cast' && notionPageId あり のドキュメント
 * - 同名グループ内の他ドキュメント (syncSource なし系) を canonical にマージしてから削除
 * - castings.castId が orphan を参照していたら canonical に付け替え
 * - 両方 notion-cast (別 notionPageId) のグループはスキップ
 *
 * Usage:
 *   node scripts/merge-cast-duplicates.cjs           (dryRun)
 *   node scripts/merge-cast-duplicates.cjs --apply
 */
const admin = require('firebase-admin')
const path = require('path')

const serviceAccount = require(path.join(__dirname, 'serviceAccountKey.json'))
admin.initializeApp({ credential: admin.credential.cert(serviceAccount) })
const db = admin.firestore()

const dryRun = !process.argv.includes('--apply')

async function main() {
    const snap = await db.collection('casts').get()
    const byName = new Map()
    for (const d of snap.docs) {
        const data = d.data()
        const name = (data.name || '').trim()
        if (!name) continue
        if (!byName.has(name)) byName.set(name, [])
        byName.get(name).push({ id: d.id, ref: d.ref, data })
    }

    // canonical を決める優先順位
    //  1. CastID 形式 (cast_NNNNN) で番号が小さい (= GAS が先に採番した既存ドキュメント)
    //  2. それ以外 (notion_xxx, ハイフン入りなど) は orphan
    function rank(doc) {
        const id = doc.id
        if (/^cast_\d+$/.test(id)) {
            const n = parseInt(id.replace('cast_', ''), 10)
            return { tier: 1, num: n }
        }
        return { tier: 2, num: 0 }
    }

    const plan = [] // { name, canonical, orphans, skip }
    for (const [name, arr] of byName) {
        if (arr.length <= 1) continue
        // tier 1 (cast_NNNNN) 内では番号小さい方を canonical、それ以外は orphan
        const sorted = [...arr].sort((a, b) => {
            const ra = rank(a)
            const rb = rank(b)
            if (ra.tier !== rb.tier) return ra.tier - rb.tier
            return ra.num - rb.num
        })
        const canonical = sorted[0]
        const orphans = sorted.slice(1)
        plan.push({ name, canonical, orphans, skip: null })
    }

    console.log(`=== merge-cast-duplicates (${dryRun ? 'DRYRUN' : 'APPLY'}) ===`)
    let willMerge = 0
    let skipped = 0
    for (const p of plan) {
        console.log()
        console.log(`  "${p.name}"`)
        if (p.skip) {
            console.log(`    SKIP (${p.skip})`)
            for (const o of p.orphans) console.log(`      [${o.id}] sync=${o.data.syncSource || '(none)'} npid=${o.data.notionPageId || '(none)'}`)
            skipped++
            continue
        }
        console.log(`    canonical: [${p.canonical.id}] notionPageId=${p.canonical.data.notionPageId}`)
        for (const o of p.orphans) {
            console.log(`    delete:    [${o.id}] sync=${o.data.syncSource || '(none)'} hasMemo=${!!o.data.hasMemo}`)
            willMerge++
        }
    }
    console.log(`\nWill merge orphans: ${willMerge}, Skipped groups: ${skipped}`)

    if (dryRun) {
        console.log('\nRun with --apply to commit.')
        return
    }

    let deletedCount = 0
    let migratedCastings = 0
    for (const p of plan) {
        if (p.skip) continue
        const canonical = p.canonical
        for (const o of p.orphans) {
            // castings.castId 付け替え
            const castMatch = await db.collection('castings').where('castId', '==', o.id).get()
            const batch = db.batch()
            for (const cd of castMatch.docs) {
                batch.update(cd.ref, {
                    castId: canonical.id,
                    castIdMigratedFrom: o.id,
                })
                migratedCastings++
            }
            // orphan の memo / hasMemo / 画像 / slack ID 等のうち canonical に無い情報を引き継ぐ
            const fieldsToInherit = {}
            const cd = canonical.data
            const od = o.data
            // memo の統合（両方あれば連結）
            if (od.memo && od.memo.trim()) {
                if (!cd.memo || !cd.memo.trim()) {
                    fieldsToInherit.memo = od.memo
                    fieldsToInherit.hasMemo = true
                } else if (!cd.memo.includes(od.memo)) {
                    fieldsToInherit.memo = `${cd.memo}\n\n${od.memo}`
                    fieldsToInherit.hasMemo = true
                }
            }
            // 画像 / slack ID / 事務所 等のうち canonical で空のもの
            for (const k of ['imageUrl', 'slackMentionId', 'agency', 'email', 'castType']) {
                if (od[k] && !cd[k]) fieldsToInherit[k] = od[k]
            }
            if (Object.keys(fieldsToInherit).length > 0) {
                batch.update(canonical.ref, {
                    ...fieldsToInherit,
                    mergedFrom: admin.firestore.FieldValue.arrayUnion(o.id),
                    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
                })
            }
            // orphan を物理削除
            batch.delete(o.ref)
            deletedCount++
            await batch.commit()
        }
    }
    console.log(`\nDone. orphans deleted=${deletedCount}, castings migrated=${migratedCastings}`)
}

main().catch(e => { console.error(e); process.exit(1) }).then(() => process.exit(0))
