/**
 * CSV → Firestore インポートスクリプト
 * 
 * 使い方:
 *   npx ts-node --esm scripts/importCsvToFirestore.ts
 * 
 * 対象コレクション:
 *   1. castings       (キャスティングリスト)
 *   2. castMaster     (マスターデータ)
 *   3. shootingContacts (撮影連絡DB)
 * 
 * ⚠ 実行前に既存データを全削除してからインポートします
 */

import admin from 'firebase-admin'
import fs from 'fs'
import path from 'path'
import { parse } from 'csv-parse/sync'
import { fileURLToPath } from 'url'
import { createRequire } from 'module'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const require = createRequire(import.meta.url)

// Firebase Admin 初期化
const serviceAccountPath = path.resolve(__dirname, '../serviceAccountKey.json')
if (!fs.existsSync(serviceAccountPath)) {
    console.error('❌ serviceAccountKey.json が見つかりません。Firebase Console からダウンロードして vue_casty/ 直下に配置してください。')
    process.exit(1)
}

const serviceAccount = require(serviceAccountPath)
admin.initializeApp({
    credential: admin.credential.cert(serviceAccount as admin.ServiceAccount)
})

const db = admin.firestore()

// ==================== ヘルパー ====================

function parseDate(dateStr: string): admin.firestore.Timestamp | null {
    if (!dateStr) return null
    // 2025/12/09, 2026-01-08, etc.
    const cleaned = dateStr.replace(/\//g, '-').trim()
    const d = new Date(cleaned)
    if (isNaN(d.getTime())) return null
    return admin.firestore.Timestamp.fromDate(d)
}

function parseNumber(val: string): number | null {
    if (!val) return null
    const cleaned = val.replace(/[¥,\s]/g, '')
    const num = Number(cleaned)
    return isNaN(num) ? null : num
}

async function deleteCollection(collectionName: string) {
    const snapshot = await db.collection(collectionName).get()
    if (snapshot.empty) {
        console.log(`  ${collectionName}: 既存データなし`)
        return
    }

    const batchSize = 500
    const docs = snapshot.docs
    console.log(`  ${collectionName}: ${docs.length}件の既存データを削除中...`)

    for (let i = 0; i < docs.length; i += batchSize) {
        const batch = db.batch()
        const chunk = docs.slice(i, i + batchSize)
        chunk.forEach(doc => batch.delete(doc.ref))
        await batch.commit()
    }
    console.log(`  ${collectionName}: 削除完了`)
}

function readCsv(filePath: string): Record<string, string>[] {
    const content = fs.readFileSync(filePath, 'utf-8')
    return parse(content, {
        columns: true,
        skip_empty_lines: true,
        relax_column_count: true,
        bom: true
    })
}

// ==================== castings ====================

async function importCastings() {
    const csvPath = path.resolve(__dirname, '../キャストDB - キャスティングリスト (1).csv')
    if (!fs.existsSync(csvPath)) {
        console.log('⚠ キャスティングリスト CSV が見つかりません。スキップ。')
        return
    }

    const rows = readCsv(csvPath)
    console.log(`\n📋 castings: ${rows.length}件をインポート中...`)

    const batchSize = 500
    for (let i = 0; i < rows.length; i += batchSize) {
        const batch = db.batch()
        const chunk = rows.slice(i, i + batchSize)

        for (const row of chunk) {
            const id = row['CastingID']
            if (!id || id.startsWith('過去') || !id.startsWith('casting_') && !id.startsWith('sp_')) continue

            const docRef = db.collection('castings').doc(id)
            batch.set(docRef, {
                accountName: row['アカウント'] || '',
                projectName: row['作品名'] || '',
                roleName: row['役名'] || '',
                castId: row['CastID'] || '',
                castName: row['キャスト名'] || '',
                startDate: parseDate(row['開始日']),
                endDate: parseDate(row['終了日']),
                rank: parseNumber(row['候補順位']) || 1,
                status: row['ステータス'] || '仮キャスティング',
                notes: row['備考'] || '',
                slackThreadTs: row['SlackThreadTS'] || '',
                slackPermalink: row['SlackPermalink'] || '',
                mainSub: row['メイン/サブ'] || 'その他',
                calendarEventId: row['CalenderEventID'] || '',
                projectId: row['ProjectID'] || '',
                updatedAt: row['最終更新'] ? parseDate(row['最終更新']) : admin.firestore.Timestamp.now(),
                updatedBy: row['更新者'] || '',
                castPriority: parseNumber(row['キャス優先度']) || 1,
                castType: row['内部/外部'] === '内部' ? '内部' : '外部',
                email: row['メール'] || '',
                cost: parseNumber(row['金額']) || 0,
                createdAt: admin.firestore.Timestamp.now(),
                createdBy: row['更新者'] || 'csv_import'
            })
        }

        await batch.commit()
        console.log(`  ... ${Math.min(i + batchSize, rows.length)}/${rows.length}`)
    }
    console.log(`✅ castings: ${rows.length}件インポート完了`)
}

// ==================== castMaster ====================

async function importCastMaster() {
    const csvPath = path.resolve(__dirname, '../キャストDB - マスターデータ (1).csv')
    if (!fs.existsSync(csvPath)) {
        console.log('⚠ マスターデータ CSV が見つかりません。スキップ。')
        return
    }

    const rows = readCsv(csvPath)
    console.log(`\n📊 castMaster: ${rows.length}件をインポート中...`)

    let imported = 0
    const batchSize = 500
    for (let i = 0; i < rows.length; i += batchSize) {
        const batch = db.batch()
        const chunk = rows.slice(i, i + batchSize)

        for (const row of chunk) {
            const id = row['CastingID']
            if (!id || id.startsWith('過去') || (!id.startsWith('casting_') && !id.startsWith('sp_'))) continue

            const docRef = db.collection('castMaster').doc(id)
            batch.set(docRef, {
                castingId: id,
                accountName: row['アカウント'] || '',
                projectName: row['作品名'] || '',
                roleName: row['役名'] || '',
                castId: row['CastID'] || '',
                castName: row['キャスト名'] || '',
                shootDate: parseDate(row['開始日']),
                endDate: parseDate(row['終了日']),
                notes: row['備考'] || '',
                slackPermalink: row['SlackPermalink'] || '',
                mainSub: row['メイン/サブ'] || 'その他',
                calendarEventId: row['CalenderEventID'] || '',
                projectId: row['ProjectID'] || '',
                castType: row['内部/外部'] === '内部' ? '内部' : '外部',
                cost: parseNumber(row['金額']) || 0,
                poUuid: row['発注書ID'] || '',
                decidedAt: admin.firestore.Timestamp.now(),
                createdAt: admin.firestore.Timestamp.now()
            })
            imported++
        }

        await batch.commit()
        console.log(`  ... ${Math.min(i + batchSize, rows.length)}/${rows.length}`)
    }
    console.log(`✅ castMaster: ${imported}件インポート完了`)
}

// ==================== shootingContacts ====================

async function importShootingContacts() {
    const csvPath = path.resolve(__dirname, '../キャストDB - 撮影連絡DB (1).csv')
    if (!fs.existsSync(csvPath)) {
        console.log('⚠ 撮影連絡DB CSV が見つかりません。スキップ。')
        return
    }

    const rows = readCsv(csvPath)
    console.log(`\n📞 shootingContacts: ${rows.length}件をインポート中...`)

    let imported = 0
    const batchSize = 500
    for (let i = 0; i < rows.length; i += batchSize) {
        const batch = db.batch()
        const chunk = rows.slice(i, i + batchSize)

        for (const row of chunk) {
            const id = row['CastingID']
            if (!id || !id.startsWith('casting_') && !id.startsWith('sp_')) continue

            const docRef = db.collection('shootingContacts').doc(id)
            batch.set(docRef, {
                castingId: id,
                accountName: row['アカウント'] || '',
                projectName: row['作品名'] || '',
                notionId: row['NotionID'] || '',
                roleName: row['役名'] || '',
                castName: row['キャスト名'] || '',
                castType: row['種別（内部/外部）'] === '内部' ? '内部' : '外部',
                shootDate: parseDate(row['撮影日']),
                notes: row['備考'] || '',
                status: row['ステータス'] || '香盤連絡待ち',
                inTime: row['IN時間'] || '',
                outTime: row['OUT時間'] || '',
                location: row['集合場所'] || '',
                address: row['住所'] || '',
                makingUrl: row['メイキングURL'] || '',
                cost: row['金額'] || '',
                postDate: parseDate(row['投稿日']) || '',
                updatedBy: row['最終更新者'] || '',
                updatedAt: row['最終更新時間'] ? parseDate(row['最終更新時間']) : admin.firestore.Timestamp.now(),
                mainSub: row['メイン/サブ'] || 'その他',
                poUuid: row['発注書ID'] || '',
                createdAt: admin.firestore.Timestamp.now()
            })
            imported++
        }

        await batch.commit()
        console.log(`  ... ${Math.min(i + batchSize, rows.length)}/${rows.length}`)
    }
    console.log(`✅ shootingContacts: ${imported}件インポート完了`)
}

// ==================== メイン ====================

async function main() {
    console.log('🚀 Firestore CSV インポート開始')
    console.log('='.repeat(50))

    // 1. 既存データ削除
    console.log('\n🗑️  既存データを削除中...')
    await deleteCollection('castings')
    await deleteCollection('castMaster')
    await deleteCollection('shootingContacts')

    // 2. CSV インポート
    await importCastings()
    await importCastMaster()
    await importShootingContacts()

    console.log('\n' + '='.repeat(50))
    console.log('✅ 全てのインポートが完了しました！')
    process.exit(0)
}

main().catch(err => {
    console.error('❌ エラー:', err)
    process.exit(1)
})
