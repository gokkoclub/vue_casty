/**
 * castingId 起点でスレッドを貼り直す（DRY-RUN 既定）。
 *
 * オーダーチャンネルを走査し、各メッセージ本文に含まれる castingId → そのスレッド(親ts) の
 * 対応表を作る（親メッセージ・スレッド返信の両方を収集）。
 * その対応表を「正」として castings.slackThreadTs を照合し、ズレているものを検出（/修正）。
 *
 * 実行:
 *   DRY-RUN:  SLACK_BOT_TOKEN=xxx node scripts/relink-threads-by-castingid.cjs
 *   反映:     SLACK_BOT_TOKEN=xxx node scripts/relink-threads-by-castingid.cjs --apply
 */
const admin = require('firebase-admin')
const path = require('path')
admin.initializeApp({ credential: admin.credential.cert(require(path.join(__dirname, 'serviceAccountKey.json'))) })
const db = admin.firestore()

const TOKEN = process.env.SLACK_BOT_TOKEN
const APPLY = process.argv.includes('--apply')
const CHANNELS = ['C02S1NFRH55', 'C07DTG63WQ1']
const MAX_PAGES = 12 // 1ch あたり最大 1200 メッセージ（数週間分）
const sleep = ms => new Promise(r => setTimeout(r, ms))

// 本文から castingId を抽出（Firestore 自動ID=20桁英数字 と 旧 casting_<digits>_<rand>）
function extractCastingIds(text) {
    if (!text) return []
    const ids = new Set()
    const m1 = text.match(/casting_\d+_[a-z0-9]+/g) || []
    m1.forEach(x => ids.add(x))
    // `casting` 行以降の 20桁トークン
    const idx = text.indexOf('casting')
    const scope = idx >= 0 ? text.slice(idx) : text
    const m2 = scope.match(/\b[A-Za-z0-9]{20}\b/g) || []
    m2.forEach(x => ids.add(x))
    return [...ids]
}

async function slack(method, body) {
    const res = await fetch('https://slack.com/api/' + method, {
        method: 'POST',
        headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
    })
    return res.json()
}

async function buildMap() {
    const map = new Map() // castingId -> { ts, channel }
    for (const channel of CHANNELS) {
        let cursor
        for (let page = 0; page < MAX_PAGES; page++) {
            const h = await slack('conversations.history', { channel, limit: 100, ...(cursor ? { cursor } : {}) })
            if (!h.ok || !h.messages) { console.warn('history error', channel, h.error); break }
            for (const m of h.messages) {
                const root = m.thread_ts || m.ts
                for (const id of extractCastingIds(m.text)) if (!map.has(id)) map.set(id, { ts: root, channel })
                // スレッド返信も収集（追加オーダー分の castingId は返信本文にある）
                if (m.reply_count && m.ts) {
                    let rc
                    for (let rp = 0; rp < 5; rp++) {
                        const r = await slack('conversations.replies', { channel, ts: m.ts, limit: 100, ...(rc ? { cursor: rc } : {}) })
                        await sleep(300)
                        if (!r.ok || !r.messages) break
                        for (const rm of r.messages) {
                            for (const id of extractCastingIds(rm.text)) if (!map.has(id)) map.set(id, { ts: m.ts, channel })
                        }
                        rc = r.response_metadata && r.response_metadata.next_cursor
                        if (!rc) break
                    }
                }
            }
            cursor = h.response_metadata && h.response_metadata.next_cursor
            await sleep(400)
            if (!cursor) break
        }
    }
    return map
}

async function main() {
    if (!TOKEN) { console.error('SLACK_BOT_TOKEN 未設定'); process.exit(1) }
    console.log('mode:', APPLY ? 'APPLY' : 'DRY-RUN')
    const map = await buildMap()
    console.log('Slackから収集した castingId 数:', map.size)

    // castings を照合
    const cs = await db.collection('castings').get()
    let match = 0, wrong = 0, missingTs = 0, notInSlack = 0
    const fixes = []
    for (const d of cs.docs) {
        const x = d.data()
        const info = map.get(d.id)
        if (!info) { notInSlack++; continue }
        const cur = x.slackThreadTs || ''
        if (!cur) missingTs++
        if (cur === info.ts) { match++; continue }
        wrong++
        fixes.push({ id: d.id, cast: x.castName, proj: (x.projectName || '').slice(0, 16), cur: cur || '(empty)', correct: info.ts, ch: info.channel })
    }
    console.log(`一致: ${match} / 要修正(ズレ or 空): ${wrong} (うち空 ${missingTs}) / Slackに無い: ${notInSlack}`)
    console.log('--- 要修正サンプル(先頭20) ---')
    fixes.slice(0, 20).forEach(f => console.log('  ', JSON.stringify(f)))

    if (APPLY && fixes.length > 0) {
        let batch = db.batch(), ops = 0, done = 0
        for (const f of fixes) {
            batch.update(db.collection('castings').doc(f.id), { slackThreadTs: f.correct, slackChannel: f.ch, slackPermalink: '' })
            ops++; done++
            if (ops >= 400) { await batch.commit(); batch = db.batch(); ops = 0 }
        }
        if (ops > 0) await batch.commit()
        console.log('APPLIED: castings 修正', done, '件（slackPermalink はクリア、次回参照時に再取得）')
    } else if (!APPLY) {
        console.log('※ DRY-RUN。反映するには --apply を付けて再実行')
    }
    process.exit(0)
}
main().catch(e => { console.error(e); process.exit(1) })
