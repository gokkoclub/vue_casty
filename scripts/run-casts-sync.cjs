/**
 * Notion キャスト DB → Firestore casts へ同期（admin SDK 直接実行）
 */
const admin = require('firebase-admin')
const path = require('path')
const { Client } = require('/Users/mk0012/Desktop/workspace/vue_casty/functions/node_modules/@notionhq/client')

const serviceAccount = require(path.join(__dirname, 'serviceAccountKey.json'))
admin.initializeApp({ credential: admin.credential.cert(serviceAccount) })
const db = admin.firestore()

const TOKEN = process.env.NOTION_TOKEN
const DB_ID = '32f505a5277e43b8a789ae382d3421f4'

function readTitle(p, k) {
    const x = p[k]
    return x && x.title ? x.title.map(t => t.plain_text || '').join('') : ''
}
function readRich(p, k) {
    const x = p[k]
    return x && x.rich_text ? x.rich_text.map(t => t.plain_text || '').join('') : ''
}
function readSelect(p, k) {
    const x = p[k]
    return x && x.select && x.select.name ? x.select.name : ''
}
function readUrl(p, k) {
    const x = p[k]
    return x && x.url ? x.url : ''
}
function readDate(p, k) {
    const x = p[k]
    return x && x.date && x.date.start ? x.date.start.substring(0, 10) : ''
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

async function main() {
    const notion = new Client({ auth: TOKEN })

    const allCasts = await db.collection('casts').get()
    const nameToDocId = new Map()
    for (const d of allCasts.docs) {
        const data = d.data()
        const name = (data.name || '')
        if (name && !nameToDocId.has(name)) nameToDocId.set(name, d.id)
    }
    console.log('existing casts:', allCasts.size, 'name index size:', nameToDocId.size)

    let synced = 0, added = 0, updated = 0, errors = 0, memoFound = 0
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
                const castId = readRich(props, 'CastID').trim()
                let docId = castId
                if (!docId) docId = nameToDocId.get(name) || ''
                if (!docId) docId = 'notion_' + page.id.replace(/-/g, '')

                const { memo, hasMemo } = buildMemo(props)
                if (hasMemo) memoFound++

                const existing = await db.collection('casts').doc(docId).get()
                const data = {
                    name,
                    furigana: readRich(props, 'ふりがな'),
                    gender: readSelect(props, '性別'),
                    dateOfBirth: readDate(props, '生年月日'),
                    snsX: readUrl(props, 'X(Twitter)'),
                    snsInstagram: readUrl(props, 'Instagram'),
                    snsTikTok: readUrl(props, 'TikTok'),
                    notionPageId: page.id,
                    memo,
                    hasMemo,
                    syncSource: 'notion-cast',
                    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
                }
                if (!existing.exists) { data.castType = '外部'; added++ }
                else updated++
                await db.collection('casts').doc(docId).set(data, { merge: true })
                synced++
            } catch (e) {
                console.error('error:', e.message || e)
                errors++
            }
        }
        console.log(`  progress: synced=${synced}`)
    } while (cursor)

    console.log()
    console.log(`Done. synced=${synced} added=${added} updated=${updated} memoFound=${memoFound} errors=${errors}`)
}

main().catch(e => { console.error(e); process.exit(1) }).then(() => process.exit(0))
