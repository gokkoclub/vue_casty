const admin = require('firebase-admin')
const path = require('path')

// Initialize Firebase Admin
const serviceAccount = require('./serviceAccountKey.json')

if (!admin.apps.length) {
    admin.initializeApp({
        credential: admin.credential.cert(serviceAccount)
    })
}

const db = admin.firestore()

async function createDummyShootings() {
    const shootingsRef = db.collection('shootings')

    // Create dates for today, tomorrow, and next week
    const now = new Date()
    const tomorrow = new Date(now)
    tomorrow.setDate(tomorrow.getDate() + 1)

    const nextWeek = new Date(now)
    nextWeek.setDate(nextWeek.getDate() + 7)

    const dummyData = [
        {
            id: 'dummy_shooting_1',
            title: 'PR動画 Aパターン',
            shootDate: admin.firestore.Timestamp.fromDate(now),
            team: 'GOKKO倶楽部',
            director: '田中太郎',
            floorDirector: '鈴木花子',
            notionUrl: 'https://notion.so/dummy1'
        },
        {
            id: 'dummy_shooting_2',
            title: 'TikTok 10本撮り',
            shootDate: admin.firestore.Timestamp.fromDate(tomorrow),
            team: 'アカウントB',
            director: '佐藤健',
            floorDirector: '高橋海人',
            notionUrl: 'https://notion.so/dummy2'
        },
        {
            id: 'dummy_shooting_3',
            title: 'YouTube 長尺ドラマ',
            shootDate: admin.firestore.Timestamp.fromDate(nextWeek),
            team: 'GOKKO',
            director: '山田',
            floorDirector: '山本',
            notionUrl: 'https://notion.so/dummy3'
        }
    ]

    console.log('Creating dummy shootings...')

    for (const data of dummyData) {
        await shootingsRef.doc(data.id).set(data)
        console.log(`Created: ${data.title} (${data.shootDate.toDate().toLocaleDateString()})`)
    }

    console.log('Done!')
}

createDummyShootings().catch(console.error)
