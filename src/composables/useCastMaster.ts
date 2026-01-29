import { ref } from 'vue'
import {
    collection, query, where, getDocs, addDoc, Timestamp
} from 'firebase/firestore'
import { db } from '@/services/firebase'
import type { CastMaster, Casting } from '@/types'
import { useToast } from 'primevue/usetoast'
import { useAuth } from '@/composables/useAuth'

/**
 * キャスティングマスターDB管理composable
 * 「決定」ステータスになったキャスティングの履歴を保存
 * 内部・外部両方のキャストが対象
 */
export function useCastMaster() {
    const masters = ref<CastMaster[]>([])
    const loading = ref(false)
    const toast = useToast()
    const { user } = useAuth()

    /**
     * キャスティングマスターDBに追加
     * 決定ステータス時に呼び出される
     */
    async function addToCastMaster(casting: Casting): Promise<boolean> {
        if (!db) {
            console.error('Firestore not initialized')
            return false
        }

        try {
            // 重複チェック
            const existingQuery = query(
                collection(db, 'castMaster'),
                where('castingId', '==', casting.id)
            )
            const existing = await getDocs(existingQuery)

            if (!existing.empty) {
                console.log('CastMaster already exists for casting:', casting.id)
                return false
            }

            // 新規作成
            const now = Timestamp.now()
            const masterData: Omit<CastMaster, 'id'> = {
                castingId: casting.id,
                castId: casting.castId,
                castName: casting.castName,
                castType: casting.castType,
                accountName: casting.accountName,
                projectName: casting.projectName,
                roleName: casting.roleName,
                mainSub: casting.mainSub || 'その他',
                shootDate: casting.startDate,
                endDate: casting.endDate,
                cost: casting.cost || 0,
                decidedAt: now,
                decidedBy: user.value?.email || 'unknown',
                createdAt: now
            }

            await addDoc(collection(db, 'castMaster'), masterData)

            console.log(`Added to castMaster: ${casting.castName} (${casting.castType})`)

            return true
        } catch (error) {
            console.error('Error adding to castMaster:', error)
            toast.add({
                severity: 'error',
                summary: 'エラー',
                detail: 'キャスティングマスターDBへの追加に失敗しました',
                life: 3000
            })
            return false
        }
    }

    /**
     * キャスティングマスターDBから履歴を取得
     */
    async function fetchHistory(filters?: {
        castId?: string
        accountName?: string
        dateRange?: { start: Date; end: Date }
    }): Promise<void> {
        if (!db) return

        loading.value = true

        try {
            let q = query(collection(db, 'castMaster'))

            const snapshot = await getDocs(q)
            let results: CastMaster[] = []

            snapshot.forEach((docSnap) => {
                const data = docSnap.data()
                results.push({
                    id: docSnap.id,
                    ...data
                } as CastMaster)
            })

            // クライアントサイドフィルタリング
            if (filters?.castId) {
                results = results.filter(m => m.castId === filters.castId)
            }
            if (filters?.accountName) {
                results = results.filter(m => m.accountName === filters.accountName)
            }
            if (filters?.dateRange) {
                const start = filters.dateRange.start.getTime()
                const end = filters.dateRange.end.getTime()
                results = results.filter(m => {
                    const shootTime = m.shootDate.toDate().getTime()
                    return shootTime >= start && shootTime <= end
                })
            }

            // 日付降順でソート
            results.sort((a, b) => b.decidedAt.toMillis() - a.decidedAt.toMillis())

            masters.value = results
        } catch (error) {
            console.error('Error fetching castMaster:', error)
            toast.add({
                severity: 'error',
                summary: 'エラー',
                detail: '履歴の取得に失敗しました',
                life: 3000
            })
        } finally {
            loading.value = false
        }
    }

    /**
     * キャスト別の出演回数を集計
     */
    async function getAppearanceCount(castId: string): Promise<number> {
        if (!db) return 0

        try {
            const q = query(
                collection(db, 'castMaster'),
                where('castId', '==', castId)
            )
            const snapshot = await getDocs(q)
            return snapshot.size
        } catch (error) {
            console.error('Error getting appearance count:', error)
            return 0
        }
    }

    return {
        masters,
        loading,
        addToCastMaster,
        fetchHistory,
        getAppearanceCount
    }
}
