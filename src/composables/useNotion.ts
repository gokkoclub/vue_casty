import { ref } from 'vue'
import { functions } from '@/services/firebase'
import { httpsCallable } from 'firebase/functions'
import { useToast } from 'primevue/usetoast'

/**
 * Notion同期composable
 * Cloud Functions経由でNotionと同期
 * 
 * 注意: ステータス変更時のNotion同期はCloud Functions (notifyStatusUpdate) 内で
 * 自動的に行われます。このcomposableは直接呼び出しが必要な場合のみ使用してください。
 */
export function useNotion() {
    const loading = ref(false)
    const toast = useToast()

    /**
     * OK/決定ステータス時にNotionに同期
     * Cloud Functions (notifyStatusUpdate) 内で自動実行されるが、
     * 手動同期が必要な場合にも使用可能
     */
    interface NotionSyncPayload {
        projectId: string
        castName: string
        status: string
        mainSub: string
        roleName?: string
        accountName?: string
    }

    async function syncToNotion(payload: NotionSyncPayload): Promise<boolean> {
        loading.value = true

        try {
            // Cloud Functions経由で同期
            if (functions) {
                try {
                    const syncFn = httpsCallable(functions, 'syncToNotion')
                    await syncFn({
                        action: 'syncToNotion',
                        ...payload
                    })
                    console.log('Notion sync via Cloud Functions successful')
                    return true
                } catch (err) {
                    console.warn('Cloud Functions syncToNotion not available:', err)
                }
            }

            // 開発モード（バックエンドなし）
            console.log('Notion sync (dev mode):', payload)
            return true

        } catch (error) {
            console.error('Error syncing to Notion:', error)
            return false
        } finally {
            loading.value = false
        }
    }

    /**
     * 撮影スケジュールをNotionから同期
     * → GASで定期実行されるため、手動同期は基本不要
     */
    async function syncShootingSchedule(): Promise<boolean> {
        loading.value = true

        try {
            console.log('Shooting schedule sync is handled by GAS scheduled trigger')
            toast.add({
                severity: 'info',
                summary: '同期',
                detail: '撮影スケジュールはGASで定期同期されます',
                life: 2000
            })
            return true

        } catch (error) {
            console.error('Error syncing shooting schedule:', error)
            toast.add({
                severity: 'error',
                summary: '同期エラー',
                detail: '撮影スケジュールの同期に失敗しました',
                life: 3000
            })
            return false
        } finally {
            loading.value = false
        }
    }

    return {
        loading,
        syncToNotion,
        syncShootingSchedule
    }
}
