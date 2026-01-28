/**
 * テストデータ投入スクリプト
 * ブラウザコンソールまたはコンポーネントから一度だけ実行
 */

import { collection, addDoc, Timestamp } from 'firebase/firestore'
import { db } from '@/services/firebase'

// ランダムに選択
function randomPick<T>(arr: T[]): T {
    if (arr.length === 0) throw new Error('Array is empty')
    return arr[Math.floor(Math.random() * arr.length)] as T
}

/**
 * テスト用キャストデータを投入
 */
export async function insertTestCasts() {
    if (!db) {
        console.error('Firestore not initialized')
        return
    }

    const testCasts = [
        { name: '田中太郎', gender: '男性', castType: '内部', agency: '' },
        { name: '佐藤花子', gender: '女性', castType: '外部', agency: 'スターダスト' },
        { name: '鈴木一郎', gender: '男性', castType: '内部', agency: '' },
        { name: '高橋美咲', gender: '女性', castType: '外部', agency: 'ホリプロ' },
        { name: '渡辺健太', gender: '男性', castType: '外部', agency: 'アミューズ' },
        { name: '伊藤さくら', gender: '女性', castType: '内部', agency: '' },
        { name: '山本大輔', gender: '男性', castType: '外部', agency: 'エイベックス' },
        { name: '中村愛', gender: '女性', castType: '内部', agency: '' },
    ]

    console.log('Inserting test casts...')
    const castIds: string[] = []

    for (const cast of testCasts) {
        const now = Timestamp.now()
        const docRef = await addDoc(collection(db, 'casts'), {
            ...cast,
            dateOfBirth: null,
            height: Math.floor(Math.random() * 30) + 160,
            note: '',
            xLink: '',
            instagramLink: '',
            tiktokLink: '',
            status: 'active',
            createdAt: now,
            updatedAt: now
        })
        castIds.push(docRef.id)
        console.log(`Created cast: ${cast.name} (${docRef.id})`)
    }

    console.log('Test casts inserted:', castIds.length)
    return castIds
}

/**
 * テスト用撮影データを投入
 */
export async function insertTestShootings() {
    if (!db) {
        console.error('Firestore not initialized')
        return
    }

    const teams = ['マーケティング部', '広報部', 'クリエイティブ部', 'EC事業部']
    const projects = ['新商品CM撮影', '雑誌広告撮影', 'SNS用動画撮影', 'カタログ撮影']

    console.log('Inserting test shootings...')
    const shootingIds: string[] = []

    for (let i = 0; i < 5; i++) {
        const shootDate = new Date()
        shootDate.setDate(shootDate.getDate() + i + 1)

        const now = Timestamp.now()
        const docRef = await addDoc(collection(db, 'shootings'), {
            title: randomPick(projects),
            team: randomPick(teams),
            accountName: `アカウント${i + 1}`,
            director: `ディレクター${i + 1}`,
            floorDirector: `FD${i + 1}`,
            startDate: Timestamp.fromDate(shootDate),
            endDate: Timestamp.fromDate(shootDate),
            notionPageId: `notion-page-${i + 1}`,
            status: 'active',
            createdAt: now,
            updatedAt: now
        })
        shootingIds.push(docRef.id)
        console.log(`Created shooting: ${shootDate.toLocaleDateString()} (${docRef.id})`)
    }

    console.log('Test shootings inserted:', shootingIds.length)
    return shootingIds
}

/**
 * テスト用キャスティングデータを投入
 */
export async function insertTestCastings() {
    if (!db) {
        console.error('Firestore not initialized')
        return
    }

    const statuses = ['仮押さえ', '打診中', 'オーダー待ち', 'OK', '決定']
    const castNames = ['田中太郎', '佐藤花子', '鈴木一郎', '高橋美咲', '渡辺健太']
    const castTypes = ['内部', '外部']
    const projects = ['春のキャンペーン撮影', 'Web広告用撮影', '新製品発表会', 'カタログモデル']
    const accounts = ['マーケチーム', '広報チーム', 'ECチーム']
    const roles = ['メインモデル', 'サブモデル', 'エキストラ']

    console.log('Inserting test castings...')
    const castingIds: string[] = []

    for (let i = 0; i < 10; i++) {
        const shootDate = new Date()
        shootDate.setDate(shootDate.getDate() + Math.floor(Math.random() * 14) + 1)

        const castType = randomPick(castTypes) as '内部' | '外部'
        const now = Timestamp.now()

        const docRef = await addDoc(collection(db, 'castings'), {
            castId: `cast-${i + 1}`,
            castName: randomPick(castNames),
            castType,
            projectName: randomPick(projects),
            accountName: randomPick(accounts),
            roleName: randomPick(roles),
            rank: (i % 3) + 1,
            startDate: Timestamp.fromDate(shootDate),
            endDate: Timestamp.fromDate(shootDate),
            status: randomPick(statuses),
            mainSub: i % 2 === 0 ? 'メイン' : 'サブ',
            note: i % 3 === 0 ? 'テスト備考' : '',
            slackThreadTs: null,
            slackPermalink: null,
            calendarEventId: null,
            updatedBy: 'test-admin@example.com',
            createdAt: now,
            updatedAt: now
        })
        castingIds.push(docRef.id)
        console.log(`Created casting: ${docRef.id}`)
    }

    console.log('Test castings inserted:', castingIds.length)
    return castingIds
}

/**
 * テスト用管理者を登録
 */
export async function insertTestAdmin(email: string, name: string) {
    if (!db) {
        console.error('Firestore not initialized')
        return
    }

    const now = Timestamp.now()
    const docRef = await addDoc(collection(db, 'admins'), {
        email: email.toLowerCase().trim(),
        name,
        active: true,
        createdAt: now,
        updatedAt: now
    })

    console.log(`Admin created: ${name} (${email}) - ID: ${docRef.id}`)
    return docRef.id
}

/**
 * すべてのテストデータを投入
 */
export async function insertAllTestData() {
    console.log('=== Starting test data insertion ===')

    try {
        await insertTestCasts()
        await insertTestShootings()
        await insertTestCastings()

        console.log('=== Test data insertion complete ===')
        return true
    } catch (error) {
        console.error('Error inserting test data:', error)
        return false
    }
}
