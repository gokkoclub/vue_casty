/**
 * Firestore Casting Data Import Script
 * 
 * Usage:
 *   node scripts/import-castings.cjs
 * 
 * Requires:
 *   - Firebase Admin SDK credentials (serviceAccountKey.json)
 *   - CSV file: キャストDB - オーダーリスト_Firestoreに移す用.csv
 */

const admin = require('firebase-admin')
const fs = require('fs')
const path = require('path')

// Firebase Admin SDK initialization
const serviceAccountPath = path.join(__dirname, 'serviceAccountKey.json')

if (!fs.existsSync(serviceAccountPath)) {
    console.error('Error: serviceAccountKey.json not found in scripts folder')
    process.exit(1)
}

const serviceAccount = require(serviceAccountPath)

admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
})

const db = admin.firestore()

// CSV column mapping: Japanese -> English
const columnMapping = {
    'CastingID': 'castingId',
    'アカウント': 'accountName',
    '作品名': 'projectName',
    '役名': 'roleName',
    'CastID': 'castId',
    'キャスト名': 'castName',
    '開始日': 'startDate',
    '終了日': 'endDate',
    '候補順位': 'rank',
    'ステータス': 'status',
    '備考': 'note',
    'SlackThreadTS': 'slackThreadTs',
    'SlackPermalink': 'slackPermalink',
    'メイン/サブ': 'mainSub',
    'CalenderEventID': 'calendarEventId',
    'ProjectID': 'projectId',
    '最終更新': 'updatedAtOriginal',
    '更新者': 'updatedBy',
    'キャス優先度': 'priority',
    '内部/外部': 'castType',
    'メール': 'email',
    '金額': 'cost',
    'JSON': 'jsonData'
}

function parseCSV(content) {
    const lines = content.split('\n')
    const result = []

    for (const line of lines) {
        if (!line.trim()) continue

        const row = []
        let current = ''
        let inQuotes = false

        for (let i = 0; i < line.length; i++) {
            const char = line[i]

            if (char === '"') {
                inQuotes = !inQuotes
            } else if (char === ',' && !inQuotes) {
                row.push(current.trim())
                current = ''
            } else if (char !== '\r') {
                current += char
            }
        }
        row.push(current.trim())
        result.push(row)
    }

    return result
}

function cleanValue(value) {
    if (!value) return ''
    return value.replace(/^"|"$/g, '').trim()
}

function parseDate(dateStr) {
    if (!dateStr) return null
    // Format: YYYY/MM/DD or YYYY-MM-DD
    const cleaned = dateStr.replace(/\//g, '-')
    const date = new Date(cleaned)
    if (isNaN(date.getTime())) return null
    return admin.firestore.Timestamp.fromDate(date)
}

async function importCastings() {
    const csvPath = path.join(__dirname, '..', 'キャストDB - オーダーリスト_Firestoreに移す用.csv')

    if (!fs.existsSync(csvPath)) {
        console.error('Error: CSV file not found at:', csvPath)
        process.exit(1)
    }

    console.log('Reading CSV file...')
    const content = fs.readFileSync(csvPath, 'utf-8')
    const rows = parseCSV(content)

    if (rows.length < 2) {
        console.error('Error: CSV file is empty or has no data rows')
        process.exit(1)
    }

    const headers = rows[0]
    console.log('Headers:', headers)

    // Map header indices
    const headerIndices = {}
    headers.forEach((header, index) => {
        const cleanHeader = cleanValue(header)
        if (columnMapping[cleanHeader]) {
            headerIndices[columnMapping[cleanHeader]] = index
        }
    })

    console.log('Mapped columns:', Object.keys(headerIndices))

    let batch = db.batch()
    let count = 0
    let skipped = 0
    let batchCount = 0

    const now = admin.firestore.Timestamp.now()

    for (let i = 1; i < rows.length; i++) {
        const row = rows[i]

        const castingId = cleanValue(row[headerIndices['castingId']] || '')

        // Skip if no valid ID
        if (!castingId) {
            skipped++
            continue
        }

        const startDateStr = cleanValue(row[headerIndices['startDate']] || '')
        const endDateStr = cleanValue(row[headerIndices['endDate']] || '')
        const costStr = cleanValue(row[headerIndices['cost']] || '')
        const rankStr = cleanValue(row[headerIndices['rank']] || '1')

        const castingData = {
            castingId: castingId,
            accountName: cleanValue(row[headerIndices['accountName']] || ''),
            projectName: cleanValue(row[headerIndices['projectName']] || ''),
            roleName: cleanValue(row[headerIndices['roleName']] || ''),
            castId: cleanValue(row[headerIndices['castId']] || ''),
            castName: cleanValue(row[headerIndices['castName']] || ''),
            startDate: parseDate(startDateStr) || now,
            endDate: parseDate(endDateStr) || parseDate(startDateStr) || now,
            rank: parseInt(rankStr) || 1,
            status: cleanValue(row[headerIndices['status']] || 'オーダー待ち'),
            note: cleanValue(row[headerIndices['note']] || ''),
            slackThreadTs: cleanValue(row[headerIndices['slackThreadTs']] || ''),
            slackPermalink: cleanValue(row[headerIndices['slackPermalink']] || ''),
            mainSub: cleanValue(row[headerIndices['mainSub']] || 'その他'),
            calendarEventId: cleanValue(row[headerIndices['calendarEventId']] || ''),
            projectId: cleanValue(row[headerIndices['projectId']] || ''),
            updatedBy: cleanValue(row[headerIndices['updatedBy']] || ''),
            castType: cleanValue(row[headerIndices['castType']] || '外部'),
            email: cleanValue(row[headerIndices['email']] || ''),
            cost: parseInt(costStr) || 0,
            dbSentStatus: '',
            createdBy: cleanValue(row[headerIndices['updatedBy']] || ''),
            createdAt: now,
            updatedAt: now
        }

        // Use castingId as document ID
        const docRef = db.collection('castings').doc(castingId)
        batch.set(docRef, castingData)
        count++
        batchCount++

        // Firestore batch limit is 500
        if (batchCount === 500) {
            console.log(`Committing batch (${count} documents so far)...`)
            await batch.commit()
            batch = db.batch()
            batchCount = 0
        }
    }

    // Commit remaining
    if (batchCount > 0) {
        console.log('Committing final batch...')
        await batch.commit()
    }

    console.log('\n✅ Import complete!')
    console.log(`   Total imported: ${count} castings`)
    console.log(`   Skipped: ${skipped} entries`)
}

importCastings()
    .then(() => {
        console.log('Done!')
        process.exit(0)
    })
    .catch((error) => {
        console.error('Import failed:', error)
        process.exit(1)
    })
