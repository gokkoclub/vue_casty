import { ref, computed } from 'vue'
import {
    collection, query, where, orderBy, getDocs,
    addDoc, updateDoc, doc, Timestamp
} from 'firebase/firestore'
import { db } from '@/services/firebase'
import type { ShootingContact, ShootingContactStatus, Casting } from '@/types'
import { useToast } from 'primevue/usetoast'

/**
 * 撮影連絡DB管理composable
 * 外部キャストの決定後フロー管理
 */
export function useShootingContact() {
    const contacts = ref<ShootingContact[]>([])
    const loading = ref(false)
    const toast = useToast()

    /**
     * ステータス別に撮影連絡データを取得
     */
    async function fetchByStatus(status?: ShootingContactStatus) {
        if (!db) {
            console.error('Firestore not initialized')
            return
        }

        loading.value = true

        try {
            let q = query(
                collection(db, 'shootingContacts'),
                orderBy('shootDate', 'desc')
            )

            const snapshot = await getDocs(q)
            let results: ShootingContact[] = []

            snapshot.forEach((docSnap) => {
                const data = docSnap.data()
                results.push({
                    id: docSnap.id,
                    ...data
                } as ShootingContact)
            })

            // ステータスでフィルタ
            if (status) {
                results = results.filter(c => c.status === status)
            }

            contacts.value = results
        } catch (error) {
            console.error('Error fetching shooting contacts:', error)
            toast.add({
                severity: 'error',
                summary: 'エラー',
                detail: '撮影連絡データの取得に失敗しました',
                life: 3000
            })
        } finally {
            loading.value = false
        }
    }

    /**
     * 全データを取得
     */
    async function fetchAll() {
        await fetchByStatus()
    }

    /**
     * キャスティングから撮影連絡DBに追加
     * 決定ステータス + 外部キャストのみ
     */
    async function addFromCasting(casting: Casting): Promise<boolean> {
        if (!db) return false

        // 外部キャストのみ対象
        if (casting.castType !== '外部') {
            console.log('Internal cast, skipping shooting contact')
            return false
        }

        try {
            // 重複チェック
            const existingQuery = query(
                collection(db, 'shootingContacts'),
                where('castingId', '==', casting.id)
            )
            const existing = await getDocs(existingQuery)

            if (!existing.empty) {
                console.log('Shooting contact already exists for casting:', casting.id)
                return false
            }

            // 新規作成
            const now = Timestamp.now()
            await addDoc(collection(db, 'shootingContacts'), {
                castingId: casting.id,
                castName: casting.castName,
                castType: casting.castType,
                projectName: casting.projectName,
                accountName: casting.accountName,
                roleName: casting.roleName,
                shootDate: casting.startDate,
                mainSub: casting.mainSub || 'その他',
                status: '香盤連絡待ち' as ShootingContactStatus,
                slackThreadTs: casting.slackThreadTs,
                createdAt: now,
                updatedAt: now
            })

            toast.add({
                severity: 'success',
                summary: '撮影連絡DB',
                detail: `${casting.castName} を撮影連絡DBに追加しました`,
                life: 2000
            })

            return true
        } catch (error) {
            console.error('Error adding to shooting contact:', error)
            toast.add({
                severity: 'error',
                summary: 'エラー',
                detail: '撮影連絡DBへの追加に失敗しました',
                life: 3000
            })
            return false
        }
    }

    /**
     * 撮影連絡データを更新
     */
    async function updateContact(
        contactId: string,
        data: Partial<ShootingContact>
    ): Promise<boolean> {
        if (!db) return false

        try {
            const contactRef = doc(db, 'shootingContacts', contactId)
            await updateDoc(contactRef, {
                ...data,
                updatedAt: Timestamp.now()
            })

            // ローカル状態を更新
            const contact = contacts.value.find(c => c.id === contactId)
            if (contact) {
                Object.assign(contact, data)
            }

            toast.add({
                severity: 'success',
                summary: '更新完了',
                detail: '撮影連絡情報を更新しました',
                life: 2000
            })

            return true
        } catch (error) {
            console.error('Error updating shooting contact:', error)
            toast.add({
                severity: 'error',
                summary: 'エラー',
                detail: '撮影連絡情報の更新に失敗しました',
                life: 3000
            })
            return false
        }
    }

    /**
     * ステータスを次に進める
     */
    async function advanceStatus(contactId: string): Promise<boolean> {
        const contact = contacts.value.find(c => c.id === contactId)
        if (!contact) return false

        const statusOrder: ShootingContactStatus[] = [
            '香盤連絡待ち',
            '発注書送信待ち',
            'メイキング共有待ち',
            '投稿日連絡待ち',
            '完了'
        ]

        const currentIndex = statusOrder.indexOf(contact.status)
        if (currentIndex === -1 || currentIndex >= statusOrder.length - 1) {
            return false
        }

        const nextStatus = statusOrder[currentIndex + 1]
        return await updateContact(contactId, { status: nextStatus })
    }

    /**
     * ステータス別にグループ化
     */
    const contactsByStatus = computed(() => {
        const grouped: Record<ShootingContactStatus, ShootingContact[]> = {
            '香盤連絡待ち': [],
            '発注書送信待ち': [],
            'メイキング共有待ち': [],
            '投稿日連絡待ち': [],
            '完了': []
        }

        contacts.value.forEach(contact => {
            if (grouped[contact.status]) {
                grouped[contact.status].push(contact)
            }
        })

        return grouped
    })

    /**
     * 日付別にグループ化
     */
    const contactsByDate = computed(() => {
        const grouped: Record<string, ShootingContact[]> = {}

        contacts.value.forEach(contact => {
            if (!contact.shootDate) return

            const date = contact.shootDate.toDate()
            const dateKey = date.toISOString().split('T')[0]
            if (!dateKey) return

            if (!grouped[dateKey]) {
                grouped[dateKey] = []
            }
            grouped[dateKey]!.push(contact)
        })

        return grouped
    })

    /**
     * ステータス別カウント
     */
    const statusCounts = computed(() => {
        const counts: Record<ShootingContactStatus, number> = {
            '香盤連絡待ち': 0,
            '発注書送信待ち': 0,
            'メイキング共有待ち': 0,
            '投稿日連絡待ち': 0,
            '完了': 0
        }

        contacts.value.forEach(contact => {
            if (counts[contact.status] !== undefined) {
                counts[contact.status]++
            }
        })

        return counts
    })

    return {
        contacts,
        loading,
        contactsByStatus,
        contactsByDate,
        statusCounts,
        fetchAll,
        fetchByStatus,
        addFromCasting,
        updateContact,
        advanceStatus
    }
}
