import { ref } from 'vue'
import { collection, query, getDocs, addDoc, updateDoc, deleteDoc, doc, Timestamp } from 'firebase/firestore'
import { db } from '@/services/firebase'
import { useToast } from 'primevue/usetoast'

export interface Admin {
    id: string
    email: string
    name: string
    active: boolean
    createdAt: Timestamp
    updatedAt: Timestamp
}

/**
 * 管理者管理用composable
 */
export function useAdmins() {
    const admins = ref<Admin[]>([])
    const loading = ref(false)
    const toast = useToast()

    /**
     * 全管理者を取得
     */
    async function fetchAdmins() {
        if (!db) {
            console.error('Firestore not initialized')
            return
        }

        loading.value = true

        try {
            const q = query(collection(db, 'admins'))
            const snapshot = await getDocs(q)

            admins.value = snapshot.docs.map(doc => ({
                id: doc.id,
                ...doc.data()
            } as Admin))
        } catch (error) {
            console.error('Error fetching admins:', error)
            toast.add({
                severity: 'error',
                summary: 'エラー',
                detail: '管理者一覧の取得に失敗しました',
                life: 3000
            })
        } finally {
            loading.value = false
        }
    }

    /**
     * 管理者を追加
     */
    async function addAdmin(email: string, name: string) {
        if (!db) return false

        try {
            const now = Timestamp.now()
            await addDoc(collection(db, 'admins'), {
                email: email.toLowerCase().trim(),
                name,
                active: true,
                createdAt: now,
                updatedAt: now
            })

            toast.add({
                severity: 'success',
                summary: '管理者追加',
                detail: `${name} を管理者に追加しました`,
                life: 2000
            })

            await fetchAdmins()
            return true
        } catch (error) {
            console.error('Error adding admin:', error)
            toast.add({
                severity: 'error',
                summary: 'エラー',
                detail: '管理者の追加に失敗しました',
                life: 3000
            })
            return false
        }
    }

    /**
     * 管理者を無効化（active = false）
     */
    async function deactivateAdmin(adminId: string) {
        if (!db) return false

        try {
            const adminRef = doc(db, 'admins', adminId)
            await updateDoc(adminRef, {
                active: false,
                updatedAt: Timestamp.now()
            })

            toast.add({
                severity: 'success',
                summary: '管理者無効化',
                detail: '管理者を無効化しました',
                life: 2000
            })

            await fetchAdmins()
            return true
        } catch (error) {
            console.error('Error deactivating admin:', error)
            toast.add({
                severity: 'error',
                summary: 'エラー',
                detail: '管理者の無効化に失敗しました',
                life: 3000
            })
            return false
        }
    }

    /**
     * 管理者を有効化
     */
    async function activateAdmin(adminId: string) {
        if (!db) return false

        try {
            const adminRef = doc(db, 'admins', adminId)
            await updateDoc(adminRef, {
                active: true,
                updatedAt: Timestamp.now()
            })

            toast.add({
                severity: 'success',
                summary: '管理者有効化',
                detail: '管理者を有効化しました',
                life: 2000
            })

            await fetchAdmins()
            return true
        } catch (error) {
            console.error('Error activating admin:', error)
            return false
        }
    }

    /**
     * 管理者を削除
     */
    async function removeAdmin(adminId: string) {
        if (!db) return false

        try {
            await deleteDoc(doc(db, 'admins', adminId))

            toast.add({
                severity: 'success',
                summary: '管理者削除',
                detail: '管理者を削除しました',
                life: 2000
            })

            await fetchAdmins()
            return true
        } catch (error) {
            console.error('Error removing admin:', error)
            toast.add({
                severity: 'error',
                summary: 'エラー',
                detail: '管理者の削除に失敗しました',
                life: 3000
            })
            return false
        }
    }

    return {
        admins,
        loading,
        fetchAdmins,
        addAdmin,
        deactivateAdmin,
        activateAdmin,
        removeAdmin
    }
}
