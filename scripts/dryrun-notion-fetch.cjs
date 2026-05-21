/**
 * Notion DB から 5 件取得してプロパティ構造を確認（書き込みなし）
 */
const { Client } = require('/Users/mk0012/Desktop/workspace/vue_casty/functions/node_modules/@notionhq/client')

const NOTION_TOKEN = 'process.env.NOTION_TOKEN'
const NOTION_DATABASE_ID = 'c9ee418a40f64f4ca0cc542b2470024b'

async function main() {
    const notion = new Client({ auth: NOTION_TOKEN })

    // DB schema を確認
    const dbInfo = await notion.databases.retrieve({ database_id: NOTION_DATABASE_ID })
    console.log('=== Database Properties ===')
    for (const [name, prop] of Object.entries(dbInfo.properties || {})) {
        console.log(`  "${name}" (${prop.type})`)
    }

    // クエリ
    const resp = await notion.databases.query({
        database_id: NOTION_DATABASE_ID,
        page_size: 5,
    })

    console.log()
    console.log('=== Sample Pages ===')
    for (const page of resp.results) {
        console.log()
        console.log('--- page id:', page.id, '---')
        const props = page.properties || {}
        for (const [name, p] of Object.entries(props)) {
            let val = ''
            if (p.title && p.title.length > 0) val = p.title.map(t => t.plain_text).join('')
            else if (p.rich_text && p.rich_text.length > 0) val = p.rich_text.map(t => t.plain_text).join('')
            else if (p.select && p.select.name) val = `[select] ${p.select.name}`
            else if (p.multi_select && p.multi_select.length > 0) val = `[ms] ${p.multi_select.map(s => s.name).join(', ')}`
            else if (p.date && p.date.start) val = `[date] ${p.date.start}`
            else if (p.people && p.people.length > 0) val = `[people] ${p.people.map(s => s.name).join(', ')}`
            else if (p.relation && p.relation.length > 0) val = `[relation] ${p.relation.length} items`
            else if (p.checkbox !== undefined) val = `[checkbox] ${p.checkbox}`
            else if (p.number !== undefined && p.number !== null) val = `[number] ${p.number}`
            else if (p.formula) val = `[formula] ${JSON.stringify(p.formula).slice(0, 60)}`
            else if (p.status && p.status.name) val = `[status] ${p.status.name}`
            else val = `[${p.type}]`
            console.log(`  ${name}: ${val}`)
        }
    }
}

main().catch(e => { console.error(e); process.exit(1) }).then(() => process.exit(0))
