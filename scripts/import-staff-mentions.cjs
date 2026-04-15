/**
 * staffMentions コレクションへの CSV インポート
 *
 * CSV: "キャストDB - 内部キャストDB.csv"
 *   カラム: 本名, fullname, displayname, email, userid
 *
 * 出力: Firestore `staffMentions` コレクション
 *   doc ID  : Slack userId（冪等 upsert にするため）
 *   fields  : name, slackMentionId, email, aliases[], role, active, source, createdAt, updatedAt
 *
 * Usage:
 *   node scripts/import-staff-mentions.cjs
 *
 * 注意:
 *   - serviceAccountKey.json が scripts/ 配下にあること
 *   - 再実行しても同じ userId のドキュメントは上書きになる（冪等）
 *   - "source: csv-import" で書き込むので、UI から手入力で追加したものと区別可能
 */

const admin = require('firebase-admin')
const fs = require('fs')
const path = require('path')

// ─── Firebase Admin 初期化 ───
const serviceAccountPath = path.join(__dirname, 'serviceAccountKey.json')
if (!fs.existsSync(serviceAccountPath)) {
    console.error('[ERROR] scripts/serviceAccountKey.json が見つかりません')
    process.exit(1)
}
const serviceAccount = require(serviceAccountPath)
admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
})
const db = admin.firestore()

// ─── 入力 CSV ───
const CSV_PATH = path.join(__dirname, '..', 'キャストDB - 内部キャストDB.csv')
if (!fs.existsSync(CSV_PATH)) {
    console.error(`[ERROR] CSV が見つかりません: ${CSV_PATH}`)
    process.exit(1)
}

// ─── ユーティリティ ───

/**
 * CSV 1 行をパース（ダブルクォート対応）
 */
function parseCsvLine(line) {
    const row = []
    let current = ''
    let inQuotes = false
    for (let i = 0; i < line.length; i++) {
        const ch = line[i]
        if (ch === '"') {
            // エスケープされたダブルクォート ("") の対応
            if (inQuotes && line[i + 1] === '"') {
                current += '"'
                i++
            } else {
                inQuotes = !inQuotes
            }
        } else if (ch === ',' && !inQuotes) {
            row.push(current)
            current = ''
        } else if (ch !== '\r') {
            current += ch
        }
    }
    row.push(current)
    return row
}

/**
 * 文字列からゼロ幅スペース・不可視文字を除去
 *   CSV に含まれる U+200B 等を除去しないと名前マッチに失敗する
 */
function stripInvisibles(s) {
    if (!s) return ''
    // zero-width space/non-joiner/joiner, BOM, LRM/RLM など
    return s.replace(/[\u200B-\u200F\uFEFF\u2028\u2029]/g, '')
}

/**
 * 別名候補の配列を作って非空かつユニーク化
 */
function buildAliases(...candidates) {
    const seen = new Set()
    const result = []
    for (const raw of candidates) {
        const cleaned = stripInvisibles((raw || '').trim())
        if (!cleaned) continue
        if (seen.has(cleaned)) continue
        seen.add(cleaned)
        result.push(cleaned)
    }
    return result
}

// ─── メイン ───
async function main() {
    const content = fs.readFileSync(CSV_PATH, 'utf8')
    const lines = content.split('\n').filter(l => l.trim())

    if (lines.length < 2) {
        console.error('[ERROR] CSV が空か不正です')
        process.exit(1)
    }

    // ヘッダ行: 本名,fullname,displayname,email,userid
    const header = parseCsvLine(lines[0]).map(h => stripInvisibles(h.trim()))
    console.log('[INFO] CSV header:', header)

    const col = {
        realName: header.indexOf('本名'),
        fullName: header.indexOf('fullname'),
        displayName: header.indexOf('displayname'),
        email: header.indexOf('email'),
        userId: header.indexOf('userid'),
    }

    for (const [key, idx] of Object.entries(col)) {
        if (idx < 0) {
            console.error(`[ERROR] ヘッダに "${key}" が見つかりません`)
            process.exit(1)
        }
    }

    const now = admin.firestore.Timestamp.now()
    const batch = db.batch()
    let ok = 0
    let skipped = 0
    const seenUserIds = new Set()

    for (let i = 1; i < lines.length; i++) {
        const row = parseCsvLine(lines[i])
        const realName = stripInvisibles((row[col.realName] || '').trim())
        const fullName = stripInvisibles((row[col.fullName] || '').trim())
        const displayName = stripInvisibles((row[col.displayName] || '').trim())
        const email = stripInvisibles((row[col.email] || '').trim().toLowerCase())
        const userId = stripInvisibles((row[col.userId] || '').trim())

        if (!userId) {
            console.warn(`[SKIP] row ${i + 1}: userId が空 (name=${realName || '(empty)'})`)
            skipped++
            continue
        }
        if (!realName) {
            console.warn(`[SKIP] row ${i + 1}: 本名が空 (userId=${userId})`)
            skipped++
            continue
        }
        if (seenUserIds.has(userId)) {
            console.warn(`[WARN] row ${i + 1}: userId 重複 → 後勝ち (userId=${userId})`)
        }
        seenUserIds.add(userId)

        const aliases = buildAliases(realName, fullName, displayName)

        const data = {
            name: realName,
            slackMentionId: userId,
            email: email || '',
            aliases,
            role: '',
            active: true,
            source: 'csv-import',
            note: '',
            updatedAt: now,
        }

        const ref = db.collection('staffMentions').doc(userId)
        // createAt は初回のみ（merge: true なので 既存 createdAt は保持される）
        batch.set(ref, { ...data, createdAt: now }, { merge: true })
        ok++
    }

    console.log(`[INFO] commit: ${ok} docs to write, ${skipped} skipped`)
    await batch.commit()
    console.log('[OK] import complete')
}

main().catch(e => {
    console.error('[FATAL]', e)
    process.exit(1)
})
