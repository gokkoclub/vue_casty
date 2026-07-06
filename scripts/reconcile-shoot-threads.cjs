/**
 * 1撮影(作品+撮影日) = 1スレッド に揃える棚卸し（DRY-RUN 既定）。
 * 追加オーダーが誤スレッドに返信投稿されて分裂したケース(例: 吉岡択)を、
 * 同じ (projectId + 撮影日) のアクティブ casting の「多数派スレッド」に寄せる。
 * タイ(同数)は自動判定せずスキップ（報告のみ）。
 *
 *   DRY-RUN: node scripts/reconcile-shoot-threads.cjs
 *   反映:    node scripts/reconcile-shoot-threads.cjs --apply
 */
const admin = require('firebase-admin')
const path = require('path')
admin.initializeApp({ credential: admin.credential.cert(require(path.join(__dirname, 'serviceAccountKey.json'))) })
const db = admin.firestore()
const APPLY = process.argv.includes('--apply')
const ds = v => v && v.toDate ? v.toDate().toISOString().slice(0, 10) : ''
const isActive = x => x.deleted !== true && !['キャンセル', 'NG', '削除済み'].includes(x.status)

async function main() {
    const cs = await db.collection('castings').get()
    const groups = new Map() // projectId__date -> [{ref,id,cast,ts,ch}]
    for (const d of cs.docs) {
        const x = d.data()
        if (!x.projectId || !isActive(x)) continue
        const key = x.projectId + '__' + ds(x.startDate)
        const arr = groups.get(key) || []
        arr.push({ ref: d.ref, id: d.id, cast: x.castName, proj: x.projectName, ts: x.slackThreadTs || '', ch: x.slackChannel || '' })
        groups.set(key, arr)
    }

    const moves = []
    let splitGroups = 0, ties = 0
    for (const [key, arr] of groups) {
        const counts = {}
        for (const c of arr) if (c.ts) counts[c.ts] = (counts[c.ts] || 0) + 1
        const distinct = Object.keys(counts)
        if (distinct.length <= 1) continue
        splitGroups++
        // 多数派スレッド
        const sorted = distinct.sort((a, b) => counts[b] - counts[a])
        if (counts[sorted[0]] === counts[sorted[1]]) { ties++; console.log('TIE(skip):', key, JSON.stringify(counts)); continue }
        const majority = sorted[0]
        const majCh = (arr.find(c => c.ts === majority) || {}).ch || ''
        for (const c of arr) {
            if (c.ts && c.ts !== majority) moves.push({ ...c, correct: majority, ch: majCh, key })
        }
    }
    console.log(`分裂グループ: ${splitGroups} (タイでスキップ: ${ties}) / 寄せ替え対象 casting: ${moves.length}`)
    for (const m of moves.slice(0, 30)) console.log('  ', JSON.stringify({ cast: m.cast, proj: (m.proj || '').slice(0, 16), from: m.ts, to: m.correct }))

    if (APPLY && moves.length > 0) {
        let batch = db.batch(), ops = 0
        for (const m of moves) {
            batch.update(m.ref, { slackThreadTs: m.correct, slackChannel: m.ch || undefined, slackPermalink: '' })
            if (++ops >= 400) { await batch.commit(); batch = db.batch(); ops = 0 }
        }
        if (ops > 0) await batch.commit()
        console.log('APPLIED:', moves.length, '件を多数派スレッドに寄せ替え')
    } else if (!APPLY) console.log('※ DRY-RUN。反映は --apply')
    process.exit(0)
}
main().catch(e => { console.error(e); process.exit(1) })
