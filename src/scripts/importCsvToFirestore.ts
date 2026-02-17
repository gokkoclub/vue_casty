/**
 * CSV → Firestore 一括インポートスクリプト
 * 
 * 使い方:
 *   node --loader ts-node/esm src/scripts/importCsvToFirestore.ts
 * 
 * 対象:
 *   1. キャスティングリスト → castings コレクション
 *   2. 撮影連絡DB → shootingContacts コレクション
 *   3. マスターデータ → castMaster コレクション
 */

import { readFileSync } from 'fs'
import { initializeApp, cert } from 'firebase-admin/app'
import { getFirestore, Timestamp } from 'firebase-admin/firestore'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

// ====== 設定 ======
const SERVICE_ACCOUNT_PATH = resolve(__dirname, '../../serviceAccountKey.json')
const PROJECT_ROOT = resolve(__dirname, '../../')

// Firebase Admin 初期化
const app = initializeApp({
    credential: cert(SERVICE_ACCOUNT_PATH)
})
const db = getFirestore(app)

// ====== CSV パーサー ======
function parseCsv(filePath: string): Record<string, string>[] {
    const content = readFileSync(filePath, 'utf-8')
    const lines = content.split('\n')
    if (lines.length < 2) return []

    // ヘッダー行を解析
    const headers = parseCsvLine(lines[0])
    const rows: Record<string, string>[] = []

    // データ行を解析（複数行にまたがるフィールド対応）
    let currentLine = ''
    for (let i = 1; i < lines.length; i++) {
        currentLine += (currentLine ? '\n' : '') + lines[i]

        // クォートの数が偶数なら行が完結
        const quoteCount = (currentLine.match(/"/g) || []).length
        if (quoteCount % 2 === 0) {
            if (currentLine.trim()) {
                const values = parseCsvLine(currentLine)
                const row: Record<string, string> = {}
                headers.forEach((h, idx) => {
                    row[h] = (values[idx] || '').trim()
                })
                rows.push(row)
            }
            currentLine = ''
        }
    }

    return rows
}

function parseCsvLine(line: string): string[] {
    const result: string[] = []
    let current = ''
    let inQuotes = false

    for (let i = 0; i < line.length; i++) {
        const ch = line[i]
        if (ch === '"') {
            if (inQuotes && line[i + 1] === '"') {
                current += '"'
                i++
            } else {
                inQuotes = !inQuotes
            }
        } else if (ch === ',' && !inQuotes) {
            result.push(current)
            current = ''
        } else {
            current += ch
        }
    }
    result.push(current)
    return result
}

// ====== 日付変換 ======
function toTimestamp(dateStr: string): Timestamp | null {
    if (!dateStr) return null
    // "2025/12/09" or "2025-12-09" or "2026-01-09 06:30:25"
    const cleaned = dateStr.replace(/\//g, '-').trim()
    const date = new Date(cleaned)
    if (isNaN(date.getTime())) return null
    return Timestamp.fromDate(date)
}

function parseCost(costStr: string): number {
    if (!costStr) return 0
    // "¥40,000" → 40000
    return parseInt(costStr.replace(/[¥,\s]/g, ''), 10) || 0
}

// ====== 1. キャスティングリスト インポート ======
async function importCastings() {
    console.log('\n=== キャスティングリスト インポート ===')
    const filePath = resolve(PROJECT_ROOT, 'キャストDB - キャスティングリスト.csv')
    const rows = parseCsv(filePath)
    console.log(`CSV行数: ${rows.length}`)

    const batch = db.batch()
    let count = 0
    let batchCount = 0

    for (const row of rows) {
        const castingId = row['CastingID']
        if (!castingId || !castingId.startsWith('casting_')) continue

        const docRef = db.collection('castings').doc(castingId)
        batch.set(docRef, {
            accountName: row['アカウント'] || '',
            projectName: row['作品名'] || '',
            roleName: row['役名'] || '',
            castId: row['CastID'] || '',
            castName: row['キャスト名'] || '',
            startDate: toTimestamp(row['開始日']),
            endDate: toTimestamp(row['終了日']),
            rank: parseInt(row['候補順位'], 10) || 1,
            status: row['ステータス'] || '仮キャスティング',
            note: row['備考'] || '',
            slackThreadTs: row['SlackThreadTS'] || '',
            slackPermalink: row['SlackPermalink'] || '',
            mainSub: row['メイン/サブ'] || 'その他',
            calendarEventId: row['CalenderEventID'] || '',
            projectId: row['ProjectID'] || '',
            updatedAt: toTimestamp(row['最終更新']) || Timestamp.now(),
            updatedBy: row['更新者'] || '',
            castType: row['内部/外部'] || '外部',
            email: row['メール'] || '',
            cost: parseCost(row['金額']),
            dbSentStatus: '',
            createdAt: toTimestamp(row['最終更新']) || Timestamp.now(),
            createdBy: row['更新者'] || ''
        }, { merge: true })
        count++
        batchCount++

        // Firestore batch limit = 500
        if (batchCount >= 450) {
            await batch.commit()
            console.log(`  バッチコミット: ${count}件完了`)
            batchCount = 0
        }
    }

    if (batchCount > 0) {
        await batch.commit()
    }
    console.log(`✅ castings インポート完了: ${count}件`)
}

// ====== 2. 撮影連絡DB インポート ======
async function importShootingContacts() {
    console.log('\n=== 撮影連絡DB インポート ===')
    const filePath = resolve(PROJECT_ROOT, 'キャストDB - 撮影連絡DB.csv')
    const rows = parseCsv(filePath)
    console.log(`CSV行数: ${rows.length}`)

    const batch = db.batch()
    let count = 0
    let batchCount = 0

    for (const row of rows) {
        const castingId = row['CastingID']
        if (!castingId || !castingId.startsWith('casting_')) continue

        const docRef = db.collection('shootingContacts').doc(castingId)
        batch.set(docRef, {
            castingId: castingId,
            castName: row['キャスト名'] || '',
            castType: row['種別（内部/外部）'] || '外部',
            projectName: row['作品名'] || '',
            accountName: row['アカウント'] || '',
            roleName: row['役名'] || '',
            shootDate: toTimestamp(row['撮影日']),
            inTime: row['IN時間'] || '',
            outTime: row['OUT時間'] || '',
            location: row['集合場所'] || '',
            address: row['住所'] || '',
            fee: parseCost(row['金額']),
            makingUrl: row['メイキングURL'] || '',
            postDate: toTimestamp(row['投稿日']),
            mainSub: row['メイン/サブ'] || 'その他',
            status: row['ステータス'] || '香盤連絡待ち',
            orderDocumentId: row['発注書ID'] || '',
            notionPageId: row['NotionID'] || '',
            note: row['備考'] || '',
            updatedBy: row['最終更新者'] || '',
            updatedAt: toTimestamp(row['最終更新時間']) || Timestamp.now(),
            createdAt: toTimestamp(row['最終更新時間']) || Timestamp.now()
        }, { merge: true })
        count++
        batchCount++

        if (batchCount >= 450) {
            await batch.commit()
            console.log(`  バッチコミット: ${count}件完了`)
            batchCount = 0
        }
    }

    if (batchCount > 0) {
        await batch.commit()
    }
    console.log(`✅ shootingContacts インポート完了: ${count}件`)
}

// ====== 3. マスターデータ インポート ======
async function importMasterData() {
    console.log('\n=== マスターデータ インポート ===')
    const filePath = resolve(PROJECT_ROOT, 'キャストDB - マスターデータ.csv')
    const rows = parseCsv(filePath)
    console.log(`CSV行数: ${rows.length}`)

    const batch = db.batch()
    let count = 0
    let batchCount = 0

    for (const row of rows) {
        const castingId = row['CastingID']
        if (!castingId || castingId.startsWith('過去作品')) continue
        // sp_ prefix or casting_ prefix
        if (!castingId.startsWith('casting_') && !castingId.startsWith('sp_')) continue

        const docId = `master_${castingId}`
        const docRef = db.collection('castMaster').doc(docId)
        batch.set(docRef, {
            castingId: castingId,
            castId: row['CastID'] || '',
            castName: row['キャスト名'] || '',
            castType: row['内部/外部'] || '外部',
            accountName: row['アカウント'] || '',
            projectName: row['作品名'] || '',
            roleName: row['役名'] || '',
            mainSub: row['メイン/サブ'] || 'その他',
            shootDate: toTimestamp(row['開始日']),
            endDate: toTimestamp(row['終了日']),
            cost: parseCost(row['金額']),
            slackPermalink: row['SlackPermalink'] || '',
            calendarEventId: row['CalenderEventID'] || '',
            projectId: row['ProjectID'] || '',
            orderDocumentId: row['発注書ID'] || '',
            decidedAt: toTimestamp(row['開始日']) || Timestamp.now(),
            decidedBy: '',
            createdAt: Timestamp.now()
        }, { merge: true })
        count++
        batchCount++

        if (batchCount >= 450) {
            await batch.commit()
            console.log(`  バッチコミット: ${count}件完了`)
            batchCount = 0
        }
    }

    if (batchCount > 0) {
        await batch.commit()
    }
    console.log(`✅ castMaster インポート完了: ${count}件`)
}

// ====== メイン ======
async function main() {
    console.log('========================================')
    console.log('CSV → Firestore インポート開始')
    console.log('========================================')

    try {
        await importCastings()
        await importShootingContacts()
        await importMasterData()
    } catch (error) {
        console.error('❌ エラー:', error)
    }

    console.log('\n========================================')
    console.log('インポート完了')
    console.log('========================================')
    process.exit(0)
}

main()
