/**
 * 強化版 syncCastsFromNotion を admin SDK 直接実行
 * 機能: CastID 採番 / Notion 書き戻し / memo / 削除検知
 *
 * Usage:
 *   node scripts/run-casts-sync-v2.cjs                  (dryRun - Firestore 書き込みも Notion 書き戻しもしない)
 *   node scripts/run-casts-sync-v2.cjs --apply          (Firestore 書き込み + Notion 書き戻し)
 *   node scripts/run-casts-sync-v2.cjs --apply --no-writeback (Firestore のみ)
 */
const admin = require('firebase-admin')
const path = require('path')
const { Client } = require('/Users/mk0012/Desktop/workspace/vue_casty/functions/node_modules/@notionhq/client')

const serviceAccount = require(path.join(__dirname, 'serviceAccountKey.json'))
admin.initializeApp({ credential: admin.credential.cert(serviceAccount) })
const db = admin.firestore()

const TOKEN = 'process.env.NOTION_TOKEN'
const DB_ID = '32f505a5277e43b8a789ae382d3421f4'
const apply = process.argv.includes('--apply')
const writeBack = apply && !process.argv.includes('--no-writeback')

function readTitle(p, k) { const x = p[k]; return x && x.title ? x.title.map(t => t.plain_text || '').join('') : '' }
function readRich(p, k) { const x = p[k]; return x && x.rich_text ? x.rich_text.map(t => t.plain_text || '').join('') : '' }
function readSelect(p, k) { const x = p[k]; return x && x.select && x.select.name ? x.select.name : '' }
function readUrl(p, k) { const x = p[k]; return x && x.url ? x.url : '' }
function readDate(p, k) { const x = p[k]; return x && x.date && x.date.start ? x.date.start.substring(0, 10) : '' }
function readRollupString(p, k) {
    const r = p[k]
    const arr = r && r.rollup && r.rollup.array
    if (!arr) return ''
    for (const it of arr) {
        const t = it.type
        if (t === 'title' || t === 'rich_text') {
            return (it[t] || []).map(x => x.plain_text || '').join('')
        }
        if (t === 'select' && it.select?.name) return it.select.name
    }
    return ''
}
function readFileUrl(p, k) {
    const x = p[k]
    const f = x && x.files && x.files[0]
    if (!f) return ''
    return (f.file && f.file.url) || (f.external && f.external.url) || ''
}
function buildMemo(props) {
    const fields = [
        { label: 'NG・制限事項', key: 'NG・制限事項' },
        { label: 'アレルギー', key: 'アレルギー' },
        { label: '金額_特記事項', key: '金額_特記事項' },
        { label: '備考欄', key: '備考欄' },
    ]
    const lines = []
    for (const f of fields) {
        const v = readRich(props, f.key).trim()
        if (v) lines.push(`【${f.label}】\n${v}`)
    }
    const memo = lines.join('\n\n')
    return { memo, hasMemo: memo.length > 0 }
}
function nextCastId(maxNum) {
    return 'cast_' + String(maxNum + 1).padStart(5, '0')
}

async function main() {
    console.log(`=== syncCastsFromNotion v2 (${apply ? 'APPLY' : 'DRYRUN'}, writeBack=${writeBack}) ===`)
    const notion = new Client({ auth: TOKEN })

    const allCasts = await db.collection('casts').get()
    const nameToDocId = new Map()
    let maxNum = 0
    for (const d of allCasts.docs) {
        const data = d.data()
        const name = (data.name || '')
        if (name && !nameToDocId.has(name)) nameToDocId.set(name, d.id)
        const m = d.id.match(/^cast_(\d+)$/)
        if (m) {
            const n = parseInt(m[1], 10)
            if (!isNaN(n) && n > maxNum) maxNum = n
        }
    }
    console.log(`existing casts: ${allCasts.size}, max num: ${maxNum}`)

    let synced = 0, added = 0, updated = 0, errors = 0, memoFound = 0, castIdWrittenBack = 0
    const incomingCastIds = new Set()
    const writeBackCandidates = []
    let cursor = undefined
    do {
        const resp = await notion.databases.query({ database_id: DB_ID, start_cursor: cursor, page_size: 100 })
        cursor = resp.has_more ? resp.next_cursor : undefined
        for (const page of resp.results) {
            try {
                if (page.archived) continue
                const props = page.properties
                const name = readTitle(props, '名前').trim()
                if (!name) continue
                let castId = readRich(props, 'CastID').trim()
                let needWriteBack = false
                if (!castId) {
                    const existing = nameToDocId.get(name)
                    if (existing && /^cast_\d+$/.test(existing)) {
                        castId = existing
                        needWriteBack = true
                    } else {
                        castId = nextCastId(maxNum)
                        maxNum++
                        needWriteBack = true
                    }
                    writeBackCandidates.push({ name, castId, pageId: page.id })
                }
                incomingCastIds.add(castId)

                const { memo, hasMemo } = buildMemo(props)
                if (hasMemo) memoFound++

                const updateData = {
                    name,
                    furigana: readRich(props, 'ふりがな'),
                    gender: readSelect(props, '性別'),
                    dateOfBirth: readDate(props, '生年月日'),
                    snsX: readUrl(props, 'X(Twitter)'),
                    snsInstagram: readUrl(props, 'Instagram'),
                    snsTikTok: readUrl(props, 'TikTok'),
                    imageUrl: readFileUrl(props, 'アイコン_Gドライブリンク'),
                    agency: readRollupString(props, '事務所'),
                    notionPageId: page.id,
                    memo,
                    hasMemo,
                    syncSource: 'notion-cf',
                    deleted: false,
                    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
                }

                if (apply) {
                    const ref = db.collection('casts').doc(castId)
                    const existing = await ref.get()
                    if (!existing.exists) {
                        updateData.castType = '外部'
                        updateData.createdAt = admin.firestore.FieldValue.serverTimestamp()
                        added++
                    } else {
                        updated++
                    }
                    await ref.set(updateData, { merge: true })
                }
                if (!nameToDocId.has(name)) nameToDocId.set(name, castId)
                synced++

                if (needWriteBack && writeBack) {
                    try {
                        await notion.pages.update({
                            page_id: page.id,
                            properties: { 'CastID': { rich_text: [{ type: 'text', text: { content: castId } }] } },
                        })
                        castIdWrittenBack++
                    } catch (e) {
                        console.warn(`writeBack failed for ${name}:`, e.message || e)
                    }
                }
            } catch (e) {
                console.error('page error:', e.message || e)
                errors++
            }
        }
        if (apply) console.log(`  progress: synced=${synced}`)
    } while (cursor)

    // 削除検知
    let toDeleteCount = 0
    if (apply) {
        const toMark = []
        for (const d of allCasts.docs) {
            if (!/^cast_\d+$/.test(d.id)) continue
            if (incomingCastIds.has(d.id)) continue
            const sd = d.data()
            if (sd.deleted === true) continue
            toMark.push(d.ref)
        }
        for (let i = 0; i < toMark.length; i += 500) {
            const chunk = toMark.slice(i, i + 500)
            const batch = db.batch()
            for (const r of chunk) {
                batch.update(r, { deleted: true, deletedAt: admin.firestore.FieldValue.serverTimestamp() })
            }
            await batch.commit()
            toDeleteCount += chunk.length
        }
    } else {
        for (const d of allCasts.docs) {
            if (!/^cast_\d+$/.test(d.id)) continue
            if (incomingCastIds.has(d.id)) continue
            if (d.data().deleted === true) continue
            toDeleteCount++
        }
    }

    console.log()
    console.log('=== Summary ===')
    console.log(`synced (Notion pages): ${synced}`)
    console.log(`added (new docs):     ${added}`)
    console.log(`updated:              ${updated}`)
    console.log(`memo found:           ${memoFound}`)
    console.log(`will be deleted:      ${toDeleteCount}`)
    console.log(`writeBack candidates (no CastID in Notion): ${writeBackCandidates.length}`)
    if (writeBackCandidates.length > 0) {
        console.log(`  first 20:`)
        for (const w of writeBackCandidates.slice(0, 20)) {
            console.log(`    ${w.name} → ${w.castId}`)
        }
    }
    console.log(`castIdWrittenBack:    ${castIdWrittenBack}`)
    console.log(`errors:               ${errors}`)
}

main().catch(e => { console.error(e); process.exit(1) }).then(() => process.exit(0))
