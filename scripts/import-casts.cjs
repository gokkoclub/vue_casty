/**
 * Firestore Cast Data Import Script
 * 
 * Usage:
 *   node scripts/import-casts.js
 * 
 * Requires:
 *   - Firebase Admin SDK credentials (serviceAccountKey.json)
 *   - CSV file: キャストDB - Firestoreに移す用.csv
 */

const admin = require('firebase-admin')
const fs = require('fs')
const path = require('path')

// Firebase Admin SDK initialization
const serviceAccountPath = path.join(__dirname, 'serviceAccountKey.json')

if (!fs.existsSync(serviceAccountPath)) {
    console.error('Error: serviceAccountKey.json not found in scripts folder')
    console.log('Please download it from Firebase Console:')
    console.log('Project Settings > Service Accounts > Generate New Private Key')
    process.exit(1)
}

const serviceAccount = require(serviceAccountPath)

admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
})

const db = admin.firestore()

// CSV column mapping: Japanese -> English
const columnMapping = {
    'CastID': 'castId',
    '氏名': 'name',
    '性別': 'gender',
    '生年月日': 'dateOfBirth',
    '所属事務所': 'agency',
    'アイコンURL': 'imageUrl',
    '主演回数': 'appearanceCount',
    'メール': 'email',
    'メモ': 'notes',
    '内部外部': 'castType',
    'SlackID': 'slackMentionId',
    'X(Twitter)': 'snsX',
    'Instagram': 'snsInstagram',
    'TikTok': 'snsTikTok'
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

async function importCasts() {
    const csvPath = path.join(__dirname, '..', 'キャストDB - Firestoreに移す用.csv')

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

        // Skip deleted entries
        const castId = cleanValue(row[headerIndices['castId']] || '')
        const name = cleanValue(row[headerIndices['name']] || '')

        // Skip if castId is invalid or deleted
        if (!castId || !castId.startsWith('cast_') || castId.includes('削除') || name.includes('削除')) {
            skipped++
            continue
        }

        const castData = {
            castId: castId,
            name: name,
            gender: cleanValue(row[headerIndices['gender']] || ''),
            dateOfBirth: cleanValue(row[headerIndices['dateOfBirth']] || ''),
            agency: cleanValue(row[headerIndices['agency']] || ''),
            imageUrl: cleanValue(row[headerIndices['imageUrl']] || ''),
            appearanceCount: parseInt(cleanValue(row[headerIndices['appearanceCount']] || '0')) || 0,
            email: cleanValue(row[headerIndices['email']] || ''),
            notes: cleanValue(row[headerIndices['notes']] || ''),
            castType: cleanValue(row[headerIndices['castType']] || '外部'),
            slackMentionId: cleanValue(row[headerIndices['slackMentionId']] || ''),
            snsX: cleanValue(row[headerIndices['snsX']] || ''),
            snsInstagram: cleanValue(row[headerIndices['snsInstagram']] || ''),
            snsTikTok: cleanValue(row[headerIndices['snsTikTok']] || ''),
            createdAt: now,
            updatedAt: now
        }

        // Use castId as document ID
        const docRef = db.collection('casts').doc(castId)
        batch.set(docRef, castData)
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
    console.log(`   Total imported: ${count} casts`)
    console.log(`   Skipped: ${skipped} entries`)
}

importCasts()
    .then(() => {
        console.log('Done!')
        process.exit(0)
    })
    .catch((error) => {
        console.error('Import failed:', error)
        process.exit(1)
    })
