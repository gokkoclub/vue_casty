/**
 * galaRates コレクションの初期投入。
 * 俳優ギャラ換算表（.numbers）の内容 + ユーザー指定の alias 追加分。
 * doc id = accountKey（再実行は merge:true で冪等）。
 */
const admin = require('firebase-admin')
const path = require('path')
admin.initializeApp({ credential: admin.credential.cert(require(path.join(__dirname, 'serviceAccountKey.json'))) })
const db = admin.firestore()

// fees: 空欄は null（補完対象外）
const ROWS = [
    { accountKey: 'ごっこ倶楽部', aliases: ['ごっこ倶楽部', 'ごっこ', 'GOKKO'], fees: { メイン: 32000, サブ: 25000, キャスト: 10000, エキストラ: 5000 }, note: 'ピュア区分（ごっこ倶楽部）' },
    { accountKey: 'ウミガメ', aliases: ['ウミガメ', 'ウミガメごっこ', 'うみがめ'], fees: { メイン: 32000, サブ: 25000, キャスト: 10000, エキストラ: 5000 }, note: 'ピュア区分' },
    { accountKey: 'daikai', aliases: ['daikai', 'Daikai', 'DAIKAI', 'ダイカイ'], fees: { メイン: 32000, サブ: 25000, キャスト: 10000, エキストラ: 5000 }, note: 'ピュア区分' },
    { accountKey: 'fandom', aliases: ['fandom', 'Fandom', 'FANDOM', 'ファンダム'], fees: { メイン: 32000, サブ: 25000, キャスト: 10000, エキストラ: 5000 }, note: 'ピュア区分相当（ごっこ/ウミガメ/daikai と同じ）' },
    { accountKey: 'まいはに', aliases: ['まいはに'], fees: { メイン: 30000, サブ: 20000, キャスト: 10000, エキストラ: 5000 }, note: '企業案件以外' },
    { accountKey: 'docomo', aliases: ['docomo', 'どこも', 'ドコモ'], fees: { メイン: 25000, サブ: 20000, キャスト: 10000, エキストラ: 5000 }, note: '運用系' },
    { accountKey: 'めでぷり', aliases: ['めでぷり'], fees: { メイン: 40000, サブ: 25000, キャスト: 10000, エキストラ: null }, note: 'サブ役名あり25000／サブ役名なし20000' },
    { accountKey: 'アコム', aliases: ['アコム'], fees: { メイン: 50000, サブ: 30000, キャスト: null, エキストラ: null }, note: '' },
    { accountKey: 'TTS', aliases: ['TTS', 'SEP-TTS', 'トキオ'], fees: { メイン: 50000, サブ: 30000, キャスト: null, エキストラ: null }, note: 'SEP-TTS・トキオ も同区分' },
    { accountKey: 'テレ東', aliases: ['テレ東', 'もしBiz', 'もしBIG', 'もしBIZ'], fees: { メイン: 50000, サブ: 30000, キャスト: null, エキストラ: null }, note: 'もしBiz/テレ東' },
    { accountKey: '三独', aliases: ['サンドク', '三独', '三独乙女', 'テレ朝', 'テレビ朝日', 'テレ朝（NEW）', 'テレ朝(NEW)'], fees: { メイン: 25000, サブ: 20000, キャスト: null, エキストラ: null }, note: 'テレビ朝日／docomo同等／別IPでリスタート予定のため変動可能性あり' },
]

async function main() {
    let n = 0
    for (const r of ROWS) {
        // null の fee は除去（undefined 不可なので落とす）
        const fees = {}
        for (const k of ['メイン', 'サブ', 'キャスト', 'エキストラ']) {
            if (r.fees[k] != null) fees[k] = r.fees[k]
        }
        await db.collection('galaRates').doc(r.accountKey).set({
            accountKey: r.accountKey,
            aliases: r.aliases,
            fees,
            note: r.note || '',
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        }, { merge: true })
        n++
    }
    console.log(`galaRates seeded: ${n} 件`)
}
main().catch(e => { console.error(e); process.exit(1) }).then(() => process.exit(0))
