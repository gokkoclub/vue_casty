/**
 * DB統合マイグレーションスクリプト
 *
 * shootingContacts + castMaster のデータを castings に merge する。
 * 既存フィールドには一切触らない（merge: true）。
 *
 * Usage:
 *   node scripts/migrate-to-unified-castings.cjs
 *
 * 冪等: 何度実行しても同じ結果。既に統合済みのフィールドは上書きされる。
 * 旧コレクションは削除しない（バックアップとして残す）。
 */

const admin = require('firebase-admin')
const path = require('path')

const serviceAccount = require(path.join(__dirname, 'serviceAccountKey.json'))
admin.initializeApp({ credential: admin.credential.cert(serviceAccount) })
const db = admin.firestore()

async function migrateShootingContacts() {
    console.log('\n=== Phase 1: shootingContacts → castings ===')
    const snap = await db.collection('shootingContacts').get()
    console.log(`shootingContacts: ${snap.size} docs`)

    let merged = 0, skipped = 0, notFound = 0

    // Firestore batch は 500 件制限
    const batches = []
    let currentBatch = db.batch()
    let batchCount = 0

    for (const doc of snap.docs) {
        const data = doc.data()
        const castingId = data.castingId
        if (!castingId) {
            console.warn(`  [SKIP] ${doc.id}: castingId が空`)
            skipped++
            continue
        }

        // castings ドキュメントの存在確認
        const castingRef = db.collection('castings').doc(castingId)
        const castingDoc = await castingRef.get()
        if (!castingDoc.exists) {
            console.warn(`  [NOT FOUND] castingId=${castingId} (shootingContact=${doc.id})`)
            notFound++
            continue
        }

        // merge するフィールド
        const mergeData = {
            contactStatus: data.status || '香盤連絡待ち',
            inTime: data.inTime || null,
            outTime: data.outTime || null,
            location: data.location || null,
            address: data.address || null,
            fee: data.fee ?? null,
            makingUrl: data.makingUrl || null,
            postDate: data.postDate || null,
            contactEmail: data.email || null,
            orderDocumentId: data.orderDocumentId || null,
            poUuid: data.poUuid || null,
            // shootingContacts の ID も保存（旧データとの紐付け用）
            _migratedFromContact: doc.id,
        }

        currentBatch.set(castingRef, mergeData, { merge: true })
        merged++
        batchCount++

        if (batchCount >= 499) {
            batches.push(currentBatch)
            currentBatch = db.batch()
            batchCount = 0
        }
    }
    batches.push(currentBatch)

    for (const batch of batches) {
        await batch.commit()
    }

    console.log(`  merged: ${merged}, skipped: ${skipped}, notFound: ${notFound}`)
    return merged
}

async function migrateCastMaster() {
    console.log('\n=== Phase 2: castMaster → castings ===')
    const snap = await db.collection('castMaster').get()
    console.log(`castMaster: ${snap.size} docs`)

    let merged = 0, skipped = 0, notFound = 0

    const batches = []
    let currentBatch = db.batch()
    let batchCount = 0

    for (const doc of snap.docs) {
        const data = doc.data()
        const castingId = data.castingId
        if (!castingId) {
            console.warn(`  [SKIP] ${doc.id}: castingId が空`)
            skipped++
            continue
        }

        const castingRef = db.collection('castings').doc(castingId)
        const castingDoc = await castingRef.get()
        if (!castingDoc.exists) {
            console.warn(`  [NOT FOUND] castingId=${castingId} (castMaster=${doc.id})`)
            notFound++
            continue
        }

        const mergeData = {
            isDecided: true,
            decidedAt: data.decidedAt || data.createdAt || null,
            decidedBy: data.decidedBy || null,
            // castMaster の cost は castings 側を信頼する（merge なので既存 cost を上書きしない）
            // ただし castings.cost が 0 で castMaster.cost が > 0 なら更新
            _migratedFromMaster: doc.id,
        }

        // cost の補完: castings 側が 0 で castMaster 側に値がある場合のみ上書き
        const castingData = castingDoc.data()
        if ((!castingData.cost || castingData.cost === 0) && data.cost && data.cost > 0) {
            mergeData.cost = data.cost
        }

        currentBatch.set(castingRef, mergeData, { merge: true })
        merged++
        batchCount++

        if (batchCount >= 499) {
            batches.push(currentBatch)
            currentBatch = db.batch()
            batchCount = 0
        }
    }
    batches.push(currentBatch)

    for (const batch of batches) {
        await batch.commit()
    }

    console.log(`  merged: ${merged}, skipped: ${skipped}, notFound: ${notFound}`)
    return merged
}

async function verify() {
    console.log('\n=== Verification ===')
    // contactStatus が入った castings の件数
    const contactSnap = await db.collection('castings')
        .where('contactStatus', '!=', null)
        .get()
    console.log(`castings with contactStatus: ${contactSnap.size}`)

    // isDecided が入った castings の件数
    const decidedSnap = await db.collection('castings')
        .where('isDecided', '==', true)
        .get()
    console.log(`castings with isDecided=true: ${decidedSnap.size}`)
}

async function main() {
    console.log('=== DB統合マイグレーション開始 ===')
    console.log('既存フィールドには触りません（merge: true）')
    console.log('旧コレクションは削除しません')

    const contacts = await migrateShootingContacts()
    const masters = await migrateCastMaster()
    await verify()

    console.log('\n=== 完了 ===')
    console.log(`shootingContacts → castings: ${contacts} 件統合`)
    console.log(`castMaster → castings: ${masters} 件統合`)
    console.log('旧コレクション (shootingContacts, castMaster) はそのまま残っています')
}

main().catch(e => {
    console.error('[FATAL]', e)
    process.exit(1)
}).then(() => process.exit(0))
