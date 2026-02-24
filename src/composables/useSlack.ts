import { ref } from 'vue'
import { httpsCallable } from 'firebase/functions'
import { functions } from '@/services/firebase'
import { useToast } from 'primevue/usetoast'
import type { StatusUpdatePayload } from '@/utils/slackMessageBuilder'

/**
 * Slack通知composable
 * Cloud Functions経由でSlack連携を行う
 */
export function useSlack() {
    const loading = ref(false)
    const toast = useToast()

    /**
     * ステータス更新通知を送信
     * Cloud Functions `notifyStatusUpdate` を呼び出す
     */
    async function notifyStatusUpdate(
        payload: StatusUpdatePayload
    ): Promise<{ ok: boolean }> {
        loading.value = true

        try {
            if (functions) {
                const fn = httpsCallable(functions, 'notifyStatusUpdate')
                await fn({
                    castingId: payload.castingId,
                    newStatus: payload.newStatus,
                    previousStatus: payload.previousStatus,
                    extraMessage: payload.extraMessage
                })
                return { ok: true }
            }

            // 開発用（Cloud Functions未設定時）
            console.log('Slack status update (dev mode):', payload)
            return { ok: true }

        } catch (error) {
            console.error('Error sending status update:', error)
            toast.add({
                severity: 'warn',
                summary: 'Slack通知',
                detail: 'ステータス通知の送信に失敗しました（ローカル更新は完了）',
                life: 3000
            })
            return { ok: false }
        } finally {
            loading.value = false
        }
    }

    /**
     * キャスティング削除のクリーンアップ
     * Cloud Functions `deleteCastingCleanup` を呼び出す
     */
    async function notifyDeletion(castingId: string): Promise<{ ok: boolean }> {
        try {
            if (functions) {
                const fn = httpsCallable(functions, 'deleteCastingCleanup')
                await fn({ castingId })
                return { ok: true }
            }
            return { ok: true }
        } catch (error) {
            console.error('Error notifying deletion:', error)
            return { ok: false }
        }
    }

    return {
        loading,
        notifyStatusUpdate,
        notifyDeletion
    }
}
