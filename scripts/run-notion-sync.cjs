/**
 * Notion DB から直接同期して shootings へ書き込み（admin SDK 直接実行版）
 * syncFromNotion CF と同じロジック
 */
const admin = require('firebase-admin')
const path = require('path')
const { Client } = require('/Users/mk0012/Desktop/workspace/vue_casty/functions/node_modules/@notionhq/client')

const serviceAccount = require(path.join(__dirname, 'serviceAccountKey.json'))
admin.initializeApp({ credential: admin.credential.cert(serviceAccount) })
const db = admin.firestore()

const NOTION_TOKEN = 'process.env.NOTION_TOKEN'
const NOTION_DATABASE_ID = 'c9ee418a40f64f4ca0cc542b2470024b'

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

    let synced = 0, added = 0, updated = 0, errors = 0, restored = 0
    const incomingNotionIds = new Set()

    let cursor = undefined
    do {
        const resp = await notion.databases.query({
            database_id: NOTION_DATABASE_ID,
            start_cursor: cursor,
            page_size: 100,
        })
        cursor = resp.has_more ? resp.next_cursor : undefined

        for (const page of resp.results) {
            try {
                if (page.archived) continue
                const notionPageId = page.id
                incomingNotionIds.add(notionPageId)
                const props = page.properties || {}

                const title = readTitle(props)
                const account = readSelect(props, 'アカウント')
                const team = readSelect(props, '撮影チーム')
                const shootDate = readDate(props)
                const teamValue = account || team || ''

                const baseDocId = notionPageId.replace(/[/.]/g, '_').replace(/^__/, 'xx').trim()
                if (!baseDocId) continue

                const ref = db.collection('shootings').doc(baseDocId)
                const existing = await ref.get()
                const shootingData = {
                    title,
                    shootDate,
                    team: teamValue,
                    teamFromAccount: !!account,
                    notionPageId,
                    notionUrl: 'https://www.notion.so/' + notionPageId.replace(/-/g, ''),
                    syncSource: 'notion-direct',
                    deleted: false,
                    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
                }
                if (existing.exists) {
                    const existingData = existing.data()
                    const existingDate = existingData.shootDate || ''
                    if (existingDate && shootDate && existingDate !== shootDate) {
                        shootingData.dateHistory = admin.firestore.FieldValue.arrayUnion({
                            from: existingDate, to: shootDate, changedAt: new Date()
                        })
                    }
                    if (existingData.deleted === true) restored++
                    updated++
                } else {
                    added++
                }
                await ref.set(shootingData, { merge: true })
                synced++
            } catch (e) {
                console.error('page error:', e.message || e)
                errors++
            }
        }
        console.log(`  progress: synced=${synced}`)
    } while (cursor)

    // 削除検知
    let deletedMarked = 0
    const all = await db.collection('shootings').get()
    const toMark = []
    for (const s of all.docs) {
        const sd = s.data()
        const pageId = sd.notionPageId
        if (!pageId) continue
        if (!incomingNotionIds.has(pageId) && sd.deleted !== true) {
            toMark.push(s.ref)
        }
    }
    for (let i = 0; i < toMark.length; i += 500) {
        const chunk = toMark.slice(i, i + 500)
        const batch = db.batch()
        for (const r of chunk) {
            batch.update(r, {
                deleted: true,
                deletedAt: admin.firestore.FieldValue.serverTimestamp(),
            })
        }
        await batch.commit()
        deletedMarked += chunk.length
    }

    console.log()
    console.log('=== Done ===')
    console.log(`synced=${synced} added=${added} updated=${updated} deletedMarked=${deletedMarked} restored=${restored} errors=${errors}`)
}

main().catch(e => { console.error(e); process.exit(1) }).then(() => process.exit(0))
