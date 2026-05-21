/**
 * Notion キャスト DB のスキーマとサンプルレコードを覗く
 */
const { Client } = require('/Users/mk0012/Desktop/workspace/vue_casty/functions/node_modules/@notionhq/client')

const TOKEN = 'process.env.NOTION_TOKEN'
const DB_ID = '32f505a5277e43b8a789ae382d3421f4'

async function main() {
    const notion = new Client({ auth: TOKEN })
    const db = await notion.databases.retrieve({ database_id: DB_ID })
    console.log('=== Properties ===')
    for (const [name, prop] of Object.entries(db.properties || {})) {
        console.log(`  "${name}" (${prop.type})`)
    }

    const resp = await notion.databases.query({ database_id: DB_ID, page_size: 3 })
    console.log()
    console.log('=== Sample Pages ===')
    for (const page of resp.results) {
        console.log()
        console.log('--- page id:', page.id, '---')
        for (const [name, p] of Object.entries(page.properties || {})) {
            let val = ''
            if (p.title && p.title.length > 0) val = '[title] ' + p.title.map(t => t.plain_text).join('')
            else if (p.rich_text && p.rich_text.length > 0) val = '[rich_text] ' + p.rich_text.map(t => t.plain_text).join('').slice(0, 100)
            else if (p.select && p.select.name) val = `[select] ${p.select.name}`
            else if (p.multi_select && p.multi_select.length > 0) val = `[ms] ${p.multi_select.map(s => s.name).join(', ')}`
            else if (p.date && p.date.start) val = `[date] ${p.date.start}`
            else if (p.people && p.people.length > 0) val = `[people] ${p.people.map(s => s.name).join(', ')}`
            else if (p.checkbox !== undefined) val = `[checkbox] ${p.checkbox}`
            else if (p.number !== undefined && p.number !== null) val = `[number] ${p.number}`
            else if (p.email) val = `[email] ${p.email}`
            else if (p.phone_number) val = `[phone] ${p.phone_number}`
            else if (p.url) val = `[url] ${p.url}`
            else if (p.status && p.status.name) val = `[status] ${p.status.name}`
            else val = `[${p.type}]`
            console.log(`  ${name}: ${val}`)
        }
    }
}

main().catch(e => { console.error(e); process.exit(1) }).then(() => process.exit(0))
