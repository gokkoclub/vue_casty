import { ref } from 'vue'
import {
    collection, query, where, getDocs, updateDoc, doc, Timestamp
} from 'firebase/firestore'
import { db } from '@/services/firebase'
import type { CastMaster, Casting } from '@/types'
import { useToast } from 'primevue/usetoast'
import { useAuth } from '@/composables/useAuth'

/**
 * キャスティングマスターDB管理composable（統合版）
 *
 * 旧: castMaster コレクションを CRUD
 * 新: castings コレクション（isDecided == true）を読み書き
 *
 * CastMaster 型への変換アダプタを含むので、ManagementView 側の変更は最小限。
 */

function castingToMaster(id: string, data: Record<string, unknown>): CastMaster {
    return {
        id,
        castingId: id,  // 統合後は自分自身
        castId: (data.castId as string) || '',
        castName: (data.castName as string) || '',
        castType: (data.castType as '内部' | '外部') || '外部',
        accountName: (data.accountName as string) || '',
        projectName: (data.projectName as string) || '',
        roleName: (data.roleName as string) || '',
        mainSub: (data.mainSub as 'メイン' | 'サブ' | 'その他') || 'その他',
        shootDate: data.startDate as Timestamp,
        endDate: (data.endDate as Timestamp) || (data.startDate as Timestamp),
        cost: (data.cost as number) || 0,
        decidedAt: (data.decidedAt as Timestamp) || (data.updatedAt as Timestamp) || Timestamp.now(),
        decidedBy: (data.decidedBy as string) || (data.updatedBy as string) || 'unknown',
        createdAt: data.createdAt as Timestamp,
    }
}

export function useCastMaster() {
    const masters = ref<CastMaster[]>([])
    const loading = ref(false)
    const toast = useToast()
    const { user } = useAuth()

    /**
     * キャスティングを決定履歴にマーク
     * 統合版: castings ドキュメントに isDecided=true を設定するだけ
     */
    async function addToCastMaster(casting: Casting): Promise<boolean> {
        if (!db) {
            console.error('Firestore not initialized')
            return false
        }

        try {
            // 既に isDecided なら skip
            if ((casting as Record<string, unknown>).isDecided === true) {
                console.log('Already decided:', casting.id)
                return false
            }

            const castingRef = doc(db, 'castings', casting.id)
            await updateDoc(castingRef, {
                isDecided: true,
                decidedAt: Timestamp.now(),
                decidedBy: user.value?.email || 'unknown',
                updatedAt: Timestamp.now(),
            })

            console.log(`Marked as decided: ${casting.castName} (${casting.castType})`)
            return true
        } catch (error) {
            console.error('Error marking as decided:', error)
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
     * マスターデータを更新
     * 統合版: castings ドキュメントを直接更新
     */
    async function updateMaster(masterId: string, data: Partial<CastMaster>): Promise<boolean> {
        if (!db) return false
        try {
            const castingRef = doc(db, 'castings', masterId)
            const updateData: Record<string, unknown> = { updatedAt: Timestamp.now() }

            // CastMaster フィールド → castings フィールドのマッピング
            if (data.cost !== undefined) { updateData.cost = data.cost; updateData.fee = data.cost }
            if (data.projectName !== undefined) updateData.projectName = data.projectName
            if (data.roleName !== undefined) updateData.roleName = data.roleName
            if (data.mainSub !== undefined) updateData.mainSub = data.mainSub

            await updateDoc(castingRef, updateData)

            // ローカル更新
            const master = masters.value.find(m => m.id === masterId)
            if (master) Object.assign(master, data)

            toast.add({ severity: 'success', summary: '更新完了', detail: 'マスターデータを更新しました', life: 2000 })
            return true
        } catch (error) {
            console.error('Error updating castMaster:', error)
            toast.add({ severity: 'error', summary: 'エラー', detail: '更新に失敗しました', life: 3000 })
            return false
        }
    }

    /**
     * 決定済みキャスティングの履歴を取得
     * 統合版: castings where isDecided == true
     */
    async function fetchHistory(filters?: {
        castId?: string
        accountName?: string
        dateRange?: { start: Date; end: Date }
    }): Promise<void> {
        if (!db) return
        loading.value = true

        try {
            const q = query(
                collection(db, 'castings'),
                where('isDecided', '==', true)
            )
            const snapshot = await getDocs(q)
            let results: CastMaster[] = []

            snapshot.forEach((docSnap) => {
                const data = docSnap.data()
                // 削除済みは除外
                if (data.deleted === true) return
                results.push(castingToMaster(docSnap.id, data))
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
                    const shootTime = m.shootDate?.toDate?.()?.getTime() || 0
                    return shootTime >= start && shootTime <= end
                })
            }

            // 決定日時降順
            results.sort((a, b) => (b.decidedAt?.toMillis?.() || 0) - (a.decidedAt?.toMillis?.() || 0))

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
                collection(db, 'castings'),
                where('castId', '==', castId),
                where('isDecided', '==', true)
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
        updateMaster,
        fetchHistory,
        getAppearanceCount
    }
}
