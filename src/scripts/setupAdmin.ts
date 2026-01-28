/**
 * 初期管理者セットアップスクリプト
 * 
 * このファイルは開発時に一度だけ実行して、最初の管理者を登録するためのものです。
 * 
 * 使用方法:
 * 1. このファイルを任意のVueコンポーネントから一時的にimportして実行
 * 2. または、Firebaseコンソールから直接 admins コレクションにドキュメントを追加
 * 
 * Firestoreコンソールで直接追加する場合:
 * コレクション: admins
 * ドキュメント構造:
 * {
 *   email: "admin@example.com",
 *   name: "管理者名",
 *   active: true,
 *   createdAt: Timestamp,
 *   updatedAt: Timestamp
 * }
 */

import { collection, addDoc, Timestamp } from 'firebase/firestore'
import { db } from '@/services/firebase'

export async function setupInitialAdmin(email: string, name: string) {
    if (!db) {
        console.error('Firestore not initialized')
        return false
    }

    try {
        const now = Timestamp.now()
        const docRef = await addDoc(collection(db, 'admins'), {
            email: email.toLowerCase().trim(),
            name,
            active: true,
            createdAt: now,
            updatedAt: now
        })

        console.log('Initial admin created with ID:', docRef.id)
        console.log('Email:', email)
        console.log('Name:', name)
        return true
    } catch (error) {
        console.error('Error creating initial admin:', error)
        return false
    }
}

/**
 * 使用例（開発時のみ）:
 * 
 * import { setupInitialAdmin } from '@/scripts/setupAdmin'
 * 
 * // コンポーネントのonMounted等で一度だけ実行
 * setupInitialAdmin('your-email@example.com', 'あなたの名前')
 */
