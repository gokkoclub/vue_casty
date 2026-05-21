/**
 * 5/22 の撮影について、Notion と Firestore を突合
 */
const admin = require('firebase-admin')
const path = require('path')
const { Client } = require('/Users/mk0012/Desktop/workspace/vue_casty/functions/node_modules/@notionhq/client')

const serviceAccount = require(path.join(__dirname, 'serviceAccountKey.json'))
admin.initializeApp({ credential: admin.credential.cert(serviceAccount) })
const db = admin.firestore()

const NOTION_TOKEN = 'process.env.NOTION_TOKEN'
const NOTION_DATABASE_ID = 'c9ee418a40f64f4ca0cc542b2470024b'
const TARGET = '2026-05-22'

function readTitle(p) {
    const t = p['仮台本名']
    if (t && t.title && t.title.length > 0) return t.title.map(x => x.plain_text || '').join('')
    return ''
}
function readSelect(p, key) {
    const x = p[key]
    return x && x.select && x.select.name ? x.select.name : ''
}
function readDate(p) {
    const x = p['撮影日']
    return x && x.date && x.date.start ? x.date.start.substring(0, 10) : ''
}

async function main() {
    const notion = new Client({ auth: NOTION_TOKEN })
    const notionMatches = []
    let cursor
    do {
        const resp = await notion.databases.query({
            database_id: NOTION_DATABASE_ID,
            filter: { property: '撮影日', date: { equals: TARGET } },
            page_size: 100,
            start_cursor: cursor,
        })
        cursor = resp.has_more ? resp.next_cursor : undefined
        for (const page of resp.results) {
            if (page.archived) continue
            const p = page.properties || {}
            notionMatches.push({
                pageId: page.id,
                title: readTitle(p),
                account: readSelect(p, 'アカウント'),
                team: readSelect(p, '撮影チーム'),
                date: readDate(p),
            })
        }
    } while (cursor)

    console.log(`=== Notion 上の ${TARGET} 撮影 (${notionMatches.length}件) ===`)
    for (const n of notionMatches) {
        console.log(`  [${n.pageId}] title="${n.title}" account="${n.account}" team="${n.team}"`)
    }

    // Firestore の同日 active shooting
    const snap = await db.collection('shootings').get()
    const firestoreMatches = []
    for (const d of snap.docs) {
        const data = d.data()
        if (data.deleted === true) continue
        let sd = ''
        if (typeof data.shootDate === 'string') sd = data.shootDate.substring(0, 10)
        else if (data.shootDate?.toDate) {
            const d2 = data.shootDate.toDate()
            sd = `${d2.getFullYear()}-${String(d2.getMonth()+1).padStart(2,'0')}-${String(d2.getDate()).padStart(2,'0')}`
        }
        if (sd !== TARGET) continue
        firestoreMatches.push({
            id: d.id,
            title: data.title || '',
            team: data.team || '',
            notionPageId: data.notionPageId || '',
            syncSource: data.syncSource || '',
        })
    }
    console.log()
    console.log(`=== Firestore 上の ${TARGET} active shooting (${firestoreMatches.length}件) ===`)
    for (const f of firestoreMatches) {
        const inNotion = notionMatches.some(n => n.pageId === f.notionPageId)
        console.log(`  [${f.id}] title="${f.title}" team="${f.team}" syncSource=${f.syncSource} inNotion=${inNotion}`)
    }
}

main().catch(e => { console.error(e); process.exit(1) }).then(() => process.exit(0))
