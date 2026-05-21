/**
 * Notion API から全件取得し、現在の shootings.team とどう違うか比較
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
    if (t && t.title) return t.title.map(x => x.plain_text || '').join('')
    return ''
}
function readProjectTitle(p) {
    for (const k of ['作品タイトル1', '作品タイトル2', '作品タイトル3', '作品タイトル4']) {
        const x = p[k]
        if (x && x.rich_text && x.rich_text.length > 0) {
            return x.rich_text.map(t => t.plain_text || '').join('')
        }
    }
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
    const notionMap = new Map() // notionPageId -> {title, project, account, team, date}

    let cursor = undefined
    do {
        const resp = await notion.databases.query({
            database_id: NOTION_DATABASE_ID,
            start_cursor: cursor,
            page_size: 100,
        })
        cursor = resp.has_more ? resp.next_cursor : undefined
        for (const page of resp.results) {
            if (page.archived) continue
            const props = page.properties || {}
            notionMap.set(page.id, {
                kariTitle: readTitle(props),
                projectTitle: readProjectTitle(props),
                account: readSelect(props, 'アカウント'),
                team: readSelect(props, '撮影チーム'),
                shootDate: readDate(props),
            })
        }
    } while (cursor)

    console.log(`Notion pages: ${notionMap.size}`)

    // 現在の shootings (active のみ) と比較
    const shootSnap = await db.collection('shootings').get()
    let bothMatch = 0
    let teamWillChange = 0
    let titleWillChange = 0
    const accountStats = { withAccount: 0, withoutAccount: 0 }
    const accountSamples = []
    const teamChangeSamples = []
    const titleChangeSamples = []

    for (const d of shootSnap.docs) {
        const sd = d.data()
        if (sd.deleted === true) continue
        const pid = sd.notionPageId
        if (!pid) continue
        const n = notionMap.get(pid)
        if (!n) continue
        bothMatch++

        if (n.account) accountStats.withAccount++
        else accountStats.withoutAccount++
        if (accountSamples.length < 10 && n.account) accountSamples.push({ id: d.id, account: n.account, currentTeam: sd.team })

        const newTeam = n.account || n.team || ''
        if (newTeam && newTeam !== (sd.team || '')) {
            teamWillChange++
            if (teamChangeSamples.length < 10) teamChangeSamples.push({ id: d.id, from: sd.team || '(empty)', to: newTeam, title: sd.title })
        }

        // タイトルとして使うべき値: projectTitle 優先、なければ kariTitle
        const newTitle = n.projectTitle || n.kariTitle || ''
        if (newTitle && newTitle !== (sd.title || '')) {
            titleWillChange++
            if (titleChangeSamples.length < 10) titleChangeSamples.push({ id: d.id, from: sd.title || '(empty)', to: newTitle })
        }
    }

    console.log()
    console.log('=== Summary ===')
    console.log('shooting × notion match :', bothMatch)
    console.log('with account            :', accountStats.withAccount)
    console.log('without account         :', accountStats.withoutAccount)
    console.log('team WILL change        :', teamWillChange)
    console.log('title WILL change       :', titleWillChange)

    console.log()
    console.log('--- Account samples ---')
    for (const s of accountSamples) console.log(`  ${s.id}: account="${s.account}" currentTeam="${s.currentTeam}"`)
    console.log()
    console.log('--- Team change samples ---')
    for (const s of teamChangeSamples) console.log(`  ${s.id}: "${s.from}" → "${s.to}" (title: ${s.title})`)
    console.log()
    console.log('--- Title change samples ---')
    for (const s of titleChangeSamples) console.log(`  ${s.id}: "${s.from}" → "${s.to}"`)
}

main().catch(e => { console.error(e); process.exit(1) }).then(() => process.exit(0))
