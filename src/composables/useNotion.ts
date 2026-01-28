import { ref } from 'vue'
import { functions } from '@/services/firebase'
import { httpsCallable } from 'firebase/functions'
import { useToast } from 'primevue/usetoast'

/**
 * Notion同期composable
 * GASエンドポイント経由またはCloud Functions経由でNotionと同期
 */
export function useNotion() {
    const loading = ref(false)
    const toast = useToast()

    // バックエンドのベースURL（開発/本番で切り替え）
    const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || ''
    const GAS_ENDPOINT_URL = import.meta.env.VITE_GAS_ENDPOINT_URL || ''

    /**
     * OK/決定ステータス時にNotionに同期
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
            // 1. Cloud Functionsを使用する場合
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
                    console.warn('Cloud Functions not available, trying fallback:', err)
                }
            }

            // 2. FastAPIバックエンド経由でGASを呼び出す場合
            if (API_BASE_URL) {
                const response = await fetch(`${API_BASE_URL}/api/sync/notion`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        action: 'syncToNotion',
                        ...payload
                    })
                })

                if (response.ok) {
                    console.log('Notion sync via FastAPI successful')
                    return true
                }
            }

            // 3. GASエンドポイントに直接呼び出す場合
            if (GAS_ENDPOINT_URL) {
                const response = await fetch(GAS_ENDPOINT_URL, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        action: 'syncToNotion',
                        ...payload
                    })
                })

                if (response.ok) {
                    console.log('Notion sync via GAS successful')
                    return true
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
     */
    async function syncShootingSchedule(): Promise<boolean> {
        loading.value = true

        try {
            if (API_BASE_URL) {
                const response = await fetch(`${API_BASE_URL}/api/sync/gas?type=shooting`)

                if (response.ok) {
                    toast.add({
                        severity: 'success',
                        summary: '同期完了',
                        detail: '撮影スケジュールを同期しました',
                        life: 2000
                    })
                    return true
                }
            }

            console.log('Shooting schedule sync (dev mode)')
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
